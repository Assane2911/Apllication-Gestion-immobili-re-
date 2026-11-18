import { describe, expect, it } from "vitest";
import pt from "./locales/pt";

/**
 * Le portugais de l'application est celui du PORTUGAL (choix du propriétaire du produit), pas celui du Brésil. Les deux
 * s'écrivent presque pareil, mais une poignée de mots trahissent le Brésil et se voient tout de suite d'un lecteur portugais :
 * « aluguel » (renda), « você » (o utilizador, ou la forme sans pronom), « senha » (palavra-passe), « tela » (ecrã), « equipe »
 * (equipa), « excluir » (eliminar), « salvar » (guardar), « cadastrar » (registar), « contato » (contacto), « exibir » (mostrar)…
 *
 * Ce test refuse ces mots dans les textes portugais du site. Le serveur a le sien (backend/src/textesPortugaisDuPortugal.test.ts)
 * pour les courriels et les documents. Le mot est cherché entier, sans tenir compte de la casse.
 */
type Arbre = { [cle: string]: string | Arbre };

function textes(objet: Arbre, prefixe = ""): Array<[string, string]> {
  return Object.entries(objet).flatMap(([cle, valeur]) => {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    return typeof valeur === "string" ? [[chemin, valeur] as [string, string]] : textes(valeur, chemin);
  });
}

/** Mots du portugais du Brésil, avec leur équivalent du Portugal. */
const BRESILIENS: Array<[string, string]> = [
  ["aluguel|aluguéis|alugueis", "renda / rendas"],
  ["você|vocês", "a forme sans pronom (« Já assinou »), ou « o utilizador »"],
  ["senhas?", "palavra-passe"],
  ["telas?", "ecrã"],
  ["equipes?", "equipa"],
  ["excluir|excluído|excluída|exclusão", "eliminar"],
  ["salvar|salve|salvo", "guardar"],
  ["cadastr\\w+", "registar / registado"],
  ["contatos?|contatar", "contacto / contactar"],
  ["exib\\w+", "mostrar / apresentar"],
  ["gerenci\\w+", "gerir / gestão"],
  ["somente", "apenas"],
  ["repass\\w+", "pagamento ao proprietário / entregar"],
  ["usuários?|usuária", "utilizador"],
  ["celular(es)?", "telemóvel"],
  ["baixar|baixe", "descarregar"],
  ["compartilh\\w+", "partilhar"],
  ["aplicativos?", "aplicação"],
  ["cômodos?", "divisão / divisões"],
  ["medidor(es)?", "contador / contadores"],
  ["locação|locações|locatári[oa]s?", "arrendamento / inquilino"],
  ["em andamento", "em curso"],
  ["aguardando|verificando|enviando|carregando", "« a aguardar », « a verificar », « a enviar », « a carregar »"],
  ["registrad[oa]s?", "registado / registada"],
];

describe("portugais : celui du Portugal, pas celui du Brésil", () => {
  const traductions = textes(pt as unknown as Arbre);

  it("le parcours trouve bien les textes portugais", () => {
    expect(traductions.length).toBeGreaterThan(2000);
  });

  for (const [motif, equivalent] of BRESILIENS) {
    it(`aucun texte n'emploie « ${motif.replace(/\\w\+/g, "…")} » (écrire : ${equivalent})`, () => {
      const re = new RegExp(`(?<![\\p{L}])(?:${motif})(?![\\p{L}])`, "iu");
      const trouves = traductions.filter(([, texte]) => re.test(texte)).map(([cle, texte]) => `${cle} = « ${texte.slice(0, 90)} »`);
      expect(trouves, `Mots du Brésil :\n${trouves.join("\n")}`).toEqual([]);
    });
  }
});
