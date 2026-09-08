import { execFile } from "child_process";
import { promisify } from "util";
import { PrinterServiceError } from "./errors";

const execFileAsync = promisify(execFile);

// Todo llamado a PowerShell del repo pasa por acá -- un solo lugar auditado
// en vez de exec() sueltos repetidos por todos lados.
//
// Reglas verificadas empíricamente antes de escribir esto (no supuestas):
// - Nunca un archivo .ps1: la politica de ejecucion de PowerShell (Get-
//   ExecutionPolicy) solo aplica a SCRIPTS (.ps1 via -File o dot-sourcing),
//   nunca a -Command/-EncodedCommand. Yendo por -EncodedCommand, un cambio
//   de politica de ejecucion en la maquina del local NUNCA puede romper esto.
// - stderr no es senal de error: PowerShell escribe registros CLIXML de
//   progreso ("Preparing modules for first use") a stderr incluso en exito
//   total (confirmado corriendo Get-CimInstance/Get-Printer en limpio). La
//   senal real es el exit code + el JSON que el propio script imprime.

export async function runPowerShellJson<T>(script: string): Promise<T> {
  // $ProgressPreference apaga los registros CLIXML de arriba de raiz (mas
  // rapido que solo ignorarlos). $ErrorActionPreference='Stop' hace que
  // cualquier error de cmdlet dentro del script termine el proceso con
  // exit != 0 en vez de seguir silenciosamente.
  const fullScript = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; ${script}`;

  // -EncodedCommand evita por completo el infierno de escapes de cmd.exe
  // para un script con comillas, variables y saltos de linea.
  const encoded = Buffer.from(fullScript, "utf16le").toString("base64");

  // execFile, no exec(): exec() en Windows enruta TODO a traves de
  // cmd.exe /d /s /c "<linea completa>", cuyo limite de ~8191 caracteres
  // un blob base64 de un script mediano cruza sin esfuerzo (verificado
  // empiricamente -- ver el comentario en share.ts sobre "The command
  // line is too long"). execFile pasa el argv directo a CreateProcess,
  // sin ese cuello de botella intermedio.
  let stdout: string;
  try {
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new PrinterServiceError(
        "POWERSHELL_UNAVAILABLE",
        "No se encontró powershell.exe en esta PC.",
      );
    }
    if (err?.killed || err?.signal === "SIGTERM") {
      throw new PrinterServiceError(
        "POWERSHELL_TIMEOUT",
        "PowerShell tardó demasiado en responder.",
      );
    }
    // Cualquier otro fallo (exit != 0 de $ErrorActionPreference='Stop',
    // por ejemplo) -- el detalle crudo va en `detail`, nunca se le muestra
    // al usuario tal cual porque viene en el idioma de Windows.
    throw new PrinterServiceError(
      "POWERSHELL_BAD_OUTPUT",
      "PowerShell devolvió un error.",
      String(err?.stderr ?? err?.message ?? err),
    );
  }

  try {
    return JSON.parse(stdout.trim()) as T;
  } catch {
    throw new PrinterServiceError(
      "POWERSHELL_BAD_OUTPUT",
      "PowerShell devolvió una salida que no se pudo interpretar.",
      stdout,
    );
  }
}
