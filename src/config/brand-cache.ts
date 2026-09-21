import fs from "fs";
import path from "path";
import { CONFIG_DIR } from "./env";
import { supabase } from "../supabase";

interface BrandCache {
  business_name: string;
  logo_url: string | null; // URL original en Supabase Storage -- se guarda
                            // para poder comparar "¿cambió respecto a la
                            // última vez que bajé algo?" en el próximo
                            // refresh. logo_path (abajo) es siempre un path
                            // LOCAL fijo, nunca sirve para esa comparación.
  logo_path: string | null; // ruta LOCAL a un PNG ya descargado, nunca una URL
  cached_at: string; // ISO
}

const CACHE_PATH = path.join(CONFIG_DIR, "brand-cache.json");
const LOGO_CACHE_PATH = path.join(CONFIG_DIR, "cached-logo.png");
const STALE_AFTER_MS = 5 * 60 * 1000; // mismo staleTime que usa el dashboard
                                        // en lib/hooks/use-app-settings.ts,
                                        // por consistencia -- no hay ninguna
                                        // razón técnica para que difieran.
const FETCH_TIMEOUT_MS = 3000;

// Fallback de último recurso: los valores que este repo usó SIEMPRE antes de
// esta feature, hardcodeados en thermal-printer.ts. Si Supabase no responde,
// no hay fila, o esta es la primera vez que corre el proceso y todavía no
// hay red, el ticket sale exactamente como salía antes -- nunca en blanco,
// nunca rompe la impresión.
const FALLBACK_BUSINESS_NAME = "JEBBS BURGERS";
const FALLBACK_LOGO_PATH = path.join(__dirname, "..", "..", "assets", "logo.png");

// Selección actual en memoria -- fuente de verdad para lecturas rápidas,
// igual que `current` en printer-config.ts. Se lee EN EL MOMENTO de
// imprimir, nunca se recalcula por adelantado.
let current: BrandCache | null = null;
let refreshInFlight: Promise<void> | null = null;

function readCacheFile(): BrandCache | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.business_name !== "string" || !parsed.cached_at) {
      console.warn("⚠️  brand-cache.json con forma inesperada, se ignora.");
      return null;
    }
    return parsed as BrandCache;
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn("⚠️  No se pudo leer brand-cache.json:", err?.message ?? err);
    }
    return null;
  }
}

function writeCacheFile(cache: BrandCache): void {
  // Escritura atómica: a un temp primero, rename después. writeFileSync
  // directo puede dejar el archivo truncado si el proceso muere a mitad
  // de escritura -- rename es atómico en NTFS, esto no.
  const tmpPath = `${CACHE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), "utf-8");
  fs.renameSync(tmpPath, CACHE_PATH);
}

// Se llama una vez al arrancar, desde index.ts -- carga lo que haya en disco
// a memoria SIN pegarle a la red (igual que loadPrinterConfig). Si no hay
// nada en disco todavía, `current` queda null y getBrandSettings() hace el
// primer intento síncrono la próxima vez que se llame.
export function loadBrandCache(): void {
  current = readCacheFile();
}

async function fetchAndCache(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // .abortSignal() va ANTES de .single(): .single() angosta el tipo de
    // retorno a PostgrestBuilder, que ya no expone .abortSignal() -- el
    // orden importa para que esto tipe.
    const { data, error } = await supabase
      .from("app_settings")
      .select("business_name, logo_url")
      .eq("id", 1)
      .abortSignal(controller.signal)
      .single();
    if (error || !data) throw error ?? new Error("Sin fila en app_settings");

    let logoPath = current?.logo_path ?? null;
    if (data.logo_url && data.logo_url !== current?.logo_url) {
      // Descargar el logo SOLO si la URL cambió respecto a la última vez.
      // Se descarga a un .tmp primero y se renombra recién al final -- un
      // logo a medio bajar (corte de red a mitad de descarga) nunca queda
      // referenciado desde el cache.
      const response = await fetch(data.logo_url, { signal: controller.signal });
      if (!response.ok) throw new Error(`No se pudo bajar el logo: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const tmpPath = `${LOGO_CACHE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, LOGO_CACHE_PATH);
      logoPath = LOGO_CACHE_PATH;
    } else if (!data.logo_url) {
      logoPath = null; // el dueño sacó el logo custom -- volver al fallback bundled
    }

    const next: BrandCache = {
      business_name: data.business_name || FALLBACK_BUSINESS_NAME,
      logo_url: data.logo_url ?? null,
      logo_path: logoPath,
      cached_at: new Date().toISOString(),
    };
    current = next;
    writeCacheFile(next);
  } catch (err: any) {
    console.warn("⚠️  No se pudo actualizar la marca desde Supabase:", err?.message ?? err);
    // No tocar `current` -- si había algo cacheado, se sigue usando. Si no
    // había nada (primer arranque sin red), getBrandSettings() cae al
    // fallback hardcodeado más abajo.
  } finally {
    clearTimeout(timeout);
  }
}

// Se llama en CADA impresión, desde thermal-printer.ts, justo antes de armar
// el ticket. Nunca bloquea más de lo estrictamente necesario:
//  - primer arranque, sin cache todavía: espera UN intento (con timeout de
//    3s) antes de imprimir, porque no hay nada mejor que mostrar.
//  - ya hay cache fresco (<5 min): devuelve al instante, cero red.
//  - hay cache pero está viejo (>5 min): devuelve el cache YA MISMO (el
//    ticket que se está imprimiendo ahora no espera nada) y dispara un
//    refresh en segundo plano para la PRÓXIMA impresión -- fire-and-forget,
//    con protección contra refrescos superpuestos si dos tickets se piden
//    juntos (`refreshInFlight`).
export async function getBrandSettings(): Promise<{ business_name: string; logo_path: string }> {
  if (!current) {
    await fetchAndCache(); // primer arranque: un intento, bloqueante, con timeout
  } else {
    const age = Date.now() - new Date(current.cached_at).getTime();
    if (age > STALE_AFTER_MS && !refreshInFlight) {
      refreshInFlight = fetchAndCache().finally(() => {
        refreshInFlight = null;
      });
      // fire-and-forget a propósito -- no `await` acá.
    }
  }

  return {
    business_name: current?.business_name || FALLBACK_BUSINESS_NAME,
    logo_path:
      current?.logo_path && fs.existsSync(current.logo_path)
        ? current.logo_path
        : FALLBACK_LOGO_PATH,
  };
}
