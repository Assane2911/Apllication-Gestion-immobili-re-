import { Building2, Check, Copy, FileText, Mail, UserCog, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import Initiales from "../../components/Initiales";
import SectionReglage from "../../components/SectionReglage";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/currency";
import { formaterDateHeure } from "../../utils/dateHeure";
import { PLAFOND_BIENS, PLAN_CLASSES, STATUS_CLASSES, SUSPENDED_CLASS, type ManagerPlan, type ManagerStatus } from "./managerStatus";

const JOUR_MS = 86_400_000;
/** Au-delà de ce délai sans connexion, le compte est signalé : c'est un client qui risque de ne pas renouveler. */
const SEUIL_INACTIVITE_JOURS = 30;

interface ManagerDetail {
  id: string;
  email: string;
  currency: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  twoFactorEnabled: boolean;
  subscription: {
    status: ManagerStatus;
    plan: ManagerPlan;
    trialEndsAt: string | null;
    subscriptionEndsAt: string | null;
    trialDaysRemaining: number;
    paymentMethod: string | null;
    autoRenew: boolean;
  };
  agency: {
    agencyName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    siretOrId: string | null;
  } | null;
  usage: { properties: number; tenants: number; owners: number; activeContracts: number; collaborators: number };
  lastActivityAt: string | null;
  billingHistory: Array<{
    id: string;
    plan: ManagerPlan;
    amount: number;
    currency: string;
    billingCycle: string;
    status: string;
    paymentMethod: string;
    paymentRef: string | null;
    startDate: string;
    endDate: string;
    createdAt: string;
  }>;
}

/** Fiche d'un gestionnaire pour l'administration : abonnement, usage, agence, facturation. */
export default function AdminManagerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [manager, setManager] = useState<ManagerDetail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  // Incrémenté après une suspension / réactivation pour relire la fiche.
  const [version, setVersion] = useState(0);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  // Résultat de la dernière suspension / réactivation côté facturation Stripe.
  const [infoFacturation, setInfoFacturation] = useState<string | null>(null);
  // Suppression définitive (compte suspendu uniquement).
  const [suppressionOuverte, setSuppressionOuverte] = useState(false);
  const [emailSaisi, setEmailSaisi] = useState("");
  const [motifSuppression, setMotifSuppression] = useState("");
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);
  // Ajustement manuel de l'abonnement (offrir des jours / changer de formule).
  const [jours, setJours] = useState("");
  const [motifJours, setMotifJours] = useState("");
  const [nouvellePlan, setNouvellePlan] = useState<ManagerPlan | "">("");
  const [motifPlan, setMotifPlan] = useState("");
  const [motifIllimite, setMotifIllimite] = useState("");
  const [ajustementEnCours, setAjustementEnCours] = useState<"days" | "plan" | "unlimited" | null>(null);
  const [ajustementMessage, setAjustementMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    api
      .get<ManagerDetail>(`/admin/managers/${id}`)
      .then((res) => {
        if (vivant) setManager(res.data);
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
  }, [id, version]);

  async function suspendre(e: React.FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreurAction(null);
    setInfoFacturation(null);
    try {
      const res = await api.post<{ billingPaused?: boolean }>(`/admin/managers/${id}/suspend`, { reason: motif.trim() });
      if (res.data?.billingPaused) setInfoFacturation(t("admin.managerDetail.suspension.billingPaused"));
      setFormulaireOuvert(false);
      setMotif("");
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(apiErrorMessage(err));
    } finally {
      setEnCours(false);
    }
  }

  // ACTIVE sans échéance : accès illimité (voir requireActiveSubscription côté serveur).
  const illimite = manager?.subscription.status === "ACTIVE" && manager.subscription.subscriptionEndsAt === null;

  async function ajuster(type: "days" | "plan" | "unlimited") {
    if (type === "unlimited" && illimite && !window.confirm(t("admin.managerDetail.adjust.unlimitedConfirmRevoke"))) return;
    setAjustementEnCours(type);
    setAjustementMessage(null);
    try {
      if (type === "days") {
        await api.post(`/admin/managers/${id}/subscription/grant-days`, { days: Number(jours), reason: motifJours.trim() });
        setJours("");
        setMotifJours("");
      } else if (type === "unlimited") {
        const route = illimite ? "revoke-unlimited" : "grant-unlimited";
        await api.post(`/admin/managers/${id}/subscription/${route}`, { reason: motifIllimite.trim() });
        setMotifIllimite("");
      } else {
        await api.post(`/admin/managers/${id}/subscription/change-plan`, { plan: nouvellePlan, reason: motifPlan.trim() });
        setNouvellePlan("");
        setMotifPlan("");
      }
      setAjustementMessage({ type: "ok", texte: t("admin.managerDetail.adjust.done") });
      setVersion((v) => v + 1);
    } catch (err) {
      setAjustementMessage({ type: "erreur", texte: apiErrorMessage(err) });
    } finally {
      setAjustementEnCours(null);
    }
  }

  async function supprimerDefinitivement(e: React.FormEvent) {
    e.preventDefault();
    setSuppressionEnCours(true);
    setErreurSuppression(null);
    try {
      await api.delete(`/admin/managers/${id}`, { data: { email: emailSaisi.trim(), reason: motifSuppression.trim() } });
      // Le compte n'existe plus : sa fiche non plus.
      navigate("/admin/gestionnaires");
    } catch (err) {
      setErreurSuppression(apiErrorMessage(err));
      setSuppressionEnCours(false);
    }
  }

  async function reactiver() {
    if (!window.confirm(t("admin.managerDetail.suspension.reactivateConfirm"))) return;
    setEnCours(true);
    setErreurAction(null);
    setInfoFacturation(null);
    try {
      const res = await api.post<{ billingResumed?: boolean }>(`/admin/managers/${id}/reactivate`);
      if (res.data?.billingResumed) setInfoFacturation(t("admin.managerDetail.suspension.billingResumed"));
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(apiErrorMessage(err));
    } finally {
      setEnCours(false);
    }
  }

  const date = (valeur: string | null) => (valeur ? new Date(valeur).toLocaleDateString(i18n.language) : "—");
  // Début et fin de période : un instant précis (l'accès s'arrête à cette heure-là), pas seulement un jour.
  const dateHeure = (valeur: string | null) => (valeur ? formaterDateHeure(valeur, i18n.language) : "—");
  const nomAgence = manager?.agency?.agencyName ?? t("admin.managers.noAgencyName");
  const plafond = manager ? PLAFOND_BIENS[manager.subscription.plan] : null;
  const joursInactif = manager?.lastActivityAt ? Math.max(0, Math.floor((Date.now() - new Date(manager.lastActivityAt).getTime()) / JOUR_MS)) : null;
  // Ce que ce compte a réellement réglé, devise par devise (jamais additionnées entre elles).
  const totalEncaisse = [
    ...(manager?.billingHistory ?? [])
      .filter((b) => b.status === "PAID")
      .reduce((somme, b) => somme.set(b.currency, (somme.get(b.currency) ?? 0) + b.amount), new Map<string, number>()),
  ];

  async function copierEmail() {
    if (!manager) return;
    try {
      await navigator.clipboard.writeText(manager.email);
      setCopie(true);
      setTimeout(() => setCopie(false), 1800);
    } catch {
      // Presse-papiers indisponible : le lien « écrire » reste disponible.
    }
  }
  const ligne = (libelle: string, valeur: string) => (
    <div className="flex justify-between gap-4 border-b border-dashed border-slate-200 py-2 text-xs last:border-b-0">
      <dt className="font-mono uppercase tracking-wider text-slate-600">{libelle}</dt>
      <dd className="min-w-0 wrap-break-word text-right text-slate-900">{valeur}</dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link
        to="/admin/gestionnaires"
        className="inline-block border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
      >
        ← {t("admin.managerDetail.back")}
      </Link>

      {chargement && <p className="text-xs text-slate-600">{t("admin.managerDetail.loading")}</p>}

      {erreur && (
        <div className="border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">{t("admin.managerDetail.errorTitle")}</p>
          <p role="alert" className="text-xs text-red-700 mt-0.5">{erreur}</p>
        </div>
      )}

      {manager && (
        <>
          <header className="border border-slate-300 bg-white shadow-[inset_4px_0_0_var(--color-ink-900)]">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5 pl-7">
              <div className="flex min-w-0 items-start gap-4">
                <Initiales prenom={nomAgence.split(/\s+/)[0]} nom={nomAgence.split(/\s+/)[1]} className="h-12! w-12! text-sm!" />
                <div className="min-w-0">
                  <h2 className="wrap-break-word text-2xl font-semibold text-slate-900">{nomAgence}</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-600">
                    <span className="break-all">{manager.email}</span>
                    <button
                      type="button"
                      onClick={copierEmail}
                      aria-label={t("admin.managers.copyEmail", { email: manager.email })}
                      className="inline-flex size-5 cursor-pointer items-center justify-center text-slate-500 hover:text-orange-700"
                    >
                      {copie ? <Check size={12} aria-hidden="true" className="text-emerald-700" /> : <Copy size={12} aria-hidden="true" />}
                    </button>
                    <a
                      href={`mailto:${manager.email}`}
                      aria-label={t("admin.managers.writeTo", { email: manager.email })}
                      className="inline-flex size-5 items-center justify-center text-slate-500 hover:text-orange-700"
                    >
                      <Mail size={12} aria-hidden="true" />
                    </a>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`inline-block px-2.5 py-1 font-semibold ${PLAN_CLASSES[manager.subscription.plan]}`}>
                  {t(`admin.managers.plans.${manager.subscription.plan}`)}
                </span>
                <span className={`inline-block px-2.5 py-1 font-semibold ${STATUS_CLASSES[manager.subscription.status]}`}>
                  {t(`admin.managers.statuses.${manager.subscription.status}`)}
                </span>
                {manager.suspendedAt && (
                  <span className={`inline-block px-2.5 py-1 font-semibold ${SUSPENDED_CLASS}`}>{t("admin.managers.statuses.SUSPENDED")}</span>
                )}
                {joursInactif !== null && joursInactif >= SEUIL_INACTIVITE_JOURS && (
                  <span className="inline-block border border-orange-300 bg-orange-50 px-2.5 py-1 font-mono font-semibold text-orange-900">
                    {t("admin.managerDetail.inactiveFor", { count: joursInactif })}
                  </span>
                )}
              </div>
            </div>
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Building2}
              label={t("admin.managerDetail.usage.properties")}
              value={manager.usage.properties}
              hint={plafond !== null ? t("admin.managerDetail.usage.propertiesHint", { max: plafond }) : t("admin.managerDetail.usage.propertiesUnlimited")}
              progress={plafond !== null ? Math.min(100, (manager.usage.properties / plafond) * 100) : undefined}
              accent="blue"
            />
            <StatCard icon={Users} label={t("admin.managerDetail.usage.tenants")} value={manager.usage.tenants} accent="blue" />
            <StatCard icon={FileText} label={t("admin.managerDetail.usage.activeContracts")} value={manager.usage.activeContracts} accent="green" />
            <StatCard
              icon={UserCog}
              label={t("admin.managerDetail.usage.collaborators")}
              value={manager.usage.collaborators}
              hint={t("admin.managerDetail.usage.ownersHint", { count: manager.usage.owners })}
              accent="amber"
            />
          </div>


          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="min-w-0 space-y-6">
            <SectionReglage id="abonnement" numero="01" titre={t("admin.managerDetail.subscription.title")}>
              <dl>
                {ligne(t("admin.managers.table.plan"), t(`admin.managers.plans.${manager.subscription.plan}`))}
                {manager.subscription.status === "TRIAL" &&
                  ligne(
                    t("admin.managerDetail.subscription.trialEnds"),
                    `${dateHeure(manager.subscription.trialEndsAt)} (${t("admin.managerDetail.subscription.daysLeft", { count: manager.subscription.trialDaysRemaining })})`
                  )}
                {manager.subscription.status !== "TRIAL" &&
                  ligne(
                    t("admin.managerDetail.subscription.endsOn"),
                    illimite ? t("admin.managerDetail.subscription.unlimited") : dateHeure(manager.subscription.subscriptionEndsAt ?? manager.subscription.trialEndsAt)
                  )}
                {ligne(
                  t("admin.managerDetail.subscription.paymentMethod"),
                  manager.subscription.paymentMethod ?? "—"
                )}
                {ligne(
                  t("admin.managerDetail.subscription.autoRenew"),
                  manager.subscription.autoRenew ? t("admin.managerDetail.yes") : t("admin.managerDetail.no")
                )}
              </dl>
            </SectionReglage>

            <SectionReglage id="compte" numero="02" titre={t("admin.managerDetail.account.title")}>
              <dl>
                {ligne(t("admin.managerDetail.account.signup"), formaterDateHeure(manager.createdAt, i18n.language))}
                {ligne(t("admin.managerDetail.account.emailVerified"), manager.emailVerifiedAt ? t("admin.managerDetail.yes") : t("admin.managerDetail.no"))}
                {ligne(t("admin.managerDetail.account.twoFactor"), manager.twoFactorEnabled ? t("admin.managerDetail.yes") : t("admin.managerDetail.no"))}
                {ligne(t("admin.managerDetail.account.currency"), manager.currency)}
                {ligne(t("admin.managerDetail.account.lastActivity"), date(manager.lastActivityAt))}
              </dl>
            </SectionReglage>

            <SectionReglage id="agence" numero="03" titre={t("admin.managerDetail.agency.title")}>
              {manager.agency ? (
                <dl>
                  {ligne(t("admin.managerDetail.agency.name"), manager.agency.agencyName)}
                  {ligne(t("admin.managerDetail.agency.phone"), manager.agency.phone ?? "—")}
                  {ligne(t("admin.managerDetail.agency.email"), manager.agency.email ?? "—")}
                  {ligne(t("admin.managerDetail.agency.address"), manager.agency.address ?? "—")}
                  {ligne(t("admin.managerDetail.agency.registration"), manager.agency.siretOrId ?? "—")}
                </dl>
              ) : (
                <p className="text-xs text-slate-600">{t("admin.managerDetail.agency.none")}</p>
              )}
            </SectionReglage>
          <SectionReglage id="facturation" numero="04" titre={t("admin.managerDetail.billing.title")}>
            {totalEncaisse.length > 0 && (
              <p className="mb-4 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs font-semibold tabular-nums text-ink-900">
                {totalEncaisse.map(([devise, somme]) => (
                  <span key={devise}>{`${t("admin.managerDetail.billing.totalPaid")} · ${formatMoney(somme, devise)}`}</span>
                ))}
              </p>
            )}
            {manager.billingHistory.length === 0 ? (
              <p className="text-xs text-slate-600">{t("admin.managerDetail.billing.empty")}</p>
            ) : (
              <div className="relative overflow-x-auto border border-slate-300">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left">
                      <th scope="col" className="px-3 py-2.5 font-semibold">{t("admin.managerDetail.billing.date")}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{t("admin.managers.table.plan")}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{t("admin.subscriptions.table.amount")}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{t("admin.managerDetail.billing.method")}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{t("admin.managers.table.status")}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{t("admin.subscriptions.table.reference")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {manager.billingHistory.map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2.5">{date(b.createdAt)}</td>
                        <td className="px-3 py-2.5">{t(`admin.managers.plans.${b.plan}`)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold tabular-nums">{formatMoney(b.amount, b.currency)}</td>
                        <td className="px-3 py-2.5">{b.paymentMethod}</td>
                        <td className="px-3 py-2.5">{b.status}</td>
                        <td className="px-3 py-2.5 font-mono">{b.paymentRef ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionReglage>
            </div>

            {/* À droite, ce que l'administrateur peut faire : suspendre, ajuster l'abonnement, supprimer. */}
            <div className="space-y-6">
          <SectionReglage id="suspension" numero="05" danger={Boolean(manager.suspendedAt)} titre={manager.suspendedAt ? t("admin.managerDetail.suspension.suspendedTitle") : t("admin.managerDetail.suspension.title")}>
            {manager.suspendedAt ? (
              <>
                <p className="text-xs text-slate-700">
                  {t("admin.managerDetail.suspension.since", { date: date(manager.suspendedAt) })}
                </p>
                <p className="text-xs text-slate-700 mt-1 wrap-break-word">
                  <span className="font-semibold">{t("admin.managerDetail.suspension.reasonLabel")}</span>{" "}
                  {manager.suspensionReason ?? "—"}
                </p>
                <p className="text-xs text-slate-600 mt-1">{t("admin.managerDetail.suspension.reasonHidden")}</p>
                <button
                  type="button"
                  onClick={reactiver}
                  disabled={enCours}
                  className="mt-3 cursor-pointer text-xs font-semibold px-3 py-1.5 bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {enCours ? t("admin.managerDetail.suspension.reactivating") : t("admin.managerDetail.suspension.reactivate")}
                </button>
              </>
            ) : formulaireOuvert ? (
              <form onSubmit={suspendre} className="space-y-3">
                <p className="text-xs text-slate-600">{t("admin.managerDetail.suspension.warning")}</p>
                <label className="block text-xs font-semibold text-slate-700">
                  {t("admin.managerDetail.suspension.reasonField")}
                  <textarea
                    value={motif}
                    onChange={(e) => setMotif(e.target.value)}
                    maxLength={500}
                    rows={3}
                    required
                    className="mt-1 w-full border border-slate-400 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={enCours || motif.trim().length < 3}
                    className="cursor-pointer text-xs font-semibold px-3 py-1.5 bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
                  >
                    {enCours ? t("admin.managerDetail.suspension.suspending") : t("admin.managerDetail.suspension.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormulaireOuvert(false);
                      setMotif("");
                    }}
                    className="cursor-pointer text-xs font-semibold px-3 py-1.5 border border-slate-300 text-slate-700"
                  >
                    {t("admin.managerDetail.suspension.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="text-xs text-slate-600">{t("admin.managerDetail.suspension.description")}</p>
                <button
                  type="button"
                  onClick={() => setFormulaireOuvert(true)}
                  className="mt-3 cursor-pointer text-xs font-semibold px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-50"
                >
                  {t("admin.managerDetail.suspension.suspend")}
                </button>
              </>
            )}
            {infoFacturation && (
              <p role="status" className="mt-2 text-xs text-emerald-700">
                {infoFacturation}
              </p>
            )}
            {erreurAction && (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {erreurAction}
              </p>
            )}
          </SectionReglage>

          {manager.suspendedAt && (
            <SectionReglage id="suppression" numero="07" danger titre={t("admin.managerDetail.deletion.title")}>
              <p className="text-xs text-slate-600">{t("admin.managerDetail.deletion.description")}</p>
              {suppressionOuverte ? (
                <form onSubmit={supprimerDefinitivement} className="mt-3 space-y-3">
                  <p className="text-xs font-semibold text-red-700">{t("admin.managerDetail.deletion.warning")}</p>
                  <label className="block text-xs font-semibold text-slate-700">
                    {t("admin.managerDetail.deletion.emailField", { email: manager.email })}
                    <input
                      type="text"
                      value={emailSaisi}
                      onChange={(e) => setEmailSaisi(e.target.value)}
                      autoComplete="off"
                      className="mt-1 w-full border border-slate-400 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    {t("admin.managerDetail.deletion.reasonField")}
                    <textarea
                      value={motifSuppression}
                      onChange={(e) => setMotifSuppression(e.target.value)}
                      maxLength={500}
                      rows={3}
                      className="mt-1 w-full border border-slate-400 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={
                        suppressionEnCours ||
                        emailSaisi.trim().toLowerCase() !== manager.email.trim().toLowerCase() ||
                        motifSuppression.trim().length < 3
                      }
                      className="cursor-pointer text-xs font-semibold px-3 py-1.5 bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {suppressionEnCours ? t("admin.managerDetail.deletion.deleting") : t("admin.managerDetail.deletion.confirm")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSuppressionOuverte(false);
                        setEmailSaisi("");
                        setMotifSuppression("");
                        setErreurSuppression(null);
                      }}
                      className="cursor-pointer text-xs font-semibold px-3 py-1.5 border border-slate-300 text-slate-700"
                    >
                      {t("admin.managerDetail.deletion.cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setSuppressionOuverte(true)}
                  className="mt-3 cursor-pointer text-xs font-semibold px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-50"
                >
                  {t("admin.managerDetail.deletion.button")}
                </button>
              )}
              {erreurSuppression && (
                <p role="alert" className="mt-2 text-xs text-red-700">
                  {erreurSuppression}
                </p>
              )}
            </SectionReglage>
          )}

          <SectionReglage id="ajustement" numero="06" titre={t("admin.managerDetail.adjust.title")}>
            {manager.subscription.autoRenew ? (
              <p className="text-xs text-slate-600">{t("admin.managerDetail.adjust.stripe")}</p>
            ) : (
              <>
                <p className="text-xs text-slate-600 mb-3">{t("admin.managerDetail.adjust.description")}</p>
                <div className="grid gap-5">
                  {!illimite && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void ajuster("days");
                      }}
                      className="space-y-2"
                    >
                      <p className="text-xs font-semibold text-slate-900">{t("admin.managerDetail.adjust.daysTitle")}</p>
                      <label className="block text-xs font-semibold text-slate-700">
                        {t("admin.managerDetail.adjust.daysField")}
                        <input
                          type="number"
                          min={1}
                          max={365}
                          step={1}
                          required
                          value={jours}
                          onChange={(e) => setJours(e.target.value)}
                          className="mt-1 w-full border border-slate-400 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                        />
                      </label>
                      <label className="block text-xs font-semibold text-slate-700">
                        {t("admin.managerDetail.adjust.daysReason")}
                        <input
                          type="text"
                          required
                          maxLength={500}
                          value={motifJours}
                          onChange={(e) => setMotifJours(e.target.value)}
                          className="mt-1 w-full border border-slate-400 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={ajustementEnCours !== null || !(Number(jours) >= 1) || motifJours.trim().length < 3}
                        className="cursor-pointer text-xs font-semibold px-3 py-1.5 bg-ink-900 text-white hover:bg-orange-700 disabled:opacity-50"
                      >
                        {ajustementEnCours === "days" ? t("admin.managerDetail.adjust.saving") : t("admin.managerDetail.adjust.daysSubmit")}
                      </button>
                    </form>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void ajuster("plan");
                    }}
                    className="space-y-2"
                  >
                    <p className="text-xs font-semibold text-slate-900">{t("admin.managerDetail.adjust.planTitle")}</p>
                    <label className="block text-xs font-semibold text-slate-700">
                      {t("admin.managerDetail.adjust.planField")}
                      <select
                        required
                        value={nouvellePlan}
                        onChange={(e) => setNouvellePlan(e.target.value as ManagerPlan | "")}
                        className="mt-1 w-full border border-slate-400 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                      >
                        <option value="">{t("admin.managerDetail.adjust.planChoose")}</option>
                        {(["STARTER", "PRO", "ENTERPRISE"] as const)
                          .filter((p) => p !== manager.subscription.plan)
                          .map((p) => (
                            <option key={p} value={p}>
                              {t(`admin.managers.plans.${p}`)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold text-slate-700">
                      {t("admin.managerDetail.adjust.planReason")}
                      <input
                        type="text"
                        required
                        maxLength={500}
                        value={motifPlan}
                        onChange={(e) => setMotifPlan(e.target.value)}
                        className="mt-1 w-full border border-slate-400 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={ajustementEnCours !== null || nouvellePlan === "" || motifPlan.trim().length < 3}
                      className="cursor-pointer text-xs font-semibold px-3 py-1.5 bg-ink-900 text-white hover:bg-orange-700 disabled:opacity-50"
                    >
                      {ajustementEnCours === "plan" ? t("admin.managerDetail.adjust.saving") : t("admin.managerDetail.adjust.planSubmit")}
                    </button>
                  </form>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ajuster("unlimited");
                  }}
                  className="mt-4 pt-4 border-t border-slate-200 space-y-2"
                >
                  <p className="text-xs font-semibold text-slate-900">{t("admin.managerDetail.adjust.unlimitedTitle")}</p>
                  <p className="text-xs text-slate-600">
                    {illimite ? t("admin.managerDetail.adjust.unlimitedCurrent") : t("admin.managerDetail.adjust.unlimitedHelp")}
                  </p>
                  <label className="block text-xs font-semibold text-slate-700">
                    {t("admin.managerDetail.adjust.daysReason")}
                    <input
                      type="text"
                      required
                      maxLength={500}
                      value={motifIllimite}
                      onChange={(e) => setMotifIllimite(e.target.value)}
                      className="mt-1 w-full border border-slate-400 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={ajustementEnCours !== null || motifIllimite.trim().length < 3}
                    className="cursor-pointer text-xs font-semibold px-3 py-1.5 bg-ink-900 text-white hover:bg-orange-700 disabled:opacity-50"
                  >
                    {ajustementEnCours === "unlimited"
                      ? t("admin.managerDetail.adjust.saving")
                      : illimite
                        ? t("admin.managerDetail.adjust.unlimitedRevoke")
                        : t("admin.managerDetail.adjust.unlimitedGrant")}
                  </button>
                </form>
              </>
            )}
            {ajustementMessage && (
              <p
                role={ajustementMessage.type === "erreur" ? "alert" : "status"}
                className={`mt-3 text-xs ${
                  ajustementMessage.type === "erreur" ? "text-red-700" : "text-emerald-700"
                }`}
              >
                {ajustementMessage.texte}
              </p>
            )}
          </SectionReglage>

            </div>
          </div>
        </>
      )}
    </div>
  );
}
