import { ENV_PATH, IS_PKG } from "./config/env";
import express from "express";
import cors from "cors";
import path from "path";
import printRoutes from "./routes/print";
import printerRoutes from "./routes/printers";
import { loadPrinterConfig, getSelectedPrinter } from "./config/printer-config";
// require, no import: pkg lo snapshotea correctamente al empaquetar, y
// asi /health puede reportar la version real en vez del literal "1.0.0"
// que quedaba hardcodeado y mintiendo.
const packageJson = require("../package.json");

const isPkg = IS_PKG;
const envPath = ENV_PATH;

console.log("🔧 Env path:", envPath);

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// CONFIGURACIÓN PARA EXE
// ============================================

// Detectar si estamos en producción (exe)

// Path a assets cuando está empaquetado
const assetsPath = isPkg
  ? path.join(path.dirname(process.execPath), "assets")
  : path.join(__dirname, "..", "assets");

console.log("📁 Assets path:", assetsPath);
console.log("🚀 Running as:", isPkg ? "EXE" : "Node.js");

// Exponer assetsPath globalmente
(global as any).ASSETS_PATH = assetsPath;

// ============================================
// CORS - CONFIGURACIÓN DINÁMICA
// ============================================

app.use(
  cors({
    origin: function (origin, callback) {
      // Permitir requests sin origin (como Postman, curl, etc)
      if (!origin) return callback(null, true);

      // Lista de orígenes permitidos
      const allowedOrigins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "https://jebbs-dashboard.vercel.app",
        // Agrega más dominios específicos aquí
      ];

      // Permitir TODOS los subdominios de vercel.app
      if (origin.endsWith(".vercel.app")) {
        return callback(null, true);
      }

      // Verificar lista de permitidos
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Rechazar otros orígenes
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

// ============================================
// HEALTH CHECK
// ============================================

// Probe de vida PURA a propósito -- no consulta la impresora física.
// Get-CimInstance/Get-Printer miden 1.3-2.7s por invocación (medido en
// esta máquina), y el frontend aborta /health a los 2000ms con un poll
// cada 30s. Meter eso acá rompería el badge por lentitud, no por la
// impresora estar realmente desconectada, y el guard de usePrintOrder
// bloquearía la impresión por esa falsa alarma. El estado físico real
// vive en GET /printers, pedido solo cuando el popover se abre.
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "jebbs-print-service",
    version: packageJson.version,
    mode: isPkg ? "production" : "development",
    port: PORT,
    // Campos de memoria, costo cero -- alcanzan para un tercer estado de
    // badge ("servicio activo, sin impresora") sin tocar el timeout de arriba.
    printerConfigured: getSelectedPrinter() !== null,
    selectedPrinter: getSelectedPrinter()?.name ?? null,
  });
});

// ============================================
// ROUTES
// ============================================

app.use("/print", printRoutes);
app.use("/printers", printerRoutes);

// ============================================
// ERROR HANDLING
// ============================================

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("❌ Error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  },
);

// ============================================
// START SERVER
// ============================================

// Se carga antes de empezar a escuchar -- así el primer GET /health/
// /printers ya ve una selección resuelta (config existente, o el default
// de primer arranque) en vez de null por una carrera con el arranque.
loadPrinterConfig()
  .catch((err) => console.warn("⚠️  No se pudo cargar la config de impresora:", err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log("");
      console.log("🖨️  ========================================");
      console.log("🍔  JEBBS BURGERS - PRINT SERVICE");
      console.log("🖨️  ========================================");
      console.log("");
      console.log(`✅  Servidor corriendo en http://localhost:${PORT}`);
      console.log(`📁  Assets: ${assetsPath}`);
      console.log(`🔧  Modo: ${isPkg ? "PRODUCCIÓN (EXE)" : "DESARROLLO"}`);
      console.log(`🖨️  Impresora: ${getSelectedPrinter()?.name ?? "(sin configurar)"}`);
      console.log("");
      console.log("📡  Endpoints disponibles:");
      console.log(`    GET  http://localhost:${PORT}/health`);
      console.log(`    POST http://localhost:${PORT}/print`);
      console.log(`    GET  http://localhost:${PORT}/printers`);
      console.log(`    POST http://localhost:${PORT}/printers/select`);
      console.log("");
      console.log("🌐  CORS habilitado para:");
      console.log("    - localhost:3000");
      console.log("    - localhost:5173");
      console.log("    - *.vercel.app (todos)");
      console.log("    - jebbs-dashboard.vercel.app");
      console.log("");
      console.log("🖨️  ========================================");
      console.log("");
    });
  });

// Manejar cierre graceful
process.on("SIGINT", () => {
  console.log("");
  console.log("👋 Cerrando servicio de impresión...");
  process.exit(0);
});
