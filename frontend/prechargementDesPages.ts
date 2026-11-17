/**
 * Préchargement de la page et de ses textes, annoncé dès le HTML (branché sur le build dans vite.config.ts), isolé ici pour pouvoir être testé.
 *
 * Le problème : la page d'une adresse est un fichier à part (React.lazy), que le navigateur ne découvre qu'une fois le code principal TÉLÉCHARGÉ
 * ET EXÉCUTÉ — mesuré, sur une connexion lente, à 1,8 s alors que le HTML est arrivé à 0,3 s. Pour une langue autre que le français, un deuxième
 * saut s'y ajoute : les textes de la langue se chargent avant même l'affichage de l'application.
 *
 * La solution : un petit script d'aide, chargé sans bloquer la page (`async`) dès l'analyse du HTML, qui lit l'adresse et ajoute les
 * `<link rel="modulepreload">` de la bonne page et de la bonne langue. Un fichier à part plutôt qu'un script dans le HTML : la politique de sécurité
 * de contenu (vercel.json) n'autorise pas les scripts incorporés, et chaque page vue enverrait un rapport de violation.
 *
 * Les routes viennent d'App.tsx lui-même (aucune table à tenir à jour à la main) ; si la lecture ne trouve plus ce qu'elle attend, le build ÉCHOUE
 * plutôt que de laisser le préchargement disparaître en silence.
 */

/** Les langues autres que le français : leur adresse porte un préfixe (« /en ») et leurs textes sont des fichiers à part. */
const LANGUES_PREFIXEES = ["en", "es", "pt"] as const;
/** Clé mémorisée du choix de langue (voir i18n/index.ts, `lookupLocalStorage`). */
const CLE_LANGUE = "app_language";
/** Indice de session ouverte (voir utils/sessionLocale.ts) : un visiteur connecté n'affiche pas l'accueil, il est redirigé. */
const CLE_SESSION = "hasSession";

export interface RoutePage {
  /** Adresse, avec ses paramètres « :id » éventuels. */
  chemin: string;
  /** Chemin du fichier de la page sous src/, sans extension (« pages/LandingPage »). */
  page: string;
  /** Zones de textes que la page charge (voir lazyAvecZones). */
  zones: string[];
}

/**
 * Les routes d'App.tsx qui affichent une page chargée à la demande : `const X = lazyAvecZones(() => import("./pages/X"), ["z"])` puis
 * `<Route path="/x" element={<X />} />`. L'accueil (« / ») est à part : il affiche la page d'accueil à un visiteur non connecté, via HomeRedirect.
 */
export function routesDepuisApp(source: string): RoutePage[] {
  const pages = new Map<string, { page: string; zones: string[] }>();
  const declaration = /const (\w+) = lazy(?:AvecZones|WithReload)\(\(\) => import\("\.\/([^"]+)"\)(?:, \[([^\]]*)\])?\)/g;
  for (const m of source.matchAll(declaration)) {
    const zones = (m[3] ?? "").split(",").map((z) => z.trim().replace(/^"|"$/g, "")).filter(Boolean);
    pages.set(m[1], { page: m[2], zones });
  }

  const routes: RoutePage[] = [];
  const dejaVus = new Set<string>();
  const route = /<Route path="(\/[^"]*)" element=\{<(\w+) \/>\}/g;
  for (const m of source.matchAll(route)) {
    const nom = m[2] === "HomeRedirect" ? "LandingPage" : m[2];
    const page = pages.get(nom);
    if (!page || dejaVus.has(m[1])) continue;
    dejaVus.add(m[1]);
    routes.push({ chemin: m[1], page: page.page, zones: page.zones });
  }
  return routes;
}

/** Ce qu'il faut pour produire le préchargement : les fichiers du build, en ne gardant que ce qui sert. */
export interface FichierBuild {
  type: "chunk" | "asset";
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
  modules?: Record<string, unknown>;
}
export type SortieBuild = Record<string, FichierBuild>;

/** Les fichiers à télécharger pour afficher une page : le sien et ceux qu'il importe, sauf ce que le code principal charge déjà. */
function avecDependances(sortie: SortieBuild, fichier: string, deja: Set<string>, resultat: string[]) {
  if (deja.has(fichier)) return;
  deja.add(fichier);
  resultat.push(fichier);
  for (const dependance of sortie[fichier]?.imports ?? []) avecDependances(sortie, dependance, deja, resultat);
}

/** Le fichier du build qui contient ce module source (sa « façade », à défaut tout fichier qui l'embarque). */
function fichierDuModule(sortie: SortieBuild, module: string): string | undefined {
  const entrees = Object.entries(sortie).filter(([, f]) => f.type === "chunk");
  const facade = entrees.find(([, f]) => f.facadeModuleId?.replace(/\\/g, "/").endsWith(module));
  if (facade) return facade[0];
  return entrees.find(([, f]) => Object.keys(f.modules ?? {}).some((id) => id.replace(/\\/g, "/").endsWith(module)))?.[0];
}

