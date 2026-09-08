import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { listPrinters, invalidatePrinterCache, PrinterInfo } from "./discovery";
import { setSelectedPrinter } from "../config/printer-config";
import { PrinterServiceError } from "./errors";

// execFile, no exec(): exec() en Windows enruta TODO a traves de
// cmd.exe /d /s /c "<linea completa>", con un limite de ~8191 caracteres
// que un blob base64 cruza facil -- confirmado empiricamente, ver el
// comentario en runShareScriptElevated más abajo ("The command line is
// too long"). execFile pasa el argv directo a CreateProcess.
const execFileAsync = promisify(execFile);

// Separado de discovery.ts a propósito: el camino de lectura queda sin
// efectos secundarios, este es el único lugar que escribe algo en Windows.

// Regla de Microsoft: un nombre de share con espacios o más de 31
// caracteres puede hacer fallar ciertas llamadas de la API de Windows.
// También se evitan los caracteres que Windows prohíbe en nombres de
// share (" \ / [ ] : | < > + = ; , * ?) y los nombres reservados de DOS.
const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export function deriveShareName(printerName: string, existingShareNames: string[]): string {
  let base = printerName
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  if (base.length === 0) base = "JEBBS-PRN";
  base = base.slice(0, 31).replace(/-+$/g, "");

  if (RESERVED_NAMES.has(base.toUpperCase())) {
    base = `${base.slice(0, 29)}-P`;
  }

  const existing = new Set(existingShareNames);
  if (!existing.has(base)) return base;

  for (let i = 2; i < 100; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  // Escape hatch extremadamente improbable (99 colisiones exactas).
  return `JEBBS-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

interface ShareScriptResult {
  ok: boolean;
  shareName?: string;
  shared?: boolean;
  server?: string;
  hresult?: string;
  fqid?: string;
  message?: string;
}

function escapePs(value: string): string {
  return value.replace(/'/g, "''");
}

function buildShareScript(printerName: string, shareName: string): string {
  const p = escapePs(printerName);
  const s = escapePs(shareName);
  // Set-Printer + re-lectura + chequeo del servicio LanmanServer, todo en
  // UN spawn -- Set-Printer solo tarda ~2.4s, tres round-trips separados
  // harian el endpoint de seleccion ~7s. Devuelve JSON estructurado en
  // exito Y en error (exit 0 siempre): se clasifica por HResult/
  // FullyQualifiedErrorId, nunca por el texto (viene localizado).
  return `
$ProgressPreference='SilentlyContinue'
try {
  Set-Printer -Name '${p}' -Shared $true -ShareName '${s}' -ErrorAction Stop
  $printer = Get-CimInstance Win32_Printer -Filter "Name='${p}'"
  $svc = (Get-Service LanmanServer).Status.ToString()
  ConvertTo-Json -Compress -InputObject @{ ok=$true; shareName=$printer.ShareName; shared=$printer.Shared; server=$svc }
} catch {
  # $_.Exception.HResult miente para errores de Set-Printer -- CIM envuelve
  # el fallo real (ej. acceso denegado, 0x80070005) en un CimException cuyo
  # .HResult es un codigo generico del wrapper .NET (0x80131500), siempre el
  # mismo sin importar la causa. El HResult real de Windows solo aparece
  # como texto dentro de FullyQualifiedErrorId ("HRESULT 0x80070005,Set-
  # Printer"). Verificado empiricamente en esta maquina -- sin este parseo,
  # NOT_ELEVATED nunca se detecta y la elevacion JIT jamas se dispara.
  $fqid = $_.FullyQualifiedErrorId
  $match = [regex]::Match($fqid, 'HRESULT (0x[0-9A-Fa-f]{8})')
  $hresult = if ($match.Success) { $match.Groups[1].Value } else { ('0x{0:X8}' -f $_.Exception.HResult) }
  ConvertTo-Json -Compress -InputObject @{
    ok=$false
    hresult=$hresult
    fqid=$fqid
    message=$_.Exception.Message
  }
}
`;
}

// Corre el script de share SIN elevar -- child_process hereda los
// privilegios del proceso actual, ni más ni menos.
async function runShareScript(script: string): Promise<ShareScriptResult> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout.trim());
}

// -Verb RunAs es incompatible con -RedirectStandardOutput -- no se puede
// leer el stdout del hijo elevado directamente. El script hijo escribe su
// resultado a un archivo temporal que el padre lee después del -Wait.
async function runShareScriptElevated(script: string): Promise<ShareScriptResult> {
  const resultPath = path.join(os.tmpdir(), `jebbs-share-${crypto.randomUUID()}.json`);
  // `script` es un try/catch completo -- un STATEMENT, no una expresion de
  // pipeline. Encadenarlo directo con "${script}\n| Out-File ..." pone el
  // `|` como primer token de una linea nueva, y PowerShell no soporta
  // continuar un pipeline con un pipe al INICIO de la linea siguiente
  // (solo al final de la anterior) -- tira "An empty pipe element is not
  // allowed" (EmptyPipeElement), confirmado empiricamente. Envolver en un
  // scriptblock y capturar el resultado en una variable evita la ambiguedad
  // por completo: son dos statements independientes, no una continuacion.
  const scriptWithFileWrite = `
$result = & {
${script}
}
$result | Out-File -FilePath '${escapePs(resultPath)}' -Encoding utf8
`;
  const encoded = Buffer.from(scriptWithFileWrite, "utf16le").toString("base64");

  // El comando de Start-Process va como UN SOLO argv de -Command, sin
  // envolverlo en un segundo -EncodedCommand -- version anterior codificaba
  // esto dos veces (el script hijo, y de nuevo todo el launcher), y
  // corriendo eso con exec() a traves de cmd.exe (limite ~8191 caracteres)
  // tiraba literalmente "The command line is too long" en el camino real
  // de elevacion (confirmado en esta maquina). execFile con argv evita
  // ambos problemas: sin cmd.exe de por medio, y una sola capa de base64.
  const launcherCommand = `Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encoded}')`;

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", launcherCommand],
      { windowsHide: true, timeout: 30000 },
    );
  } catch (err: any) {
    // Start-Process -Verb RunAs tira un Win32Exception con el codigo nativo
    // 1223 (ERROR_CANCELLED) cuando el usuario le dice que no al UAC.
    const message = String(err?.message ?? err);
    if (message.includes("1223") || message.includes("0x800704C7")) {
      throw new PrinterServiceError(
        "UAC_CANCELLED",
        "Se canceló la aprobación de Windows.",
      );
    }
    throw err;
  }

  if (!fs.existsSync(resultPath)) {
    // El hijo elevado murio antes de escribir un resultado -- la ausencia
    // del archivo es en si misma la señal.
    throw new PrinterServiceError(
      "SHARE_FAILED",
      "No se pudo confirmar el resultado de compartir la impresora.",
    );
  }
  const raw = fs.readFileSync(resultPath, "utf-8");
  fs.unlinkSync(resultPath);
  return JSON.parse(raw.trim());
}

