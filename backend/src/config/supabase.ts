import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { creerFetchAvecDelai } from "../utils/fetchStockage";

const supabaseUrl = process.env.SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[supabase] Variables SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY non configurées — mode local/démo actif."
  );
}

if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as any).WebSocket = class WebSocket {
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  };
}

// Client "admin" côté serveur uniquement (clé service_role). Son `fetch` est borné : sans cela, un stockage figé
// laisserait la requête attendre jusqu'à ce que Vercel tue la fonction (voir utils/fetchStockage.ts).
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: creerFetchAvecDelai() },
});

/** Adresse du stockage (hôte compris) : sert à reconnaître nos propres URL publiques. */
export const SUPABASE_URL_EFFECTIVE = supabaseUrl;

export const STORAGE_BUCKETS = {
  // Bucket public : images de biens et photos d'incidents (peu sensibles,
  // affichées directement dans l'app sans authentification supplémentaire).
  public: process.env.SUPABASE_PUBLIC_BUCKET ?? "public-uploads",
  // Bucket privé : pièces d'identité des locataires — accès uniquement via
  // URL signée à durée limitée, générée à la demande pour le gestionnaire.
  private: process.env.SUPABASE_PRIVATE_BUCKET ?? "private-uploads",
} as const;
