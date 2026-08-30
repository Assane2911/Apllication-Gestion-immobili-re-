import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import type { PaymentMethod, SubscriptionPlanDetail } from "../../types";

interface SubscriptionHistoryRecord {
  id: string;
  plan: string;
  amount: number;
  billingCycle: string;
  status: string;
  paymentMethod: string;
  paymentRef: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

const paymentMethods: { key: PaymentMethod; label: string; hint: string }[] = [
  { key: "STRIPE", label: "💳 Carte bancaire", hint: "Paiement sécurisé par carte via Stripe" },
  { key: "PAYDUNYA", label: "🌍 PayDunya", hint: "Orange Money, Wave, Free Money, MTN, carte bancaire..." },
  { key: "BANK_TRANSFER", label: "🏦 Virement bancaire", hint: "Validation sous 24h par virement" },
  { key: "DEMO", label: "🧪 Mode démo", hint: "Activation immédiate pour tests et validation" },
];

export default function SubscriptionPage() {
  const { user, refreshUser } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlanDetail[]>([]);
  const [history, setHistory] = useState<SubscriptionHistoryRecord[]>([]);
  const [billingCycle, setBillingCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanDetail | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("STRIPE");
  const [bankRef, setBankRef] = useState("");
  const [, setLoading] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadData() {
    setLoading(true);
    Promise.all([
      api.get<SubscriptionPlanDetail[]>("/subscription/plans"),
      api.get<{ history: SubscriptionHistoryRecord[] }>("/subscription/status"),
    ])
      .then(([plansRes, statusRes]) => {
        setPlans(plansRes.data);
        setHistory(statusRes.data.history || []);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

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

  const sub = user?.subscription;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Abonnement & Formules SaaS</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Gérez votre formule de gestion immobilière et vos options de facturation.
        </p>
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-4 py-3 rounded-xl flex items-center gap-2">
          <span>🎉</span>
          <span className="text-sm font-medium">{successMessage}</span>
        </div>
      )}
      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl flex items-center gap-2">
          <span>⚠️</span>
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* État actuel de l'abonnement */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <span className="text-xs uppercase font-semibold text-slate-400 dark:text-slate-500 tracking-wider">
            Votre statut actuel
          </span>
          <div className="flex items-center gap-3 mt-1">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {sub?.status === "ACTIVE"
                ? `Formule ${sub.plan} Active`
                : sub?.status === "TRIAL"
                ? "Période d'essai gratuit (15 jours)"
                : "Abonnement Expiré"}
            </h2>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                sub?.status === "ACTIVE"
                  ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                  : sub?.isTrialActive
                  ? "bg-brand-100 dark:bg-brand-500/20 text-brand-800 dark:text-brand-300"
                  : "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300"
              }`}
            >
              {sub?.status === "ACTIVE"
                ? "Payé"
                : sub?.isTrialActive
                ? `Essai : ${sub.trialDaysRemaining} j restant(s)`
                : "Expiré"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {sub?.isTrialActive && sub.trialEndsAt
              ? `Votre période d'essai se termine le ${new Date(sub.trialEndsAt).toLocaleDateString("fr-FR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}.`
              : sub?.subscriptionEndsAt
              ? `Prochaine échéance le ${new Date(sub.subscriptionEndsAt).toLocaleDateString("fr-FR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}.`
              : "Choisissez une formule ci-dessous pour débloquer ou maintenir vos accès."}
          </p>
        </div>

        {sub?.status === "TRIAL" && (
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center md:text-right">
            <p className="text-xs text-slate-500 dark:text-slate-400">Temps d'évaluation offert</p>
            <p className="text-2xl font-black text-brand-600 dark:text-brand-400">
              {sub.trialDaysRemaining} <span className="text-sm font-medium text-slate-600 dark:text-slate-400">jours</span>
            </p>
          </div>
        )}
      </div>

      {/* Switch Mensuel / Annuel */}
      <div className="flex flex-col items-center gap-3">
        <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex items-center border border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setBillingCycle("MONTHLY")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              billingCycle === "MONTHLY"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            Facturation Mensuelle
          </button>
          <button
            onClick={() => setBillingCycle("ANNUAL")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              billingCycle === "ANNUAL"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <span>Facturation Annuelle</span>
            <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
              -20%
            </span>
          </button>
        </div>
      </div>

      {/* Grille des Plans */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const isCurrentPlan = sub?.plan === plan.id && sub?.status === "ACTIVE";
          const price = billingCycle === "ANNUAL" ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;

          return (
            <div
              key={plan.id}
              className={`bg-white dark:bg-slate-900 rounded-2xl border transition-all relative flex flex-col p-6 shadow-sm ${
                plan.popular
                  ? "border-brand-500 dark:border-brand-400 ring-2 ring-brand-500/20"
                  : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-[11px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                  Le plus populaire
                </span>
              )}

              <div className="mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{plan.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 min-h-[32px]">{plan.description}</p>
              </div>

              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-3xl font-black text-slate-900 dark:text-slate-100">{price} €</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">/ mois</span>
                {billingCycle === "ANNUAL" && (
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-1">
                    (facturé {plan.annualPrice} € / an)
                  </span>
                )}
              </div>

              <div className="flex-1 space-y-2.5 mb-6 text-xs text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 pt-4">
                <p className="font-semibold text-slate-900 dark:text-slate-100">Inclus dans l'offre :</p>
                {plan.features.map((feat, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="text-emerald-500 dark:text-emerald-400 font-bold">✓</span>
                    <span>{feat}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setSelectedPlan(plan)}
                disabled={isCurrentPlan}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-sm ${
                  isCurrentPlan
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                    : plan.popular
                    ? "bg-brand-600 hover:bg-brand-700 text-white hover:shadow"
                    : "bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white hover:shadow"
                }`}
              >
                {isCurrentPlan ? "Votre formule actuelle" : `Choisir ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Modal de Souscription / Paiement */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-6 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Souscription à l'offre {selectedPlan.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Montant à régler :{" "}
                  <strong>
                    {billingCycle === "ANNUAL" ? `${selectedPlan.annualPrice} € / an` : `${selectedPlan.monthlyPrice} € / mois`}
                  </strong>
                </p>
              </div>
              <button
                onClick={() => setSelectedPlan(null)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Choix du moyen de paiement */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Moyen de règlement</label>
              <div className="grid grid-cols-1 gap-2.5">
                {paymentMethods.map((m) => (
                  <label
                    key={m.key}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedMethod === m.key
                        ? "border-brand-500 dark:border-brand-400 bg-brand-50/50 dark:bg-brand-500/10"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
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
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{m.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{m.hint}</p>
                    </div>
                  </label>
                ))}
              </div>

              {selectedMethod === "BANK_TRANSFER" && (
                <div className="pt-2">
                  <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Numéro ou référence du virement :</label>
                  <input
                    type="text"
                    value={bankRef}
                    onChange={(e) => setBankRef(e.target.value)}
                    placeholder="Ex: VIR-2026-08-01"
                    className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                  />
                </div>
              )}
            </div>

            {/* Boutons d'action */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedPlan(null)}
                className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSubscribe}
                disabled={subscribing}
                className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50"
              >
                {subscribing ? "Traitement en cours..." : "Confirmer et Activer l'Abonnement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historique des paiements de la plateforme */}
      {history.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Historique de vos factures d'abonnement</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[10px]">
                  <th className="py-2.5">Date</th>
                  <th className="py-2.5">Plan</th>
                  <th className="py-2.5">Cycle</th>
                  <th className="py-2.5">Montant</th>
                  <th className="py-2.5">Méthode</th>
                  <th className="py-2.5">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {history.map((h) => (
                  <tr key={h.id} className="text-slate-700 dark:text-slate-300">
                    <td className="py-3">{new Date(h.createdAt).toLocaleDateString("fr-FR")}</td>
                    <td className="py-3 font-semibold">{h.plan}</td>
                    <td className="py-3">{h.billingCycle === "ANNUAL" ? "Annuel" : "Mensuel"}</td>
                    <td className="py-3 font-bold">{h.amount} €</td>
                    <td className="py-3">{h.paymentMethod}</td>
                    <td className="py-3">
                      <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
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
