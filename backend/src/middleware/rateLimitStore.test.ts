import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client";
import { rateLimitHits } from "../db/schema";
import { testDb } from "../test/setupTestDb";
import { PostgresRateLimitStore } from "./rateLimitStore";

/**
 * Les compteurs de tentatives de connexion étaient en MÉMOIRE de chaque
 * instance serverless : non partagés entre instances, remis à zéro à chaque
 * démarrage à froid. Un attaquant dont les requêtes s'étalaient sur plusieurs
 * instances disposait d'autant de fois plus de tentatives. Ces tests vérifient
 * que le compteur vit en base, donc le même pour toutes les instances.
 */
const FENETRE = 15 * 60 * 1000;

function magasin(prefixe = "auth-email") {
  const m = new PostgresRateLimitStore(prefixe);
  m.init({ windowMs: FENETRE } as never);
  return m;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("PostgresRateLimitStore", () => {
  it("compte les tentatives et annonce l'instant de remise à zéro (fenêtre de 15 minutes)", async () => {
    const m = magasin();
    const avant = Date.now();

    const a = await m.increment("email:cible@test.local");
    const b = await m.increment("email:cible@test.local");
    const c = await m.increment("email:cible@test.local");

    expect([a.totalHits, b.totalHits, c.totalHits]).toEqual([1, 2, 3]);
    // Même instant de remise à zéro pour toute la fenêtre.
    expect(b.resetTime!.getTime()).toBe(a.resetTime!.getTime());
    expect(a.resetTime!.getTime() - avant).toBeGreaterThan(FENETRE - 5_000);
    expect(a.resetTime!.getTime() - avant).toBeLessThan(FENETRE + 5_000);
  });

  it("PARTAGE le compteur entre instances : une autre instance voit les tentatives de la première", async () => {
    const instanceA = magasin();
    const instanceB = magasin(); // un autre démarrage à froid, une autre fonction serverless

    for (let i = 0; i < 5; i++) await instanceA.increment("email:cible@test.local");
    const vuParB = await instanceB.increment("email:cible@test.local");

    // En mémoire, B aurait répondu 1 : l'attaquant gagnait une série de tentatives par instance.
    expect(vuParB.totalHits).toBe(6);
  });

  it("garde les compteurs indépendants selon le préfixe et la clé", async () => {
    const parEmail = magasin("auth-email");
    const parIp = magasin("auth-ip");

    await parEmail.increment("clef-commune");
    await parEmail.increment("clef-commune");
    const ip = await parIp.increment("clef-commune");
    const autre = await parEmail.increment("une-autre-clef");

    expect(ip.totalHits).toBe(1);
    expect(autre.totalHits).toBe(1);
  });

  it("ne perd aucune tentative quand des requêtes arrivent en même temps (incrément atomique)", async () => {
    const m = magasin();

    const reponses = await Promise.all(Array.from({ length: 20 }, () => m.increment("email:rafale@test.local")));

    // Une mise à jour perdue ferait apparaître deux fois la même valeur ou un total inférieur à 20.
    expect(reponses.map((r) => r.totalHits).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("repart de 1 quand la fenêtre est écoulée, et fixe une nouvelle remise à zéro", async () => {
    const m = magasin();
    for (let i = 0; i < 4; i++) await m.increment("email:cible@test.local");
    // La fenêtre se termine il y a une minute.
    await testDb.execute(sql`UPDATE rate_limit_hits SET reset_at = now() - interval '1 minute'`);

    const apres = await m.increment("email:cible@test.local");

    expect(apres.totalHits).toBe(1);
    expect(apres.resetTime!.getTime()).toBeGreaterThan(Date.now() + FENETRE - 5_000);
  });

  it("ne stocke ni l'adresse email ni l'IP en clair : seulement une empreinte SHA-256", async () => {
    await magasin().increment("email:victime@test.local");
    await magasin("auth-ip").increment("203.0.113.7");

    const lignes = await testDb.select().from(rateLimitHits);
    expect(lignes).toHaveLength(2);
    for (const l of lignes) {
      expect(l.cle).toMatch(/^[0-9a-f]{64}$/);
      expect(l.cle).not.toContain("victime");
      expect(l.cle).not.toContain("203.0.113.7");
    }
  });

  it("get ne renvoie que les fenêtres encore ouvertes", async () => {
    const m = magasin();
    expect(await m.get("email:absent@test.local")).toBeUndefined();

    await m.increment("email:cible@test.local");
    await m.increment("email:cible@test.local");
    expect((await m.get("email:cible@test.local"))?.totalHits).toBe(2);

    await testDb.execute(sql`UPDATE rate_limit_hits SET reset_at = now() - interval '1 second'`);
    expect(await m.get("email:cible@test.local")).toBeUndefined();
  });

  it("decrement retire une tentative sans jamais passer sous zéro, resetKey efface le compteur", async () => {
    const m = magasin();
    await m.increment("k");
    await m.increment("k");

    await m.decrement("k");
    expect((await m.get("k"))?.totalHits).toBe(1);
    await m.decrement("k");
    await m.decrement("k");
    expect((await m.get("k"))?.totalHits).toBe(0);

    await m.resetKey("k");
    expect(await m.get("k")).toBeUndefined();
    expect(await testDb.select().from(rateLimitHits)).toHaveLength(0);
  });

  it("annonce un compteur partagé entre instances (localKeys = false)", () => {
    expect(magasin().localKeys).toBe(false);
  });

  /**
   * Un compteur indisponible ne doit ni bloquer les connexions ni les laisser
   * sans aucune limite : repli sur un compteur en mémoire, avec journalisation.
   */
  it("retombe sur un compteur en mémoire quand la base est indisponible, sans lever d'erreur", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "execute").mockRejectedValue(new Error("base injoignable"));
    const m = magasin();

    // Le compteur de repli renvoie un objet mutable : on relève la valeur tout de suite.
    const a = (await m.increment("email:cible@test.local")).totalHits;
    const b = (await m.increment("email:cible@test.local")).totalHits;
    await m.decrement("email:cible@test.local");
    expect((await m.get("email:cible@test.local"))?.totalHits).toBe(1);
    await m.resetKey("email:cible@test.local");
    expect(await m.get("email:cible@test.local")).toBeUndefined();

    // Un compteur en mémoire continue de limiter, même base en panne.
    expect([a, b]).toEqual([1, 2]);
    expect(journal).toHaveBeenCalled();
    expect(await testDb.select().from(rateLimitHits).where(eq(rateLimitHits.hits, 1))).toHaveLength(0);
  });
});
