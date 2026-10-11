import crypto from "crypto";
import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

/**
 * Magasin de compteurs d'express-rate-limit adossé à la base de données.
 *
 * Pourquoi. Le magasin par défaut compte en mémoire de l'instance. Sur Vercel,
 * chaque requête peut tomber sur une instance différente, et chaque démarrage à
 * froid repart de zéro : la limite de tentatives de connexion (8 par email et
 * par fenêtre) était donc contournable par le simple fait que les requêtes
 * s'étalent sur plusieurs instances — le nombre de tentatives réellement
 * possibles était multiplié par le nombre d'instances actives. Ici le compteur
 * est partagé : toutes les instances lisent et incrémentent la même ligne.
 *
 * Fonctionnement. Une seule requête SQL atomique par tentative (INSERT … ON
 * CONFLICT DO UPDATE) : pas de course entre deux instances qui comptent en même
 * temps, et la remise à zéro de la fenêtre est décidée PAR LA BASE (now() de la
 * base), jamais par l'horloge d'une instance.
 *
 * Confidentialité. La clé stockée est l'empreinte SHA-256 de « préfixe + clé » :
 * ni l'adresse email visée ni l'IP n'apparaissent en clair dans la table.
 *
 * Panne de la base. Un compteur indisponible ne doit ni bloquer les connexions
 * ni les laisser sans aucune limite : en cas d'erreur, le magasin retombe sur un
 * compteur en mémoire (le comportement d'avant) et journalise l'incident.
 */
export class PostgresRateLimitStore implements Store {
  // Les clés sont partagées entre les instances du serveur.
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 15 * 60 * 1000;
  private readonly repli = new MemoryStore();

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.repli.init(options);
  }

  private cle(cle: string): string {
    return crypto.createHash("sha256").update(`${this.prefix}:${cle}`).digest("hex");
  }

  async increment(cle: string): Promise<ClientRateLimitInfo> {
    try {
      const secondes = Math.max(1, Math.ceil(this.windowMs / 1000));
      const resultat = await db.execute(sql`
        INSERT INTO rate_limit_hits (cle, hits, reset_at)
        VALUES (${this.cle(cle)}, 1, now() + make_interval(secs => ${secondes}))
        ON CONFLICT (cle) DO UPDATE SET
          hits = CASE WHEN rate_limit_hits.reset_at <= now() THEN 1 ELSE rate_limit_hits.hits + 1 END,
          reset_at = CASE WHEN rate_limit_hits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limit_hits.reset_at END
        RETURNING hits, reset_at
      `);
      const ligne = lignes<{ hits: number; reset_at: Date | string }>(resultat)[0];
      if (!ligne) throw new Error("aucune ligne renvoyée par le compteur");
      return { totalHits: Number(ligne.hits), resetTime: new Date(ligne.reset_at) };
    } catch (err) {
      console.error(`[rate-limit:${this.prefix}] compteur en base indisponible, repli sur la mémoire de l'instance :`, err);
      return this.repli.increment(cle);
    }
  }

  async decrement(cle: string): Promise<void> {
    try {
      await db.execute(sql`UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0) WHERE cle = ${this.cle(cle)}`);
    } catch {
      await this.repli.decrement(cle);
    }
  }

  async resetKey(cle: string): Promise<void> {
    try {
      await db.execute(sql`DELETE FROM rate_limit_hits WHERE cle = ${this.cle(cle)}`);
    } catch {
      await this.repli.resetKey(cle);
    }
  }

  async get(cle: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      const resultat = await db.execute(
        sql`SELECT hits, reset_at FROM rate_limit_hits WHERE cle = ${this.cle(cle)} AND reset_at > now()`
      );
      const ligne = lignes<{ hits: number; reset_at: Date | string }>(resultat)[0];
      return ligne ? { totalHits: Number(ligne.hits), resetTime: new Date(ligne.reset_at) } : undefined;
    } catch {
      return this.repli.get(cle);
    }
  }
}

/** Les lignes d'un résultat, que le pilote renvoie un tableau (postgres-js) ou `{ rows }` (PGlite). */
function lignes<T>(resultat: unknown): T[] {
  const r = resultat as { rows?: T[] } & T[];
  return r.rows ?? (Array.isArray(r) ? r : []);
}
