import { beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.fn();
vi.mock("../config/supabase", () => ({
  supabaseAdmin: { storage: { from: () => ({ download }) } },
  STORAGE_BUCKETS: { public: "public-uploads", private: "private-uploads" },
  SUPABASE_URL_EFFECTIVE: "https://abc.supabase.co",
}));

import { chargerLogoAgence, estUrlPubliqueDuStockage } from "./storage.service";

const NOTRE_URL = "https://abc.supabase.co/storage/v1/object/public/public-uploads/agency/logo.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const blob = (octets: Buffer) => ({ arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.length) });

describe("estUrlPubliqueDuStockage", () => {
  it("n'accepte que l'URL publique de NOTRE bucket, sur NOTRE hôte", () => {
    expect(estUrlPubliqueDuStockage(NOTRE_URL)).toBe(true);
    expect(estUrlPubliqueDuStockage("https://tiers.example/storage/v1/object/public/public-uploads/agency/logo.png")).toBe(false);
    expect(estUrlPubliqueDuStockage("https://abc.supabase.co/storage/v1/object/public/autre-bucket/logo.png")).toBe(false);
    expect(estUrlPubliqueDuStockage("https://abc.supabase.co/logo.png")).toBe(false);
    expect(estUrlPubliqueDuStockage("pas une url")).toBe(false);
    expect(estUrlPubliqueDuStockage(null)).toBe(false);
  });
});

describe("chargerLogoAgence", () => {
  beforeEach(() => download.mockReset());

  it("renvoie les octets d'un PNG de notre stockage, téléchargés par chemin d'objet", async () => {
    download.mockResolvedValueOnce({ data: blob(PNG), error: null });
    const octets = await chargerLogoAgence(NOTRE_URL);
    expect(octets?.equals(PNG)).toBe(true);
    expect(download).toHaveBeenCalledWith("agency/logo.png");
  });

  it("ne télécharge jamais une adresse qui n'est pas la nôtre", async () => {
    expect(await chargerLogoAgence("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(await chargerLogoAgence("https://tiers.example/logo.png")).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it("renvoie null, sans lever d'erreur, pour un objet introuvable, illisible ou qui n'est ni PNG ni JPEG", async () => {
    download.mockResolvedValueOnce({ data: null, error: { message: "absent" } });
    expect(await chargerLogoAgence(NOTRE_URL)).toBeNull();
    download.mockResolvedValueOnce({ data: blob(Buffer.from("<html>")), error: null });
    expect(await chargerLogoAgence(NOTRE_URL)).toBeNull();
    download.mockRejectedValueOnce(new Error("réseau"));
    expect(await chargerLogoAgence(NOTRE_URL)).toBeNull();
  });
});
