import { Building2, Download, FileText, FileUp, Users, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, messageDuServeur } from "../../api/client";

type TypeImport = "properties" | "tenants" | "contracts";
type StatutLigne = "OK" | "DOUBLON" | "ERREUR";

interface LigneAnalysee {
  ligne: number;
  statut: StatutLigne;
  messages: string[];
  /** Même rang que `messages` : le code (et ses valeurs) que l'interface traduit ; absent d'un ancien serveur. */
  details?: Array<{ code: string; params?: Record<string, string | number> }>;
  donnees: Record<string, string | number | null>;
}

interface Analyse {
  type: TypeImport;
  lignes: LigneAnalysee[];
  resume: { total: number; valides: number; doublons: number; erreurs: number };
  capacite?: { maximum: number | null; existants: number; restant: number | null };
  importees?: number;
}

const STYLES_STATUT: Record<StatutLigne, string> = {
  OK: "border-emerald-300 bg-emerald-50 text-emerald-800",
  DOUBLON: "border-orange-700/50 bg-orange-50 text-orange-800",
  ERREUR: "border-rose-300 bg-rose-50 text-rose-800",
};

/** Filet de couleur de chaque case du résumé. */
const FILETS_RESUME: Record<string, string> = {
  total: "border-t-slate-400",
  valid: "border-t-emerald-600",
  duplicates: "border-t-orange-700",
  errors: "border-t-rose-600",
};

const ICONES_TYPE: Record<TypeImport, LucideIcon> = { properties: Building2, tenants: Users, contracts: FileText };

/** Lecture du fichier en UTF-8 (FileReader : valable sur tous les navigateurs, y compris anciens). */
function lireFichier(fichier: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(String(lecteur.result ?? ""));
    lecteur.onerror = () => reject(lecteur.error ?? new Error("Lecture du fichier impossible"));
    lecteur.readAsText(fichier, "utf-8");
  });
}

/** Résumé lisible d'une ligne analysée, selon le type de fichier. */
function libelleLigne(type: TypeImport, d: LigneAnalysee["donnees"]): string {
  if (type === "properties") return [d.title, d.address].filter(Boolean).join(" — ");
  if (type === "contracts") return [d.property, d.tenantEmail].filter(Boolean).join(" — ");
  return [[d.firstName, d.lastName].filter(Boolean).join(" "), d.email].filter(Boolean).join(" — ");
}

const NOMS_FICHIER: Record<TypeImport, string> = { properties: "biens", tenants: "locataires", contracts: "contrats" };
const PAGES_LISTE: Record<TypeImport, string> = { properties: "/properties", tenants: "/tenants", contracts: "/contracts" };

/**
 * Migration depuis un tableur : le gestionnaire dépose un CSV de biens ou de
 * locataires, vérifie l'aperçu ligne par ligne (erreurs expliquées, doublons
 * repérés), puis importe les lignes valides. Rien n'est écrit avant la
 * confirmation, et un fichier importé deux fois ne crée rien la seconde fois.
 */
