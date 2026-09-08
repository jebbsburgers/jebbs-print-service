import dotenv from "dotenv";
import path from "path";

const isPkg = typeof (process as any).pkg !== "undefined";

// Carpeta donde vive todo lo configurable de esta instancia: el .env de
// siempre, y ahora tambien printer-config.json (src/config/printer-
// config.ts). Empaquetado: al lado del .exe. Dev: raiz del repo.
export const CONFIG_DIR = isPkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..", "..");

const envPath = path.join(CONFIG_DIR, ".env");

dotenv.config({ path: envPath });

export const ENV_PATH = envPath;
export const IS_PKG = isPkg;
