import { CheckCircle2, Circle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/auth";
import { paysParCode } from "../data/pays";
import type { DashboardStats } from "../types";
import { countryLabel } from "../utils/countries";

/**
 * Liste de démarrage d'une agence, sur le tableau de bord : les quatre gestes qui produisent ses premiers documents — ses
 * identifiants légaux (que le bail, la quittance et la mise en demeure impriment), un bien, un locataire, un bail actif.
 * Rien n'est bloquant : c'est un repère, qui disparaît seul quand tout est fait, ou quand le gestionnaire le masque.
 *
 * Le pays de l'agence ne change que le texte de la première étape et le rappel de la devise ; la liste est la même partout.
 * L'étape des identifiants lit les réglages de l'agence : si cette lecture échoue, elle est omise plutôt que supposée faite
 * ou à faire.
 */
const CLE_MASQUE = "immoplatform.demarrage.masque";

function lireMasque(): boolean {
  try {
    return localStorage.getItem(CLE_MASQUE) === "1";
  } catch {
    return false;
  }
}

type Etape = { cle: "ids" | "bien" | "locataire" | "bail"; faite: boolean; lien: string };

export default function DemarrageAgence({ stats }: { stats: Pick<DashboardStats, "totalProperties" | "totalTenants" | "activeContracts"> }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [masque, setMasque] = useState(lireMasque);
  // `null` : réglages pas encore lus ou illisibles ; sinon, vrai quand des identifiants légaux sont saisis.
  const [identifiantsSaisis, setIdentifiantsSaisis] = useState<boolean | null>(null);

  useEffect(() => {
    if (masque) return;
    let annule = false;
    (async () => {
      try {
        const res = await api.get<{ siretOrId?: string | null }>("/agency");
        if (!annule && res?.data) setIdentifiantsSaisis(Boolean(res.data.siretOrId?.trim()));
      } catch {
        // Réglages illisibles : l'étape des identifiants est omise.
      }
    })();
    return () => {
      annule = true;
    };
  }, [masque]);

  const etapes: Etape[] = [
    ...(identifiantsSaisis === null ? [] : [{ cle: "ids" as const, faite: identifiantsSaisis, lien: "/agency" }]),
    { cle: "bien", faite: stats.totalProperties > 0, lien: "/properties" },
    { cle: "locataire", faite: stats.totalTenants > 0, lien: "/tenants" },
    { cle: "bail", faite: stats.activeContracts > 0, lien: "/contracts" },
  ];

  if (masque || etapes.every((e) => e.faite)) return null;

  const pays = user?.country ? paysParCode(user.country) : undefined;
  const typeIdentifiants = user?.country === "FR" ? "FR" : user?.country === "SN" ? "SN" : "autre";

  function masquer() {
    try {
      localStorage.setItem(CLE_MASQUE, "1");
    } catch {
      // Stockage indisponible : le guide se masque pour cette visite seulement.
    }
    setMasque(true);
  }

  return (
    <section aria-labelledby="demarrage-titre" className="rounded-2xl border border-brand-200 bg-brand-50/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="demarrage-titre" className="font-bold text-slate-900 text-base">
            {t("manager.demarrage.titre")}
          </h3>
          <p className="text-xs text-slate-600 mt-1">
            {pays
              ? t("manager.demarrage.sousTitre", { pays: countryLabel(pays.code, i18n.language), devise: pays.devise })
              : t("manager.demarrage.sousTitreSansPays")}
          </p>
        </div>
        <button type="button" onClick={masquer} className="text-xs font-semibold text-slate-600 hover:underline shrink-0">
          {t("manager.demarrage.masquer")}
        </button>
      </div>
      <ol className="mt-4 space-y-3">
        {etapes.map((e) => (
          <li key={e.cle} className="flex items-start gap-3">
            {e.faite ? (
              <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 shrink-0" aria-label={t("manager.demarrage.faite")} />
            ) : (
              <Circle size={18} className="text-slate-400 mt-0.5 shrink-0" aria-label={t("manager.demarrage.afaire")} />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${e.faite ? "text-slate-500 line-through" : "text-slate-900"}`}>
                {t(`manager.demarrage.etapes.${e.cle}.titre`)}
              </p>
              {!e.faite && (
                <p className="text-xs text-slate-600 mt-0.5">
                  {e.cle === "ids" ? t(`manager.demarrage.identifiants.${typeIdentifiants}`) : t(`manager.demarrage.etapes.${e.cle}.detail`)}
                </p>
              )}
            </div>
            {!e.faite && (
              <Link to={e.lien} className="text-xs font-semibold text-brand-700 hover:underline shrink-0">
                {t("manager.demarrage.ouvrir")}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
