// Contrato de error compartido por todo lo nuevo de esta feature (discovery,
// config, share, y las rutas que los exponen). Las rutas devuelven
// { error: { code, message, detail } } y el frontend rama sobre `code`,
// nunca sobre `message` -- los mensajes de Windows vienen localizados
// (esta maquina es es-AR), los codigos no.
export type PrinterErrorCode =
  | "POWERSHELL_UNAVAILABLE"
  | "POWERSHELL_TIMEOUT"
  | "POWERSHELL_BAD_OUTPUT"
  | "NOT_ELEVATED"
  | "UAC_CANCELLED"
  | "PRINTER_NOT_FOUND"
  | "SHARE_FAILED"
  | "SHARE_UNREACHABLE"
  | "NO_PRINTER_SELECTED";
// Nota: "el servicio LanmanServer no corre" NO es un codigo de error --
// select puede tener exito (impresora compartida) y aun asi no ser
// alcanzable todavia. Eso se comunica via el campo `reachable: boolean`
// en la respuesta exitosa de POST /printers/select (share.ts), no
// tirando una excepcion. El frontend lo lee como toast.warning, no error.

export class PrinterServiceError extends Error {
  constructor(
    public code: PrinterErrorCode,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "PrinterServiceError";
  }
}

// Códigos que ameritan 409 (conflicto de estado, accionable por el usuario)
// en vez de 500 (error genérico) o 404 (no encontrado).
const CONFLICT_CODES: PrinterErrorCode[] = [
  "NOT_ELEVATED",
  "UAC_CANCELLED",
  "NO_PRINTER_SELECTED",
];

export function statusForError(err: PrinterServiceError): number {
  if (err.code === "PRINTER_NOT_FOUND") return 404;
  if (CONFLICT_CODES.includes(err.code)) return 409;
  return 500;
}
