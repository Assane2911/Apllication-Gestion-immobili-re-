import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function TrialBanner() {
  const { user } = useAuth();

  if (!user || user.role !== "MANAGER" || !user.subscription) {
    return null;
  }

  const { status, trialDaysRemaining, isTrialActive, isExpired, plan } = user.subscription;

  if (isExpired) {
    return (
      <div className="bg-gradient-to-r from-red-600 to-rose-700 text-white px-4 py-3 rounded-xl shadow-sm mb-6 flex flex-wrap items-center justify-between gap-3 animate-pulse">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="font-semibold text-sm">Période d'essai expirée</p>
            <p className="text-xs text-red-100">
              Votre période d'essai de 15 jours est terminée. Veuillez souscrire à une formule pour continuer à utiliser l'application.
            </p>
          </div>
        </div>
        <Link
          to="/subscription"
          className="bg-white text-red-700 hover:bg-red-50 text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition-transform hover:scale-105"
        >
          Débloquer mon compte →
        </Link>
      </div>
    );
  }

  if (isTrialActive) {
    const isUrgent = trialDaysRemaining <= 3;
    const isWarning = trialDaysRemaining <= 7;

    const bgGradient = isUrgent
      ? "from-amber-600 to-orange-700"
      : isWarning
      ? "from-indigo-600 to-brand-700"
      : "from-slate-900 to-brand-900";

    return (
      <div className={`bg-gradient-to-r ${bgGradient} text-white px-4 py-3 rounded-xl shadow-sm mb-6 flex flex-wrap items-center justify-between gap-3 border border-white/10`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm shrink-0">
            ⏳
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-white/20 text-white text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                Mode Essai 15 Jours
              </span>
              <span className="text-xs font-medium text-white/90">
                {trialDaysRemaining === 0
                  ? "Dernier jour d'essai !"
                  : trialDaysRemaining === 1
                  ? "Il vous reste 1 jour d'essai"
                  : `Il vous reste ${trialDaysRemaining} jours d'essai gratuit`}
              </span>
            </div>
            <p className="text-xs text-white/80 mt-0.5">
              Profitez de toutes les fonctionnalités Pro sans engagement. Vous pouvez activer votre abonnement à tout moment.
            </p>
          </div>
        </div>
        <Link
          to="/subscription"
          className="bg-white text-slate-900 hover:bg-slate-100 text-xs font-semibold px-3.5 py-1.5 rounded-lg shadow-sm transition-all hover:scale-105 shrink-0"
        >
          Choisir mon offre ✨
        </Link>
      </div>
    );
  }

  if (status === "ACTIVE") {
    return (
      <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2 rounded-xl mb-6 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Abonnement <strong>Plan {plan}</strong> actif</span>
        </div>
        <Link to="/subscription" className="text-emerald-700 hover:underline font-medium">
          Gérer mon abonnement
        </Link>
      </div>
    );
  }

  return null;
}
