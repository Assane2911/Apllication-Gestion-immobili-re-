import { AlertTriangle, Check, CheckCircle2, Clock, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { api, apiErrorMessage } from "../../api/client";
import BankDetails from "../../components/BankDetails";
import { useAuth } from "../../context/auth";
import { useCurrency } from "../../context/currency";
import { useMoyensDePaiement } from "../../hooks/useMoyensDePaiement";
import { useRetourDePaiement } from "../../hooks/useRetourDePaiement";
import type { PaymentMethod, PlatformBankInfo, SubscriptionPlanDetail } from "../../types";
import Bulle from "../../components/Bulle";
import Dialogue from "../../components/Dialogue";
import { FORMULE_REPRISE } from "../../data/lignesFormules";
import { formaterDateHeureLongue } from "../../utils/dateHeure";

interface SubscriptionHistoryRecord {
  id: string;
  plan: string;
  amount: number;
  /** Devise dans laquelle CETTE ligne a été réglée — pas forcément celle affichée ailleurs sur la page (voir formatMoney(h.amount, h.currency) plus bas). */
  currency: string;
  billingCycle: string;
  status: string;
  paymentMethod: string;
  paymentRef: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

/**
 * Consommation du plafond de biens de la formule (voir getStatus côté
 * serveur). `max` vaut null pour la formule illimitée.
 */
interface PropertyUsage {
  count: number;
  max: number | null;
  exceeded: boolean;
}


export default function SubscriptionPage() {
  const { t, i18n } = useTranslation();

  /** Ligne d'une carte de formule : traduite par sa clé ; le texte français du serveur reste le repli. */
  function libelleLigne(plan: SubscriptionPlanDetail, idx: number): string {
    const cle = plan.featureKeys?.[idx];
    const texte = plan.features[idx];
    if (!cle) return texte;
    const reprise = FORMULE_REPRISE[cle];
    return t(`manager.subscription.features.${cle}`, {
      defaultValue: texte,
      plan: reprise ? t(`common.plans.${reprise}`) : undefined,
    });
  }
  const { user, refreshUser } = useAuth();
  const { currency, formatMoney } = useCurrency();
  const [plans, setPlans] = useState<SubscriptionPlanDetail[]>([]);
  const [history, setHistory] = useState<SubscriptionHistoryRecord[]>([]);
  const [propertyUsage, setPropertyUsage] = useState<PropertyUsage | null>(null);
  const [billingCycle, setBillingCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanDetail | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("PAYDUNYA");
  const [bankRef, setBankRef] = useState("");
  const [bankInfo, setBankInfo] = useState<PlatformBankInfo | null>(null);
  const [autoRenew, setAutoRenew] = useState(false);
  const [, setLoading] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isNativeApp = Capacitor.isNativePlatform();

  // Les moyens proposés viennent du serveur, seul à savoir quelles clés sont
  // configurées et dans quelle devise le compte encaisse. Les masquer en dur
  // ici — comme c'était le cas pour Stripe et DEMO — laissait l'interface et
  // le serveur diverger : le bouton s'affichait, le paiement échouait.
  const moyensDisponibles = useMoyensDePaiement(currency, "abonnement");
  const paymentMethods = (moyensDisponibles ?? []).map((key) => ({
    key: key as PaymentMethod,
    label: t(`manager.subscription.paymentMethods.${key}.label`),
    hint: t(`manager.subscription.paymentMethods.${key}.hint`),
  }));

  // Le moyen présélectionné doit exister dans la liste : sinon le premier clic
  // sur « Payer » partirait sur un moyen que le serveur refuse.
  useEffect(() => {
    if (moyensDisponibles && moyensDisponibles.length > 0 && !moyensDisponibles.includes(selectedMethod)) {
      setSelectedMethod(moyensDisponibles[0]);
    }
  }, [moyensDisponibles, selectedMethod]);

  // Coordonnées bancaires de LA PLATEFORME (distinctes de celles de l'agence
  // affichées au locataire) : nécessaires si le gestionnaire choisit de régler
  // son abonnement par virement. Échec silencieux : l'absence de RIB configuré
  // ne doit pas empêcher d'afficher le reste du formulaire de paiement.
  useEffect(() => {
    api
      .get<PlatformBankInfo>("/subscription/bank-details")
      .then((res) => setBankInfo(res.data))
      .catch(() => setBankInfo(null));
  }, []);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<SubscriptionPlanDetail[]>(`/subscription/plans?currency=${encodeURIComponent(currency)}`),
      api.get<{ history: SubscriptionHistoryRecord[]; propertyUsage?: PropertyUsage }>("/subscription/status"),
    ])
      .then(([plansRes, statusRes]) => {
        // Un corps de réponse inattendu (204, réponse vide, proxy qui tronque)
        // mettait `undefined` dans l'état, et le rendu suivant plantait sur
        // `plans.map` — page blanche, sans message. La CI l'a révélé : vitest
        // signale ces exceptions même quand tous les tests passent, et sort
        // en erreur. L'état reste donc toujours un tableau.
        setPlans(Array.isArray(plansRes.data) ? plansRes.data : []);
        setHistory(Array.isArray(statusRes.data?.history) ? statusRes.data.history : []);
        setPropertyUsage(statusRes.data?.propertyUsage ?? null);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
    // useCallback plutot qu'une simple fonction : loadData est passee a
    // useRetourDePaiement et sert de dependance a l'effet ci-dessous.
    // Redefinie a chaque rendu, elle aurait relance ces deux usages en
    // boucle -- et la declarer stable vaut mieux que faire taire
    // l'avertissement du linter.
  }, [currency]);

  // Les tarifs dépendent de la devise : en changer doit les recharger, sinon
  // l'écran afficherait des montants dans une devise qu'il n'a plus.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Doit venir APRÈS la définition de loadData : le hook la rappelle plusieurs
  // fois pour laisser au webhook le temps d'arriver.
  const retourPaiement = useRetourDePaiement(loadData);

  async function handleSubscribe() {
    if (!selectedPlan) return;
    setSubscribing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data } = await api.post("/subscription/subscribe", {
        plan: selectedPlan.id,
        billingCycle,
        paymentMethod: selectedMethod,
        bankReference: selectedMethod === "BANK_TRANSFER" ? bankRef : undefined,
        // Renouvellement automatique réel (Stripe Subscriptions) : réservé au
        // paiement par carte — voir CGU §4. Le serveur ignore/rejette cette
        // valeur pour tout autre moyen, mais autant ne jamais l'envoyer.
        autoRenew: selectedMethod === "STRIPE" ? autoRenew : undefined,
      });

      // PayDunya (et Stripe une fois branché) redirigent vers une page de
      // paiement hébergée plutôt que de confirmer immédiatement — voir
      // payment.service.ts. La confirmation définitive arrive plus tard via
      // le webhook IPN.
      if (data.payment?.status === "REQUIRES_ACTION" && data.payment?.redirectUrl) {
        window.location.href = data.payment.redirectUrl;
        return;
      }

      setSuccessMessage(data.message);
      setSelectedPlan(null);
      await refreshUser();
      loadData();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubscribing(false);
    }
  }

  async function handleCancelSubscription() {
    if (!confirm(t("manager.subscription.confirmCancel"))) return;
    setCancelling(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const { data } = await api.post("/subscription/cancel");
      setSuccessMessage(data.message);
      await refreshUser();
      loadData();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  const sub = user?.subscription;
  // ACTIVE sans échéance : accès illimité offert par l'administration (rien à payer, rien à résilier).
  const illimite = sub?.status === "ACTIVE" && !sub.subscriptionEndsAt;

  // Remise annuelle réellement pratiquée, calculée à partir des tarifs reçus
  // du serveur plutôt qu'annoncée en dur : un badge figé aurait continué à
  // afficher "-20%" même si un futur changement de TARIFS (backend) modifiait
  // le rabais réel, sans que rien ne l'empêche de diverger silencieusement.
  // Toutes les formules partagent le même taux par construction (voir le
  // commentaire sur TARIFS côté backend) ; la première suffit donc comme
  // référence, et se met à jour automatiquement quand les plans chargent.
  const planReference = plans[0];
  const remiseAnnuelle =
    planReference && planReference.monthlyPrice > 0
      ? Math.round((1 - planReference.annualPrice / (planReference.monthlyPrice * 12)) * 100)
      : null;

  const nomFormule = (plan: SubscriptionPlanDetail) => t(`common.plans.${plan.id}`, { defaultValue: plan.name });
  const pctBiens = propertyUsage && propertyUsage.max ? Math.min(100, Math.round((propertyUsage.count / propertyUsage.max) * 100)) : 0;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">{t("manager.subscription.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("manager.subscription.subtitle")}</p>
      </div>

      {/* Messages */}
      {/* Retour d'un prestataire de paiement (Stripe ou PayDunya) : la
          confirmation arrive par webhook, donc parfois après le retour du
          navigateur — d'où un message distinct du succès immédiat. */}
      {retourPaiement === "succes" && (
        <div className="flex items-center gap-2 border border-sky-200 bg-sky-50 px-4 py-3 text-sky-800 shadow-[inset_4px_0_0_var(--color-sky-600)]">
          <Clock size={16} className="shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">{t("common.payment.returned")}</span>
        </div>
      )}
      {retourPaiement === "annule" && (
        <div className="flex items-center gap-2 border border-orange-700/40 bg-orange-50 px-4 py-3 text-orange-900 shadow-[inset_4px_0_0_var(--color-orange-700)]">
          <Undo2 size={16} className="shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">{t("common.payment.cancelled")}</span>
        </div>
      )}
      {successMessage && (
        <div role="status" className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-800 shadow-[inset_4px_0_0_var(--color-emerald-600)]">
          <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">{successMessage}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 border border-red-200 bg-red-50 px-4 py-3 text-red-700 shadow-[inset_4px_0_0_var(--color-rose-600)]">
          <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Dépassement du plafond de biens : le plafond n'est vérifié qu'à la
          création (property.controller.ts), donc un gestionnaire redescendu de
          formule conserve ses biens et continue de les exploiter. On ne lui
          retire rien — ses locataires sont réels — mais il doit savoir où il
          en est, et depuis quel écran corriger. */}
      {propertyUsage?.exceeded && propertyUsage.max !== null && (
        <div className="flex items-start gap-2 border border-orange-700/40 bg-orange-50 px-4 py-3 text-orange-900 shadow-[inset_4px_0_0_var(--color-orange-700)]">
          <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
          <span className="text-sm">
            {t("manager.subscription.propertyCapExceeded", {
              count: propertyUsage.count,
              max: propertyUsage.max,
            })}
          </span>
        </div>
      )}

      {/* État actuel de l'abonnement : une fiche à bandeau, trois cases (formule, échéance, biens utilisés). */}
      <section aria-label={t("manager.subscription.currentStatus")} className="border border-slate-300 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-ink-900 bg-ink-900 px-5 py-2.5 text-white">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">{t("manager.subscription.currentStatus")}</span>
          {/* Résiliation (CGU §7 : "à tout moment depuis son espace de
              gestion") — uniquement pour un abonnement payant ACTIF ; déjà
              résilié (CANCELLED) ou pas encore souscrit, rien à résilier. */}
          {sub?.status === "ACTIVE" && !illimite && (
            <button
              type="button"
              onClick={handleCancelSubscription}
              disabled={cancelling}
              className="cursor-pointer whitespace-nowrap border-b border-white/50 text-xs font-semibold text-white hover:border-white disabled:opacity-60"
            >
              {cancelling ? t("manager.subscription.cancelling") : t("manager.subscription.cancelButton")}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 divide-y divide-slate-300 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.subscription.cells.plan")}</p>
            <h2 className="mt-1.5 text-lg font-bold leading-snug text-slate-900">
              {sub?.status === "ACTIVE"
                ? t("manager.subscription.planActive", { plan: t(`common.plans.${sub.plan}`, { defaultValue: sub.plan }) })
                : sub?.status === "TRIAL"
                ? t("manager.subscription.trialStatus")
                : t("manager.subscription.expiredStatus")}
            </h2>
            <span
              className={`mt-2 inline-block border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                sub?.status === "ACTIVE"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : sub?.isTrialActive
                  ? "border-orange-700/50 bg-orange-50 text-orange-800"
                  : "border-rose-300 bg-rose-50 text-rose-800"
              }`}
            >
              {illimite
                ? t("manager.subscription.unlimited")
                : sub?.status === "ACTIVE"
                ? t("manager.subscription.paid")
                : sub?.isTrialActive
                ? t("manager.subscription.trialRemaining", { count: sub.trialDaysRemaining })
                : t("manager.subscription.expired")}
            </span>
          </div>

          <div className="p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.subscription.cells.due")}</p>
            {sub?.status === "TRIAL" && (
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-ink-900">
                {sub.trialDaysRemaining} <span className="text-sm font-medium text-slate-600">{t("manager.subscription.days")}</span>
              </p>
            )}
            <p className={`text-xs leading-relaxed text-slate-700 ${sub?.status === "TRIAL" ? "mt-0.5" : "mt-1.5"}`}>
              {illimite
                ? t("manager.subscription.unlimitedHelp")
                : sub?.isTrialActive && sub.trialEndsAt
                ? t("manager.subscription.trialEndsAt", {
                    date: formaterDateHeureLongue(sub.trialEndsAt, i18n.language),
                  })
                : sub?.subscriptionEndsAt
                ? t("manager.subscription.nextDueDate", {
                    date: formaterDateHeureLongue(sub.subscriptionEndsAt, i18n.language),
                  })
                : t("manager.subscription.choosePlanPrompt")}
            </p>
          </div>

          <div className="p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.subscription.cells.usage")}</p>
            {propertyUsage ? (
              <>
                <p className="mt-1.5 text-lg font-bold tabular-nums text-slate-900">
                  {propertyUsage.max === null
                    ? t("manager.subscription.usage.unlimited", { count: propertyUsage.count })
                    : t("manager.subscription.usage.of", { count: propertyUsage.count, max: propertyUsage.max })}
                </p>
                {propertyUsage.max !== null && (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={propertyUsage.max}
                    aria-valuenow={propertyUsage.count}
                    aria-label={t("manager.subscription.cells.usage")}
                    className="mt-2 h-2 border border-slate-400 bg-white"
                  >
                    <div className={`h-full ${propertyUsage.exceeded ? "bg-rose-600" : pctBiens >= 80 ? "bg-orange-700" : "bg-ink-900"}`} style={{ width: `${pctBiens}%` }} />
                  </div>
                )}
              </>
            ) : (
              <p className="mt-1.5 text-lg font-bold text-slate-500">—</p>
            )}
          </div>
        </div>
      </section>

      {/* Switch Mensuel / Annuel */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-stretch border border-slate-400 bg-white">
          <button
            onClick={() => setBillingCycle("MONTHLY")}
            className={`cursor-pointer border-r border-slate-400 px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              billingCycle === "MONTHLY" ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
            }`}
          >
            {t("manager.subscription.monthlyBilling")}
          </button>
          <button
            onClick={() => setBillingCycle("ANNUAL")}
            className={`flex cursor-pointer items-center gap-2 px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              billingCycle === "ANNUAL" ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
            }`}
          >
            <span>{t("manager.subscription.annualBilling")}</span>
            {remiseAnnuelle !== null && remiseAnnuelle > 0 && (
              <span className={`px-1.5 py-0.5 text-[10px] font-bold ${billingCycle === "ANNUAL" ? "bg-orange-700 text-white" : "bg-emerald-100 text-emerald-800"}`}>
                -{remiseAnnuelle}%
              </span>
            )}
          </button>
        </div>

        {/* Les 12 devises du sélecteur sont toutes tarifées côté backend (voir
            TARIFS, subscription.controller.ts) — mais users.currency n'a pas
            de liste blanche aussi stricte que les autres devises de
            l'application (updateCurrency valide pourtant via deviseSchema,
            comme les autres ; le cas réel est une valeur héritée d'avant
            cette validation, ou posée directement en base). deviseFacturee()
            retombe alors silencieusement sur l'euro : ce message évite que ça
            passe pour une erreur d'affichage plutôt qu'un repli de sécurité. */}
        {planReference && planReference.currency !== currency && (
          <p className="max-w-md text-center text-xs text-slate-600">
            {t("manager.subscription.unsupportedCurrencyNotice", { currency: planReference.currency })}
          </p>
        )}
      </div>

      {/* Tableau des formules (masqué sur build mobile native : la souscription se fait sur le web) */}
      {!isNativeApp && (
        <div className="grid grid-cols-1 divide-y divide-slate-300 border border-slate-300 bg-white md:grid-cols-3 md:divide-x md:divide-y-0">
          {plans.map((plan, rang) => {
            const isCurrentPlan = sub?.plan === plan.id && sub?.status === "ACTIVE";
            const price = billingCycle === "ANNUAL" ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;

            return (
              <div key={plan.id} className="relative flex flex-col">
                <div
                  className={`border-b px-6 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                    plan.popular ? "border-orange-700 bg-orange-700 text-white" : "border-slate-300 bg-slate-50 text-slate-600"
                  }`}
                >
                  {plan.popular ? t("manager.subscription.mostPopular") : String(rang + 1).padStart(2, "0")}
                </div>

                <div className="flex flex-1 flex-col p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold text-slate-900">{nomFormule(plan)}</h3>
                    <p className="mt-1 min-h-[32px] text-xs text-slate-600">{t(`manager.subscription.planDescriptions.${plan.id}`, { defaultValue: plan.description })}</p>
                  </div>

                  <div className="mb-6 flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-3xl font-black tabular-nums text-slate-900">{formatMoney(price, plan.currency)}</span>
                    <span className="text-xs font-medium text-slate-600">{t("manager.subscription.perMonth")}</span>
                    {billingCycle === "ANNUAL" && (
                      <span className="w-full text-[11px] text-slate-600">
                        {t("manager.subscription.billedAnnually", { amount: formatMoney(plan.annualPrice, plan.currency) })}
                      </span>
                    )}
                  </div>

                  <div className="mb-6 flex-1 space-y-2.5 border-t border-slate-300 pt-4 text-xs text-slate-700">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-900">{t("manager.subscription.includedInPlan")}</p>
                    {plan.features.map((_feat, idx) => (
                      <div key={idx} className="flex items-start gap-2.5">
                        <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center border border-emerald-600 bg-emerald-50">
                          <Check size={11} strokeWidth={3} className="text-emerald-700" aria-hidden="true" />
                        </span>
                        <span>{libelleLigne(plan, idx)}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      setSelectedPlan(plan);
                      setAutoRenew(false);
                    }}
                    disabled={isCurrentPlan}
                    className={`w-full border px-4 py-2.5 text-xs font-bold transition-colors ${
                      isCurrentPlan
                        ? "cursor-not-allowed border-slate-300 bg-slate-100 text-slate-600"
                        : plan.popular
                        ? "cursor-pointer border-orange-700 bg-orange-700 text-white hover:bg-orange-800"
                        : "cursor-pointer border-ink-900 bg-ink-900 text-white hover:bg-brand-600"
                    }`}
                  >
                    {isCurrentPlan ? t("manager.subscription.currentPlanBtn") : t("manager.subscription.choosePlanBtn", { plan: nomFormule(plan) })}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isNativeApp && sub?.status !== "ACTIVE" && (
        <div className="border border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
          {t("manager.subscription.nativeFallback")}
        </div>
      )}

      {/* Modal de Souscription / Paiement */}
      {!isNativeApp && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <Dialogue onClose={() => setSelectedPlan(null)} titreId="subscription-modal-title" fermable={!subscribing} className="w-full max-w-lg border-2 border-ink-900 bg-white">
            <div className="flex items-start justify-between gap-3 border-b border-ink-900 bg-ink-900 px-6 py-4 text-white">
              <div>
                <h3 id="subscription-modal-title" className="text-lg font-bold">{t("manager.subscription.subscribeTo", { plan: nomFormule(selectedPlan) })}</h3>
                <p className="mt-0.5 text-xs text-white/80">
                  {t("manager.subscription.amountToPay")}{" "}
                  <strong className="font-mono text-white">
                    {billingCycle === "ANNUAL"
                      ? `${formatMoney(selectedPlan.annualPrice, selectedPlan.currency)} ${t("manager.subscription.perYearShort")}`
                      : `${formatMoney(selectedPlan.monthlyPrice, selectedPlan.currency)} ${t("manager.subscription.perMonthShort")}`}
                  </strong>
                </p>
              </div>
              <button
                onClick={() => setSelectedPlan(null)}
                className="cursor-pointer p-1 text-white/80 hover:text-white"
                aria-label={t("common.actions.close")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6 p-6">
              {/* Choix du moyen de paiement */}
              <div className="space-y-3">
                <span id="subscription-payment-method" className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.subscription.paymentMethodLabel")}</span>
                <div role="radiogroup" aria-labelledby="subscription-payment-method" className="grid grid-cols-1 gap-2.5">
                  {paymentMethods.map((m) => (
                    <label
                      key={m.key}
                      className={`flex cursor-pointer items-start gap-3 border p-3 transition-colors ${
                        selectedMethod === m.key
                          ? "border-ink-900 bg-slate-50 shadow-[inset_4px_0_0_var(--color-orange-700)]"
                          : "border-slate-300 hover:border-ink-900"
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={m.key}
                        checked={selectedMethod === m.key}
                        onChange={() => setSelectedMethod(m.key)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-900">{m.label}</p>
                        <p className="mt-0.5 text-[11px] text-slate-600">{m.hint}</p>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Renouvellement automatique réel (Stripe Subscriptions) :
                    réservé au paiement par carte via Stripe, "explicitement
                    proposé dans l'interface" (CGU §4) — PayDunya et le
                    virement restent des paiements ponctuels, à renouveler soi-même
                    à chaque échéance. */}
                {selectedMethod === "STRIPE" && (
                  <label className="flex cursor-pointer items-start gap-2.5 border border-slate-300 p-3">
                    <input
                      type="checkbox"
                      checked={autoRenew}
                      onChange={(e) => setAutoRenew(e.target.checked)}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-900">
                        {t("manager.subscription.autoRenewLabel")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-600">
                        {t("manager.subscription.autoRenewHint")}
                      </p>
                    </div>
                  </label>
                )}

                {selectedMethod === "BANK_TRANSFER" && (
                  <div className="pt-2">
                    <BankDetails
                      info={bankInfo}
                      title={t("manager.subscription.bankDetails.title")}
                      ibanLabel={t("manager.subscription.bankDetails.iban")}
                      bicLabel={t("manager.subscription.bankDetails.bic")}
                      missingMessage={t("manager.subscription.bankDetails.missing")}
                      copyLabel={t("manager.subscription.bankDetails.copy")}
                      copiedLabel={t("manager.subscription.bankDetails.copied")}
                    />
                    <label htmlFor="subscription-bank-ref" className="mb-1 mt-3 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.subscription.bankRefLabel")}</label>
                    <input
                      id="subscription-bank-ref"
                      type="text"
                      value={bankRef}
                      onChange={(e) => setBankRef(e.target.value)}
                      placeholder={t("manager.subscription.bankRefPlaceholder")}
                      className="w-full border border-slate-400 bg-white px-3 py-2 text-xs text-slate-900"
                    />
                  </div>
                )}
              </div>

              {/* Boutons d'action */}
              <div className="flex items-center justify-end gap-4 border-t border-slate-300 pt-4">
                <button
                  type="button"
                  onClick={() => setSelectedPlan(null)}
                  className="cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
                >
                  {t("common.actions.cancel")}
                </button>
                <Bulle texte={t("manager.tips.subscribe")}>
                  <button
                    type="button"
                    onClick={handleSubscribe}
                    disabled={subscribing}
                    className="cursor-pointer border border-ink-900 bg-ink-900 px-5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                  >
                    {subscribing ? t("manager.subscription.processing") : t("manager.subscription.confirmAndActivate")}
                  </button>
                </Bulle>
              </div>
            </div>
          </Dialogue>
        </div>
      )}

      {/* Historique des paiements de la plateforme */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">
            {t("manager.subscription.historyTitle")}
            <span aria-hidden="true" className="h-px flex-1 bg-slate-300" />
          </h3>
          <div className="overflow-x-auto border border-slate-300 bg-white">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="px-4 py-2.5">{t("manager.subscription.historyTable.date")}</th>
                  <th className="px-4 py-2.5">{t("manager.subscription.historyTable.plan")}</th>
                  <th className="px-4 py-2.5">{t("manager.subscription.historyTable.cycle")}</th>
                  <th className="px-4 py-2.5">{t("manager.subscription.historyTable.amount")}</th>
                  <th className="px-4 py-2.5">{t("manager.subscription.historyTable.method")}</th>
                  <th className="px-4 py-2.5">{t("manager.subscription.historyTable.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {history.map((h) => (
                  <tr key={h.id} className="text-slate-700">
                    <td className="px-4 py-3 tabular-nums">{new Date(h.createdAt).toLocaleDateString(i18n.language)}</td>
                    <td className="px-4 py-3 font-semibold">{t(`common.plans.${h.plan}`, { defaultValue: h.plan })}</td>
                    <td className="px-4 py-3">{h.billingCycle === "ANNUAL" ? t("manager.subscription.annual") : t("manager.subscription.monthly")}</td>
                    {/* Chaque ligne porte sa propre devise (voir platformSubscriptions.currency
                        côté backend) : un abonnement réglé en FCFA ne doit jamais s'afficher en
                        euros — c'est exactement le bug déjà corrigé sur AdminSubscriptionsPage. */}
                    <td className="px-4 py-3 font-bold tabular-nums">{formatMoney(h.amount, h.currency)}</td>
                    <td className="px-4 py-3 font-mono text-[11px]">{h.paymentMethod}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                        {h.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
