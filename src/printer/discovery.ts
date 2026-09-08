import { runPowerShellJson } from "./powershell";
import os from "os";

export type PrinterStatus = "online" | "offline" | "error";

export interface PrinterInfo {
  name: string;
  shareName: string | null;
  shared: boolean;
  status: PrinterStatus;
  isDefault: boolean;
}

// Campos crudos que devuelve Win32_Printer via CIM -- se usa CIM y no
// Get-Printer a proposito: medido en esta maquina, Get-CimInstance
// Win32_Printer tarda ~1.3s vs ~2.4s de Get-Printer, y solo CIM expone
// Default/WorkOffline (Get-Printer no tiene esos campos en absoluto).
interface RawWin32Printer {
  Name: string;
  ShareName: string | null;
  Shared: boolean;
  Default: boolean;
  WorkOffline: boolean;
  PrinterStatus: number;
  DetectedErrorState: number;
}

// Win32_Printer.PrinterStatus (uint16): 1 Other, 2 Unknown, 3 Idle,
// 4 Printing, 5 Warmup, 6 Stopped Printing, 7 Offline.
// Win32_Printer.DetectedErrorState (uint16): 0 Unknown, 1 Other, 2 No Error,
// 3 Low Paper, 4 No Paper, 5 Low Toner, 6 No Toner, 7 Door Open, 8 Jammed,
// 9 Offline, 10 Service Requested, 11 Output Bin Full.
function toStatus(raw: RawWin32Printer): PrinterStatus {
  // Precedencia offline > error > online. WorkOffline es el checkbox
  // "Usar impresora sin conexion" de Windows -- causa silenciosa muy
  // comun, se chequea primero.
  if (raw.WorkOffline) return "offline";
  if (raw.PrinterStatus === 7 || raw.DetectedErrorState === 9) return "offline";

  const errorStates = [3, 4, 6, 7, 8, 10, 11]; // papel, toner, atasco, tapa, bandeja llena
  if (errorStates.includes(raw.DetectedErrorState)) return "error";
  if (raw.PrinterStatus === 6) return "error";

  // Idle/Printing/Warmup, y deliberadamente tambien Other/Unknown (1, 2):
  // muchos drivers termicos baratos nunca reportan un estado real, y un
  // picker que muestra todo como roto es peor que uno ocasionalmente
  // optimista. El estado es informativo (un punto de color), nunca
  // bloquea la seleccion.
  return "online";
}

function normalize(raw: RawWin32Printer): PrinterInfo {
  return {
    name: raw.Name,
    // CIM devuelve "" para sin compartir (no null) en algunos casos --
    // normalizar ambos a null.
    shareName: raw.ShareName || null,
    shared: raw.Shared,
    status: toStatus(raw),
    isDefault: raw.Default,
  };
}

const DISCOVERY_SCRIPT = `
ConvertTo-Json -Compress -Depth 2 -InputObject @(
  Get-CimInstance -ClassName Win32_Printer |
  Select-Object Name, ShareName, Shared, Default, WorkOffline,
                PrinterStatus, DetectedErrorState
)
`;
// -InputObject @(...) es obligatorio, no cosmetico: con un solo resultado,
// "Get-CimInstance ... | ConvertTo-Json" (forma pipeline) devuelve un OBJETO
// suelto, no un array de un elemento -- verificado en esta maquina.
// PowerShell 5.1 no tiene -AsArray (eso es PS 6+), asi que -InputObject
// @(...) es la unica forma correcta.

// Cache corta en memoria: evita un segundo spawn de ~1.3s cuando
// POST /printers/select necesita la lista que el frontend acaba de pedir
// hace un instante para ese mismo popover.
let cache: { at: number; printers: PrinterInfo[] } | null = null;
const CACHE_TTL_MS = 5000;

export async function listPrinters(opts?: { skipCache?: boolean }): Promise<PrinterInfo[]> {
  if (!opts?.skipCache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.printers;
  }
  const raw = await runPowerShellJson<RawWin32Printer[]>(DISCOVERY_SCRIPT);
  const printers = raw.map(normalize);
  cache = { at: Date.now(), printers };
  return printers;
}

export function invalidatePrinterCache(): void {
  cache = null;
}

// La elevacion no puede cambiar sin reiniciar el proceso -- se calcula una
// sola vez al arrancar y se cachea, cero costo en cada request.
let elevatedCache: boolean | null = null;

export async function isElevated(): Promise<boolean> {
  if (elevatedCache !== null) return elevatedCache;
  if (os.platform() !== "win32") {
    elevatedCache = false;
    return false;
  }
  const result = await runPowerShellJson<boolean>(
    `ConvertTo-Json -InputObject ([bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))`,
  );
  elevatedCache = result;
  return result;
}