function classifyShareFailure(result: ShareScriptResult): PrinterServiceError {
  if (result.hresult === "0x80070005") {
    return new PrinterServiceError(
      "NOT_ELEVATED",
      "Hace falta ejecutar el servicio como administrador para compartir esta impresora.",
      result.hresult,
    );
  }
  return new PrinterServiceError(
    "SHARE_FAILED",
    "No se pudo compartir la impresora.",
    result.message ?? result.fqid,
  );
}

interface SelectResult {
  selected: { name: string; shareName: string };
  printer: PrinterInfo;
  sharedByUs: boolean;
  reachable: boolean;
}

// El endpoint POST /printers/select llama solo a esto. Ver el comentario
// en routes/printers.ts sobre por qué esto vive en un único paso atómico.
export async function shareIfNeeded(printerName: string): Promise<SelectResult> {
  const printers = await listPrinters({ skipCache: true });
  const printer = printers.find((p) => p.name === printerName);
  if (!printer) {
    throw new PrinterServiceError(
      "PRINTER_NOT_FOUND",
      "Esa impresora ya no aparece en la lista de esta PC.",
    );
  }

  // Ya compartida: se adopta el nombre de share EXISTENTE, nunca se
  // renombra -- otra PC podría ya estar imprimiendo contra ese share.
  if (printer.shared && printer.shareName) {
    setSelectedPrinter({ name: printer.name, shareName: printer.shareName });
    return {
      selected: { name: printer.name, shareName: printer.shareName },
      printer,
      sharedByUs: false,
      reachable: printer.status !== "offline",
    };
  }

  const shareName = deriveShareName(
    printer.name,
    printers.filter((p) => p.shareName).map((p) => p.shareName as string),
  );
  const script = buildShareScript(printer.name, shareName);

  let result: ShareScriptResult;
  try {
    result = await runShareScript(script);
  } catch (err) {
    if (err instanceof PrinterServiceError) throw err;
    throw new PrinterServiceError("SHARE_FAILED", "No se pudo compartir la impresora.", String(err));
  }

  if (!result.ok) {
    const classified = classifyShareFailure(result);
    if (classified.code !== "NOT_ELEVATED") throw classified;

    // No elevado: reintentar el MISMO script en un proceso hijo elevado
    // (JIT -- ver B6 en el plan: sin manifiesto embebido, sin UAC en cada
    // arranque del servicio, elevación pedida exactamente una vez por
    // impresora nueva).
    result = await runShareScriptElevated(script);
    if (!result.ok) throw classifyShareFailure(result);
  }

  invalidatePrinterCache();
  const finalShareName = result.shareName ?? shareName;
  setSelectedPrinter({ name: printer.name, shareName: finalShareName });

  return {
    selected: { name: printer.name, shareName: finalShareName },
    printer: { ...printer, shared: true, shareName: finalShareName },
    sharedByUs: true,
    reachable: result.server === "Running" && printer.status !== "offline",
  };
}
