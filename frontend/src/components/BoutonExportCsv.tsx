import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";

interface BoutonExportCsvProps {
  /** Route d'export (relative à /api), qui renvoie le CSV. */
  chemin: string;
  /** Filtres de la page : l'export porte sur la même sélection que celle affichée. */
  params?: Record<string, string>;
  /** Préfixe du nom de fichier, la date du jour est ajoutée. */
  prefixeFichier: string;
}

/**
 * Message d'erreur d'un export. La réponse étant demandée en `blob`, le corps
 * d'une erreur serveur arrive lui aussi sous forme de blob : sans le relire,
 * on afficherait le texte brut d'axios (« Request failed with status code
 * 400 ») au lieu du message du serveur.
 */
async function messageErreur(err: unknown): Promise<string> {
  const corps = (err as { response?: { data?: unknown } })?.response?.data;
  if (corps instanceof Blob) {
    try {
      const json = JSON.parse(await corps.text()) as { error?: string };
      if (json.error) return json.error;
    } catch {
      // corps illisible : repli sur le message générique ci-dessous
    }
  }
  return apiErrorMessage(err);
}

/**
 * Télécharge un export CSV de l'administration. Passe par une requête
 * authentifiée puis un blob (et non un lien direct) : l'authentification de
 * l'app native voyage dans un en-tête, qu'un simple lien n'enverrait pas.
 */
export default function BoutonExportCsv({ chemin, params, prefixeFichier }: BoutonExportCsvProps) {
  const { t } = useTranslation();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function exporter() {
    setEnCours(true);
    setErreur(null);
    try {
      const res = await api.get(chemin, { params, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = `${prefixeFichier}-${new Date().toISOString().slice(0, 10)}.csv`;
      lien.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErreur(await messageErreur(err));
    } finally {
      setEnCours(false);
    }
  }

  return (
    // Bouton et phrase d'aide sur une même ligne : sous le bouton, l'aide agrandissait la colonne et décalait la
    // recherche et les menus voisins. Sur écran étroit, l'aide passe d'elle-même à la ligne.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={() => void exporter()}
        disabled={enCours}
        className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <Download size={14} aria-hidden="true" />
        {enCours ? t("components.exportCsv.exporting") : t("components.exportCsv.button")}
      </button>
      <p className="max-w-48 text-xs leading-4 text-slate-600">{t("components.exportCsv.hint")}</p>
      {erreur && (
        <p role="alert" className="w-full text-xs text-red-700">
          {erreur}
        </p>
      )}
    </div>
  );
}
