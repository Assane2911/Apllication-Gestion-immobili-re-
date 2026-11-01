import { Check, Copy, Mail, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import BoutonExportCsv from "../../components/BoutonExportCsv";
import EmptyState from "../../components/EmptyState";
import Initiales from "../../components/Initiales";
import Pagination from "../../components/Pagination";
import { formaterDateHeure } from "../../utils/dateHeure";
import { PLAFOND_BIENS, PLAN_CLASSES, STATUS_CLASSES, SUSPENDED_CLASS, type ManagerPlan, type ManagerStatus } from "./managerStatus";

interface ManagerRow {
  id: string;
  email: string;
  agencyName: string | null;
  plan: ManagerPlan;
  status: ManagerStatus;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  suspendedAt: string | null;
  propertiesCount: number;
  tenantsCount: number;
  createdAt: string;
}

interface Page {
  items: ManagerRow[];
  page: number;
  totalPages: number;
  total: number;
}

/** Les comptes par état, tels que le tableau de bord les compte : sert à chiffrer les onglets. */
interface Decomptes {
  total: number;
  TRIAL: number;
  ACTIVE: number;
  EXPIRED: number;
  SUSPENDED: number;
}

/** Au-delà de cette part du plafond de biens, le compte est signalé : c'est lui qui aura besoin de la formule du dessus. */
const SEUIL_PROCHE_PLAFOND = 0.8;
const JOUR_MS = 86_400_000;

const ONGLETS = ["", "TRIAL", "ACTIVE", "CANCELLED", "EXPIRED", "SUSPENDED"] as const;

/**
 * Liste des gestionnaires (comptes agence) : recherche par email ou nom
 * d'agence, filtres formule / statut. Le statut affiché est celui CALCULÉ par
 * le serveur (un essai échu apparaît « Expiré » même si la base dit encore
 * « Essai »).
 */
export default function AdminManagersPage() {
  const { t, i18n } = useTranslation();
  const [donnees, setDonnees] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [saisie, setSaisie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [plan, setPlan] = useState("");
  const [statut, setStatut] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [decomptes, setDecomptes] = useState<Decomptes | null>(null);
  const [copie, setCopie] = useState<string | null>(null);

  // Anti-rebond : on n'interroge le serveur qu'une fois la frappe terminée.
  useEffect(() => {
    const minuteur = setTimeout(() => {
      setRecherche(saisie.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    api
      .get<Page>("/admin/managers", {
        params: { page, ...(recherche && { search: recherche }), ...(plan && { plan }), ...(statut && { status: statut }) },
      })
      .then((res) => {
        if (vivant) setDonnees(res.data);
      })
      .catch((err) => {
        if (vivant) setErreur(apiErrorMessage(err));
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [page, recherche, plan, statut]);

  // Les chiffres des onglets sont un repère, pas le contenu : s'ils manquent, les onglets s'affichent sans nombre.
  useEffect(() => {
    let vivant = true;
    Promise.resolve(api.get<{ managers?: Record<string, number> }>("/admin/dashboard/stats"))
      .then((res) => {
        const m = res?.data?.managers;
        if (!vivant || !m || typeof m.total !== "number") return;
        setDecomptes({ total: m.total, TRIAL: m.trialActive ?? 0, ACTIVE: m.subscriptionActive ?? 0, EXPIRED: m.expired ?? 0, SUSPENDED: m.suspended ?? 0 });
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, []);

  const champ = "border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900";

  function echeance(m: ManagerRow) {
    const date = m.status === "TRIAL" ? m.trialEndsAt : m.subscriptionEndsAt ?? m.trialEndsAt;
    return date ? formaterDateHeure(date, i18n.language) : "—";
  }

  /** Jours restants avant l'échéance d'un compte encore ouvert (essai ou abonnement) ; `null` si elle est passée ou inconnue. */
  function joursRestants(m: ManagerRow): number | null {
    if (m.status !== "TRIAL" && m.status !== "ACTIVE") return null;
    const date = m.status === "TRIAL" ? m.trialEndsAt : m.subscriptionEndsAt;
    if (!date) return null;
    const reste = Math.ceil((new Date(date).getTime() - Date.now()) / JOUR_MS);
    return reste >= 0 ? reste : null;
  }

  async function copier(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      setCopie(email);
      setTimeout(() => setCopie((actuel) => (actuel === email ? null : actuel)), 1800);
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé) : le lien « écrire » reste disponible.
    }
  }

  function choisirStatut(valeur: string) {
    setStatut(valeur);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("admin.managers.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("admin.managers.subtitle")}</p>
        {donnees && !erreur && (
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("admin.managers.count", { count: donnees.total })}</p>
        )}
      </div>

      {/* L'état des comptes, d'un clic : chaque onglet est un filtre (la même valeur que l'ancien menu déroulant). */}
      <div role="group" aria-label={t("admin.managers.statusFilter")} className="flex flex-wrap border border-slate-400 bg-white sm:inline-flex">
        {ONGLETS.map((s) => {
          const nombre = s === "" ? decomptes?.total : s === "CANCELLED" ? undefined : decomptes?.[s];
          return (
            <button
              key={s || "ALL"}
              type="button"
              aria-pressed={statut === s}
              onClick={() => choisirStatut(s)}
              className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
                statut === s ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
              }`}
            >
              {nombre === undefined
                ? s === ""
                  ? t("admin.managers.allStatuses")
                  : t(`admin.managers.statuses.${s}`)
                : `${s === "" ? t("admin.managers.allStatuses") : t(`admin.managers.statuses.${s}`)} · ${nombre}`}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder={t("admin.managers.searchPlaceholder")}
          aria-label={t("admin.managers.searchLabel")}
          maxLength={100}
          className={`${champ} min-w-56 flex-1`}
        />
        <select
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
            setPage(1);
          }}
          aria-label={t("admin.managers.planFilter")}
          className={champ}
        >
          <option value="">{t("admin.managers.allPlans")}</option>
          {(["STARTER", "PRO", "ENTERPRISE"] as const).map((p) => (
            <option key={p} value={p}>
              {t(`admin.managers.plans.${p}`)}
            </option>
          ))}
        </select>
        <BoutonExportCsv
          chemin="/admin/exports/managers.csv"
          params={{ ...(recherche && { search: recherche }), ...(plan && { plan }), ...(statut && { status: statut }) }}
          prefixeFichier="gestionnaires"
        />
      </div>

      {erreur && (
        <div className="border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">{t("admin.managers.errorTitle")}</p>
          <p role="alert" className="mt-0.5 text-xs text-red-700">{erreur}</p>
        </div>
      )}

      {chargement && !donnees && <p className="text-xs text-slate-600">{t("admin.managers.loading")}</p>}

      {donnees && donnees.items.length === 0 && !erreur && (
        <EmptyState icon={Users} title={t("admin.managers.emptyTitle")} description={t("admin.managers.emptyDescription")} />
      )}

      {donnees && donnees.items.length > 0 && (
        <>
          <div className="overflow-x-auto border border-slate-300 bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.managers.table.manager")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.managers.table.plan")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.managers.table.status")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.managers.table.deadline")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.managers.table.usage")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.managers.table.signup")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {donnees.items.map((m) => {
                  const plafond = PLAFOND_BIENS[m.plan];
                  const part = plafond ? m.propertiesCount / plafond : 0;
                  const procheDuPlafond = plafond !== null && part >= SEUIL_PROCHE_PLAFOND;
                  const reste = joursRestants(m);
                  return (
                    <tr key={m.id} className={m.suspendedAt ? "bg-slate-50" : undefined}>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <Initiales prenom={(m.agencyName ?? m.email).split(/\s+/)[0]} nom={(m.agencyName ?? "").split(/\s+/)[1]} />
                          <div className="min-w-0">
                            <Link to={`/admin/gestionnaires/${m.id}`} className="font-semibold text-ink-900 hover:text-orange-700">
                              {m.agencyName ?? t("admin.managers.noAgencyName")}
                            </Link>
                            <p className="flex items-center gap-1.5 font-mono text-slate-600">
                              <span className="min-w-0 truncate">{m.email}</span>
                              <button
                                type="button"
                                onClick={() => copier(m.email)}
                                aria-label={t("admin.managers.copyEmail", { email: m.email })}
                                className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center text-slate-500 hover:text-orange-700"
                              >
                                {copie === m.email ? <Check size={12} aria-hidden="true" className="text-emerald-700" /> : <Copy size={12} aria-hidden="true" />}
                              </button>
                              <a
                                href={`mailto:${m.email}`}
                                aria-label={t("admin.managers.writeTo", { email: m.email })}
                                className="inline-flex size-5 shrink-0 items-center justify-center text-slate-500 hover:text-orange-700"
                              >
                                <Mail size={12} aria-hidden="true" />
                              </a>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 font-semibold ${PLAN_CLASSES[m.plan]}`}>{t(`admin.managers.plans.${m.plan}`)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 font-semibold ${STATUS_CLASSES[m.status]}`}>
                          {t(`admin.managers.statuses.${m.status}`)}
                        </span>
                        {m.suspendedAt && (
                          <span className={`ml-1 inline-block px-2 py-0.5 font-semibold ${SUSPENDED_CLASS}`}>
                            {t("admin.managers.statuses.SUSPENDED")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono tabular-nums">{echeance(m)}</span>
                        {reste !== null && (
                          <p className={`mt-0.5 font-mono text-[11px] ${reste <= 3 ? "font-semibold text-orange-700" : "text-slate-600"}`}>
                            {t("admin.managers.inDays", { count: reste })}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p>{t("admin.managers.usage", { properties: m.propertiesCount, tenants: m.tenantsCount })}</p>
                        {plafond !== null && (
                          <div className="mt-1.5 flex items-center gap-2">
                            {/* Les biens du compte face à ce que sa formule inclut. */}
                            <div
                              role="meter"
                              aria-label={t("admin.managers.capacity", { used: m.propertiesCount, max: plafond })}
                              aria-valuemin={0}
                              aria-valuemax={plafond}
                              aria-valuenow={Math.min(m.propertiesCount, plafond)}
                              className="h-1.5 w-24 bg-slate-200"
                            >
                              <div className={`h-full ${procheDuPlafond ? "bg-orange-700" : "bg-ink-900"}`} style={{ width: `${Math.min(100, part * 100)}%` }} />
                            </div>
                            <span className={`font-mono text-[11px] tabular-nums ${procheDuPlafond ? "font-semibold text-orange-700" : "text-slate-600"}`}>
                              {`${m.propertiesCount}/${plafond}`}
                            </span>
                          </div>
                        )}
                        {procheDuPlafond && m.plan !== "ENTERPRISE" && (
                          <p className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-700">{t("admin.managers.nearLimit")}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums">{formaterDateHeure(m.createdAt, i18n.language)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination page={donnees.page} totalPages={donnees.totalPages} total={donnees.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
