import { FileUp, Download } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";

type TypeImport = "properties" | "tenants";
type StatutLigne = "OK" | "DOUBLON" | "ERREUR";

interface LigneAnalysee {
  ligne: number;
  statut: StatutLigne;
  messages: string[];
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
  OK: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300",
  DOUBLON: "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300",
  ERREUR: "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300",
};

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
  return type === "properties"
    ? [d.title, d.address].filter(Boolean).join(" — ")
    : [[d.firstName, d.lastName].filter(Boolean).join(" "), d.email].filter(Boolean).join(" — ");
}

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
      lien.download = `modele-import-${type === "properties" ? "biens" : "locataires"}.csv`;
      lien.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function choisirFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
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
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.import.title")}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t("manager.import.subtitle")}</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
        <div role="radiogroup" aria-label={t("manager.import.typeLabel")} className="flex flex-wrap gap-2">
          {(["properties", "tenants"] as const).map((valeur) => (
            <button
              key={valeur}
              type="button"
              role="radio"
              aria-checked={type === valeur}
              onClick={() => changerType(valeur)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                type === valeur
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              {t(`manager.import.types.${valeur}`)}
            </button>
          ))}
        </div>

        <ol className="text-sm text-slate-700 dark:text-slate-300 list-decimal pl-5 space-y-1">
          <li>
            {t("manager.import.step1")}{" "}
            <button type="button" onClick={telechargerModele} className="text-brand-600 dark:text-brand-400 font-semibold hover:underline inline-flex items-center gap-1">
              <Download size={13} aria-hidden="true" /> {t("manager.import.downloadTemplate")}
            </button>
          </li>
          <li>{t("manager.import.step2")}</li>
          <li>{t("manager.import.step3")}</li>
        </ol>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t(`manager.import.columns.${type}`)}</p>

        <div>
          <label htmlFor="import-fichier" className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer">
            <FileUp size={15} aria-hidden="true" /> {t("manager.import.chooseFile")}
          </label>
          <input id="import-fichier" ref={champFichier} type="file" accept=".csv,.txt,text/csv" onChange={choisirFichier} className="sr-only" />
          {nomFichier && <span className="ml-3 text-sm text-slate-600 dark:text-slate-400">{nomFichier}</span>}
        </div>
      </div>

      {chargement && <p role="status" className="text-sm text-slate-600 dark:text-slate-400">{t("manager.import.analysing")}</p>}

      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {encodageSuspect && (
        <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 px-4 py-3 rounded-xl text-sm">
          {t("manager.import.encodingWarning")}
        </div>
      )}

      {resultat && (
        <div role="status" className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-4 py-4 rounded-xl text-sm space-y-2">
          <p className="font-semibold">{t("manager.import.done", { count: resultat.importees ?? 0, type: libelleType })}</p>
          {(resultat.resume.doublons > 0 || resultat.resume.erreurs > 0) && (
            <p>{t("manager.import.skipped", { duplicates: resultat.resume.doublons, errors: resultat.resume.erreurs })}</p>
          )}
          <p className="flex gap-4">
            <Link to={type === "properties" ? "/properties" : "/tenants"} className="font-semibold underline">
              {t("manager.import.seeList", { type: libelleType })}
            </Link>
            <button type="button" onClick={reinitialiser} className="font-semibold underline">
              {t("manager.import.newImport")}
            </button>
          </p>
        </div>
      )}

      {analyse && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { cle: "total", valeur: analyse.resume.total },
              { cle: "valid", valeur: analyse.resume.valides },
              { cle: "duplicates", valeur: analyse.resume.doublons },
              { cle: "errors", valeur: analyse.resume.erreurs },
            ].map((carte) => (
              <div key={carte.cle} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3 shadow-sm">
                <p className="text-xs text-slate-600 dark:text-slate-400">{t(`manager.import.summary.${carte.cle}`)}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{carte.valeur}</p>
              </div>
            ))}
          </div>

          {analyse.capacite && analyse.capacite.maximum !== null && (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t("manager.import.capacity", { existing: analyse.capacite.existants, max: analyse.capacite.maximum, remaining: analyse.capacite.restant ?? 0 })}
            </p>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden overflow-x-auto max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-400 text-left sticky top-0">
                <tr>
                  <th className="px-4 py-2 font-semibold">{t("manager.import.table.line")}</th>
                  <th className="px-4 py-2 font-semibold">{t("manager.import.table.data")}</th>
                  <th className="px-4 py-2 font-semibold">{t("manager.import.table.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {analyse.lignes.map((l) => (
                  <tr key={l.ligne}>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{l.ligne}</td>
                    <td className="px-4 py-2 text-slate-900 dark:text-slate-100">
                      {libelleLigne(analyse.type, l.donnees)}
                      {l.messages.map((m) => (
                        <p key={m} className="text-xs text-red-700 dark:text-red-400">
                          {m}
                        </p>
                      ))}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STYLES_STATUT[l.statut]}`}>{t(`manager.import.status.${l.statut}`)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={importer}
              disabled={import_ || analyse.resume.valides === 0}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {import_ ? t("manager.import.importing") : t("manager.import.importButton", { count: analyse.resume.valides })}
            </button>
            <button type="button" onClick={reinitialiser} className="text-sm text-slate-600 dark:text-slate-400 hover:underline">
              {t("common.actions.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
