import { Router } from "express";
import { listPrinters, isElevated } from "../printer/discovery";
import { getSelectedPrinter } from "../config/printer-config";
import { shareIfNeeded } from "../printer/share";
import { PrinterServiceError, statusForError } from "../printer/errors";

const router = Router();

function sendError(res: any, err: unknown) {
  if (err instanceof PrinterServiceError) {
    res.status(statusForError(err)).json({
      error: { code: err.code, message: err.message, detail: err.detail },
    });
    return;
  }
  console.error("PRINTERS ERROR", err);
  res.status(500).json({
    error: { code: "UNKNOWN", message: "Error inesperado del servicio de impresión." },
  });
}

// Lista + selección actual en UN solo payload, a propósito: el popover
// siempre necesita las dos cosas a la vez, y separarlas en dos queries
// abriría una ventana donde la UI podría mostrar una selección que ya no
// está en la lista.
router.get("/", async (_req, res) => {
  try {
    const [printers, elevated] = await Promise.all([listPrinters(), isElevated()]);
    res.json({
      printers,
      selected: getSelectedPrinter(),
      elevated,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Body: { name: string }. En orden: buscar en discovery -> si no está
// compartida, compartirla (auto-share) -> SOLO si eso funciona, persistir.
// Auto-compartir va adentro de este mismo endpoint, no separado en dos
// pasos: separarlo dejaría un estado a medio camino posible (compartida
// pero no persistida, o viceversa). Invariante importante para los toasts
// del frontend: nunca se persiste una selección cuyo paso de compartir
// falló -- si eso pasara, un toast.error ("no pasó") sería mentira.
router.post("/select", async (req, res) => {
  try {
    const { name } = req.body ?? {};
    if (!name || typeof name !== "string") {
      throw new PrinterServiceError("PRINTER_NOT_FOUND", "Falta el nombre de la impresora.");
    }

    const result = await shareIfNeeded(name);
    // setSelectedPrinter ya se llamó adentro de shareIfNeeded solo en el
    // camino de éxito -- ver share.ts.

    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
