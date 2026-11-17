import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le portugais de l'application est celui du PORTUGAL (choix du propriétaire du produit), pas celui du Brésil : voir le test
 * jumeau du site (frontend/src/i18n/portugaisDuPortugal.test.ts). Les courriels, le compte rendu de gestion, le relevé annuel,
 * les notifications et le calendrier sont écrits ici, dans des fichiers qui contiennent AUSSI le français, l'anglais et l'espagnol :
 * on ne cherche donc que des mots qui n'existent dans aucune de ces trois langues (« aluguel », « você », « senha », « equipe »…).
 */
const FICHIERS = [
  "services/email.comptes.textes.ts",
  "services/email.suite.textes.ts",
  "services/email.locataire.textes.ts",
  "services/document.crg.textes.ts",
  "services/document.releveAnnuel.ts",
  "services/notification.textes.ts",
  "services/agendaIcal.textes.ts",
];

/** Mots du Brésil, absents du français, de l'anglais et de l'espagnol, avec leur équivalent du Portugal. */
const BRESILIENS: Array<[string, string]> = [
  ["aluguel|aluguéis", "renda / rendas"],
  ["você|vocês", "la forme sans pronom, ou « o utilizador »"],
  ["senhas?", "palavra-passe"],
  ["telas?", "ecrã"],
  ["equipes?", "equipa"],
  ["salvar|salve", "guardar"],
  ["cadastr\\w+", "registar"],
  ["contatos?|contatar", "contacto / contactar"],
  ["gerenci\\w+", "gerir"],
  ["somente", "apenas"],
  ["repass\\w+", "pagamento ao proprietário / entregar"],
  ["usuários?", "utilizador"],
  ["compartilh\\w+", "partilhar"],
  ["aplicativos?", "aplicação"],
  ["locação|locações|locatári[oa]s?", "arrendamento / inquilino"],
  ["detalhamento", "detalhe"],
  ["vinculad[oa]s?", "associado"],
  ["em andamento", "em curso"],
  ["aguardando|verificando|enviando|carregando", "« a aguardar », « a verificar »…"],
];

describe("textes portugais du serveur : celui du Portugal, pas celui du Brésil", () => {
  for (const fichier of FICHIERS) {
    it(`${fichier} n'emploie aucun mot du Brésil`, () => {
      const source = readFileSync(resolve(__dirname, fichier), "utf8");
      const trouves: string[] = [];
      for (const [motif, equivalent] of BRESILIENS) {
        const re = new RegExp(`(?<![\\p{L}])(?:${motif})(?![\\p{L}])`, "iu");
        source.split("\n").forEach((ligne, i) => {
          // Les commentaires expliquent le choix des tons (« vous », « usted », « você »…) : ils ne sont pas des textes affichés.
          if (/^\s*(\*|\/\/|\/\*)/.test(ligne)) return;
          if (re.test(ligne)) trouves.push(`ligne ${i + 1} : ${ligne.trim().slice(0, 100)} → écrire : ${equivalent}`);
        });
      }
      expect(trouves, `Mots du Brésil :\n${trouves.join("\n")}`).toEqual([]);
    });
  }
});