export default function ImportPage() {
  const { t } = useTranslation();
  const [type, setType] = useState<TypeImport>("properties");
  const [csv, setCsv] = useState<string | null>(null);
  const [nomFichier, setNomFichier] = useState("");
  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [resultat, setResultat] = useState<Analyse | null>(null);
  const [encodageSuspect, setEncodageSuspect] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [import_, setImport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const champFichier = useRef<HTMLInputElement>(null);

  function reinitialiser() {
    setCsv(null);
    setNomFichier("");
    setAnalyse(null);
    setResultat(null);
    setEncodageSuspect(false);
    setError(null);
    if (champFichier.current) champFichier.current.value = "";
  }

  function changerType(nouveau: TypeImport) {
    setType(nouveau);
    reinitialiser();
  }

  async function telechargerModele() {
    try {
      const res = await api.get(`/import/modele/${type}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = `modele-import-${NOMS_FICHIER[type]}.csv`;
      lien.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const [survolZone, setSurvolZone] = useState(false);

  function choisirFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (fichier) void traiterFichier(fichier);
  }

  /** Dépôt d'un fichier sur la zone : même traitement qu'un choix par le sélecteur. */
  function deposerFichier(e: React.DragEvent) {
    e.preventDefault();
    setSurvolZone(false);
    const fichier = e.dataTransfer.files?.[0];
    if (fichier) void traiterFichier(fichier);
  }

  async function traiterFichier(fichier: File) {
    setError(null);
    setResultat(null);
    setAnalyse(null);
    setNomFichier(fichier.name);
    setChargement(true);
    try {
      const texte = await lireFichier(fichier);
      // Un CSV enregistré en ANSI (Excel ancien) donne « � » à la place des accents.
      setEncodageSuspect(texte.includes("�"));
      setCsv(texte);
      const { data } = await api.post<Analyse>("/import/preview", { type, csv: texte });
      setAnalyse(data);
    } catch (err) {
      setCsv(null);
      setError(apiErrorMessage(err));
    } finally {
      setChargement(false);
    }
  }

  async function importer() {
    if (!csv || import_) return;
    setImport(true);
    setError(null);
    try {
      const { data } = await api.post<Analyse>("/import", { type, csv });
      setResultat(data);
      setAnalyse(null);
      setCsv(null);
      if (champFichier.current) champFichier.current.value = "";
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setImport(false);
    }
  }

  const libelleType = t(`manager.import.types.${type}`).toLowerCase();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("manager.import.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("manager.import.subtitle")}</p>
      </div>

      {/* Quoi importer : trois grandes cases, une par type de fichier. */}
      <div role="radiogroup" aria-label={t("manager.import.typeLabel")} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(["properties", "tenants", "contracts"] as const).map((valeur) => {
          const Icone = ICONES_TYPE[valeur];
          const actif = type === valeur;
          return (
            <button
              key={valeur}
              type="button"
              role="radio"
              aria-checked={actif}
              onClick={() => changerType(valeur)}
              className={`flex cursor-pointer items-center gap-3 border px-4 py-3.5 text-left text-sm font-semibold transition-colors ${
                actif
                  ? "border-ink-900 bg-ink-900 text-white shadow-[inset_4px_0_0_var(--color-orange-700)]"
                  : "border-slate-400 bg-white text-slate-800 hover:border-ink-900 hover:bg-slate-50"
              }`}
            >
              <Icone size={20} aria-hidden="true" className={actif ? "text-white" : "text-ink-900"} />
              {t(`manager.import.types.${valeur}`)}
            </button>
          );
        })}
      </div>

      {/* Comment : trois étapes numérotées, la troisième porte la zone de dépôt. */}
      <ol className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <li className="border border-slate-300 bg-white p-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">01</p>
          <p className="mt-2 text-sm text-slate-800">{t("manager.import.step1")}</p>
          <button
            type="button"
            onClick={telechargerModele}
            className="mt-3 inline-flex cursor-pointer items-center gap-1.5 border border-ink-900 bg-white px-3 py-1.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white"
          >
            <Download size={13} aria-hidden="true" /> {t("manager.import.downloadTemplate")}
          </button>
        </li>
        <li className="border border-slate-300 bg-white p-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">02</p>
          <p className="mt-2 text-sm text-slate-800">{t("manager.import.step2")}</p>
        </li>
        <li className="border border-slate-300 bg-white p-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">03</p>
          <p className="mt-2 text-sm text-slate-800">{t("manager.import.step3")}</p>
        </li>
      </ol>

      {/* Colonnes attendues, en police technique : c'est la partie à recopier dans le tableur. */}
      <div className="border-l-2 border-orange-700 bg-white px-4 py-3">
        <p className="font-mono text-xs leading-relaxed text-slate-800">{t(`manager.import.columns.${type}`)}</p>
        {type === "contracts" && <p className="mt-2 text-xs leading-relaxed text-slate-700">{t("manager.import.contractsNote")}</p>}
      </div>

      {/* Zone de dépôt : on peut y glisser le fichier ou cliquer pour le choisir. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setSurvolZone(true);
        }}
        onDragLeave={() => setSurvolZone(false)}
        onDrop={deposerFichier}
        className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed px-4 py-8 text-center transition-colors ${
          survolZone ? "border-orange-700 bg-orange-50" : "border-slate-400 bg-white"
        }`}
      >
        <FileUp size={28} strokeWidth={1.5} aria-hidden="true" className="text-ink-900" />
        <label
          htmlFor="import-fichier"
          className="inline-flex cursor-pointer items-center gap-2 border border-ink-900 bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
        >
          {t("manager.import.chooseFile")}
        </label>
        <input id="import-fichier" ref={champFichier} type="file" accept=".csv,.txt,text/csv" onChange={choisirFichier} className="sr-only" />
        <p className="text-xs text-slate-600">{nomFichier ? <span className="font-mono text-sm text-slate-900">{nomFichier}</span> : t("manager.import.dropHint")}</p>
      </div>

      {chargement && <p role="status" className="font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.import.analysing")}</p>}

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {encodageSuspect && (
        <div role="alert" className="border border-orange-700/40 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          {t("manager.import.encodingWarning")}
        </div>
      )}

      {resultat && (
        <div role="status" className="space-y-2 border border-emerald-300 bg-emerald-50 px-4 py-4 text-sm text-emerald-900 shadow-[inset_4px_0_0_var(--color-emerald-600)]">
          <p className="font-semibold">{t("manager.import.done", { count: resultat.importees ?? 0, type: libelleType })}</p>
          {(resultat.resume.doublons > 0 || resultat.resume.erreurs > 0) && (
            <p>{t("manager.import.skipped", { duplicates: resultat.resume.doublons, errors: resultat.resume.erreurs })}</p>
          )}
          <p className="flex gap-4">
            <Link to={PAGES_LISTE[type]} className="font-semibold underline">
              {t("manager.import.seeList", { type: libelleType })}
            </Link>
            <button type="button" onClick={reinitialiser} className="cursor-pointer font-semibold underline">
              {t("manager.import.newImport")}
            </button>
          </p>
        </div>
      )}

      {analyse && (
        <div className="space-y-4">
          {/* Résumé en une bande de quatre cases, chacune avec son filet de couleur. */}
          <div className="grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 sm:grid-cols-4">
            {[
              { cle: "total", valeur: analyse.resume.total },
              { cle: "valid", valeur: analyse.resume.valides },
              { cle: "duplicates", valeur: analyse.resume.doublons },
              { cle: "errors", valeur: analyse.resume.erreurs },
            ].map((carte) => (
              <div key={carte.cle} className={`border-t-4 bg-white px-4 py-3 ${FILETS_RESUME[carte.cle]}`}>
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t(`manager.import.summary.${carte.cle}`)}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{carte.valeur}</p>
              </div>
            ))}
          </div>

          {analyse.capacite && analyse.capacite.maximum !== null && (
            <p className="font-mono text-xs text-slate-700">
              {t("manager.import.capacity", { existing: analyse.capacite.existants, max: analyse.capacite.maximum, remaining: analyse.capacite.restant ?? 0 })}
            </p>
          )}

          <div className="max-h-112 overflow-x-auto overflow-y-auto border border-slate-300 bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 text-left">
                <tr>
                  <th className="px-4 py-2 font-semibold">{t("manager.import.table.line")}</th>
                  <th className="px-4 py-2 font-semibold">{t("manager.import.table.data")}</th>
                  <th className="px-4 py-2 font-semibold">{t("manager.import.table.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {analyse.lignes.map((l) => (
                  <tr
                    key={l.ligne}
                    className={l.statut === "ERREUR" ? "shadow-[inset_3px_0_0_var(--color-rose-600)]" : l.statut === "DOUBLON" ? "shadow-[inset_3px_0_0_var(--color-orange-700)]" : ""}
                  >
                    <td className="px-4 py-2 font-mono text-xs tabular-nums text-slate-600">{String(l.ligne).padStart(2, "0")}</td>
                    <td className="px-4 py-2 text-slate-900">
                      {libelleLigne(analyse.type, l.donnees)}
                      {analyse.type === "contracts" && l.statut === "OK" && (
                        <p className="text-xs text-slate-600">
                          {l.donnees.premiereFacture ? t("manager.import.firstInvoice", { month: l.donnees.premiereFacture }) : t("manager.import.noInvoice")}
                        </p>
                      )}
                      {l.messages.map((m, i) => (
                        <p key={m} className="text-xs text-red-700">
                          {messageDuServeur(l.details?.[i]?.code, l.details?.[i]?.params, m)}
                        </p>
                      ))}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-block border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${STYLES_STATUT[l.statut]}`}>
                        {t(`manager.import.status.${l.statut}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={importer}
              disabled={import_ || analyse.resume.valides === 0}
              className="cursor-pointer border border-ink-900 bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {import_ ? t("manager.import.importing") : t("manager.import.importButton", { count: analyse.resume.valides })}
            </button>
            <button
              type="button"
              onClick={reinitialiser}
              className="cursor-pointer border-b border-ink-900/40 text-sm font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
            >
              {t("common.actions.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
