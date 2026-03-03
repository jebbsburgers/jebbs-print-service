import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import printRoutes from "./routes/print";

// ============================================
// DETECTAR ENTORNO PRIMERO
// ============================================
const isPkg = typeof (process as any).pkg !== "undefined";

// Cargar .env desde la ubicación correcta
const envPath = isPkg
  ? path.join(path.dirname(process.execPath), ".env")
  : path.join(__dirname, "..", ".env");

dotenv.config({ path: envPath });

console.log("🔧 Env path:", envPath);
console.log("🖨️  Printer:", process.env.PRINTER_NAME); // Para verificar

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

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "jebbs-print-service",
    version: "1.0.0",
    mode: isPkg ? "production" : "development",
    port: PORT,
  });
});

// ============================================
// ROUTES
// ============================================

app.use("/print", printRoutes);

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

app.listen(PORT, () => {
  console.log("");
  console.log("🖨️  ========================================");
  console.log("🍔  JEBBS BURGERS - PRINT SERVICE");
  console.log("🖨️  ========================================");
  console.log("");
  console.log(`✅  Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📁  Assets: ${assetsPath}`);
  console.log(`🔧  Modo: ${isPkg ? "PRODUCCIÓN (EXE)" : "DESARROLLO"}`);
  console.log("");
  console.log("📡  Endpoints disponibles:");
  console.log(`    GET  http://localhost:${PORT}/health`);
  console.log(`    POST http://localhost:${PORT}/print/:orderId`);
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

// Manejar cierre graceful
process.on("SIGINT", () => {
  console.log("");
  console.log("👋 Cerrando servicio de impresión...");
  process.exit(0);
});
