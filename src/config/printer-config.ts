import fs from "fs";
import path from "path";
import { CONFIG_DIR } from "./env";
import { listPrinters } from "../printer/discovery";

// El valor hardcodeado que este repo usó siempre antes de esta feature
// (thermal-printer.ts tenía "const PRINTER_NAME = LEGACY_PRINTER_NAME").
// Se usa una sola vez, como tier 2 del default de primer arranque más
// abajo -- así el local ya desplegado sigue imprimiendo igual sin que
// nadie tenga que tocar nada a mano.
export const LEGACY_PRINTER_NAME = "POS-80-Series";

export interface PrinterConfig {
  version: 1;
  printerName: string;
  shareName: string;
  selectedAt: string; // ISO
}

const CONFIG_PATH = path.join(CONFIG_DIR, "printer-config.json");

// Selección actual en memoria. `printOrderWithThermal` la lee EN EL MOMENTO
// de imprimir (no al cargar el módulo) -- eso es lo que hace que
// POST /printers/select surta efecto sin reiniciar el proceso. Si esto
// se "prolija" a una constante calculada una sola vez al importar el
// módulo, se reintroduce en silencio la necesidad de reiniciar.
let current: PrinterConfig | null = null;

export function getSelectedPrinter(): { name: string; shareName: string } | null {
  if (!current) return null;
  return { name: current.printerName, shareName: current.shareName };
}

export function setSelectedPrinter(selection: { name: string; shareName: string }): void {
  const next: PrinterConfig = {
    version: 1,
    printerName: selection.name,
    shareName: selection.shareName,
    selectedAt: new Date().toISOString(),
  };
  current = next;

  // Escritura atómica: a un temp primero, rename después. writeFileSync
  // directo puede dejar el archivo truncado si el proceso muere a mitad
  // de escritura -- rename es atómico en NTFS, esto no.
  const tmpPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), "utf-8");
  fs.renameSync(tmpPath, CONFIG_PATH);
}

function readConfigFile(): PrinterConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed.printerName || !parsed.shareName) {
      console.warn("⚠️  printer-config.json con forma inesperada, se ignora.");
      return null;
    }
    return parsed as PrinterConfig;
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn("⚠️  No se pudo leer printer-config.json:", err?.message ?? err);
    }
    return null;
  }
}

// Default de primer arranque, en cascada -- nunca una adivinanza silenciosa.
// Deliberadamente NO cae al default de Windows si no está compartido: eso
// resuelve a \\localhost\ (vacío) y "copy /b" falla con un error críptico
// de Windows, exactamente el problema que esta feature existe para
// eliminar. null es el estado honesto, y es lo que hace aparecer el picker.
async function resolveFirstRunDefault(): Promise<PrinterConfig | null> {
  const printers = await listPrinters().catch(() => []);

  const legacy = printers.find((p) => p.name === LEGACY_PRINTER_NAME);
  if (legacy?.shared && legacy.shareName) {
    return {
      version: 1,
      printerName: legacy.name,
      shareName: legacy.shareName,
      selectedAt: new Date().toISOString(),
    };
  }

  const onlyOrDefault =
    printers.length === 1
      ? printers[0]
      : printers.find((p) => p.isDefault && p.shared && p.shareName);
  if (onlyOrDefault?.shared && onlyOrDefault.shareName) {
    return {
      version: 1,
      printerName: onlyOrDefault.name,
      shareName: onlyOrDefault.shareName,
      selectedAt: new Date().toISOString(),
    };
  }

  return null;
}

// Se llama una vez al arrancar, desde index.ts. Nunca tira -- un config
// ausente o corrupto no puede tumbar el servicio.
export async function loadPrinterConfig(): Promise<void> {
  const fromFile = readConfigFile();
  if (fromFile) {
    current = fromFile;
    return;
  }

  const fallback = await resolveFirstRunDefault().catch((err) => {
    console.warn("⚠️  No se pudo resolver un default de impresora:", err?.message ?? err);
    return null;
  });

  if (fallback) {
    current = fallback;
    // Se persiste de una: así la próxima vez ya hay printer-config.json y
    // este camino de resolución no se vuelve a ejecutar.
    setSelectedPrinter({ name: fallback.printerName, shareName: fallback.shareName });
  }
}