export interface TablePrechargement {
  /** Tous les fichiers cités, chacun une fois (le reste de la table y renvoie par numéro : le script reste court). */
  fichiers: string[];
  /** Pour chaque route : l'expression de l'adresse, les fichiers de la page, et les zones de textes à charger. */
  routes: Array<{ expression: string; page: number[]; zones: string[] }>;
  /** Par langue, puis par zone (« base » comprise pour les langues autres que le français) : les fichiers de textes. */
  langues: Record<string, Record<string, number[]>>;
}

/** L'adresse d'une route en expression régulière (« /vitrine/annonces/:id » → « ^/vitrine/annonces/[^/]+$ »). */
function expressionDeLaRoute(chemin: string): string {
  const corps = chemin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]\w*/g, "[^/]+");
  return `^${corps}$`;
}

export function construireTable(sortie: SortieBuild, routes: RoutePage[], zonesConnues: readonly string[]): TablePrechargement {
  const entree = Object.entries(sortie).find(([, f]) => f.type === "chunk" && f.isEntry)?.[0];
  // Ce que le code principal charge déjà (et que Vite annonce lui-même) : inutile de le précharger une deuxième fois.
  const dejaCharges = new Set<string>();
  if (entree) avecDependances(sortie, entree, dejaCharges, []);

  const fichiers: string[] = [];
  const numero = (fichier: string) => {
    const i = fichiers.indexOf(fichier);
    if (i >= 0) return i;
    fichiers.push(fichier);
    return fichiers.length - 1;
  };
  const numeros = (fichier: string | undefined): number[] => {
    if (!fichier) return [];
    const liste: string[] = [];
    avecDependances(sortie, fichier, new Set(dejaCharges), liste);
    return liste.map(numero);
  };

  const table: TablePrechargement = { fichiers, routes: [], langues: {} };
  for (const r of routes) {
    const page = numeros(fichierDuModule(sortie, `/src/${r.page}.tsx`));
    if (page.length > 0) table.routes.push({ expression: expressionDeLaRoute(r.chemin), page, zones: r.zones });
  }
  for (const langue of ["fr", ...LANGUES_PREFIXEES]) {
    const parZone: Record<string, number[]> = {};
    // La base française est dans le code principal ; celles des autres langues sont des fichiers à part.
    for (const zone of langue === "fr" ? zonesConnues : ["base", ...zonesConnues]) {
      const liste = numeros(fichierDuModule(sortie, `/src/i18n/locales/zones/${langue}/${zone}.ts`));
      if (liste.length > 0) parZone[zone] = liste;
    }
    table.langues[langue] = parZone;
  }
  return table;
}

/**
 * Le script d'aide (JavaScript classique, sans module : il doit s'exécuter dès son arrivée, avant le code principal). Il ne fait RIEN d'autre
 * qu'ajouter des `<link rel="modulepreload">` : toute erreur est sans conséquence, la page se charge alors comme avant.
 */
export function genererScript(table: TablePrechargement): string {
  return `(function(){try{
var F=${JSON.stringify(table.fichiers)},R=${JSON.stringify(table.routes.map((r) => [r.expression, r.page, r.zones]))},Z=${JSON.stringify(table.langues)};
var p=location.pathname,lg="fr",m=/^\\/(${LANGUES_PREFIXEES.join("|")})(\\/vitrine)?\\/?$/.exec(p);
if(m){lg=m[1];p=m[2]||"/"}else{try{var s=localStorage.getItem("${CLE_LANGUE}");if(s==="${LANGUES_PREFIXEES.join('"||s==="')}")lg=s}catch(e){}}
if(p.length>1)p=p.replace(/\\/$/,"");
if(p==="/"){try{if(localStorage.getItem("${CLE_SESSION}"))return}catch(e){}}
var r=null;for(var i=0;i<R.length;i++){if(new RegExp(R[i][0]).test(p)){r=R[i];break}}
if(!r)return;
var vus={};function ajouter(liste){for(var k=0;k<liste.length;k++){var h="/"+F[liste[k]];if(vus[h])continue;vus[h]=1;var l=document.createElement("link");l.rel="modulepreload";l.href=h;document.head.appendChild(l)}}
ajouter(r[1]);
var z=Z[lg]||{};if(z.base)ajouter(z.base);
for(var j=0;j<r[2].length;j++){if(z[r[2][j]])ajouter(z[r[2][j]])}
}catch(e){}})();`;
}

/** Ajoute la balise du script d'aide à la fin du `<head>` du HTML. `async` : il ne retarde jamais l'affichage. */
export function injecterDansLeHtml(html: string, adresseDuScript: string): string {
  const balise = `<script async src="${adresseDuScript}"></script>`;
  return html.includes("</head>") ? html.replace("</head>", `    ${balise}\n  </head>`) : html + balise;
}
