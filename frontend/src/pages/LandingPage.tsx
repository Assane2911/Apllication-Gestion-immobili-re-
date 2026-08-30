import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useAuth } from "../context/AuthContext";

export default function LandingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const starterFeatures = t("landing.pricing.starter.features", { returnObjects: true }) as string[];
  const proFeatures = t("landing.pricing.pro.features", { returnObjects: true }) as string[];
  const enterpriseFeatures = t("landing.pricing.enterprise.features", { returnObjects: true }) as string[];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-brand-500 selection:text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/app-icon.png" alt="Logo" className="w-8 h-8 rounded-xl shadow" />
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              {t("common.appName")}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-xs font-medium text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">
              {t("landing.nav.features")}
            </a>
            <a href="#pdf" className="hover:text-white transition-colors">
              {t("landing.nav.receipts")}
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              {t("landing.nav.pricing")}
            </a>
            <a href="#multi-currency" className="hover:text-white transition-colors">
              {t("landing.nav.currencies")}
            </a>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {user ? (
              <Link
                to={user.role === "MANAGER" ? "/" : "/portail"}
                className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-lg shadow-brand-600/30"
              >
                {t("landing.nav.goToSpace")}
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-xs font-medium text-slate-300 hover:text-white px-3 py-2"
                >
                  {t("landing.nav.login")}
                </Link>
                <Link
                  to="/login"
                  className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-lg shadow-brand-600/30"
                >
                  {t("landing.nav.trial")}
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 px-6 max-w-7xl mx-auto text-center overflow-hidden">
        <div className="inline-flex items-center gap-2 bg-brand-950/80 border border-brand-500/30 rounded-full px-4 py-1.5 text-xs text-brand-300 font-medium mb-8 shadow-inner">
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse"></span>
          {t("landing.badge")}
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-[1.1]">
          {t("landing.hero.titleLine1")} <br />
          <span className="bg-gradient-to-r from-brand-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent italic">
            {t("landing.hero.titleLine2")}
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          {t("landing.hero.subtitle")}
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/login"
            className="w-full sm:w-auto bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm px-8 py-3.5 rounded-xl shadow-xl shadow-brand-600/30 transition-all hover:scale-105"
          >
            {t("landing.hero.ctaTrial")}
          </Link>
          <Link
            to="/login"
            className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-sm px-6 py-3.5 rounded-xl transition-all"
          >
            {t("landing.hero.ctaDemo")}
          </Link>
        </div>

        {/* Feature Cards Grid */}
        <div id="features" className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-brand-600/20 text-brand-400 flex items-center justify-center text-2xl mb-4">
              📄
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{t("landing.features.receipts.title")}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t("landing.features.receipts.desc")}
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center text-2xl mb-4">
              ✍️
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{t("landing.features.signature.title")}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t("landing.features.signature.desc")}
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center text-2xl mb-4">
              📢
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{t("landing.features.reminders.title")}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t("landing.features.reminders.desc")}
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.pricing.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">
            {t("landing.pricing.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Starter */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("landing.pricing.starter.name")}</span>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">9€</span>
                <span className="text-slate-400 text-xs">{t("landing.pricing.perMonth")}</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">{t("landing.pricing.starter.desc")}</p>
              <ul className="mt-6 space-y-3 text-xs text-slate-300">
                {starterFeatures.map((feat, i) => (
                  <li key={i}>✓ {feat}</li>
                ))}
              </ul>
            </div>
            <Link
              to="/login"
              className="mt-8 w-full block text-center bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs py-3 rounded-xl transition-colors"
            >
              {t("landing.pricing.starter.cta")}
            </Link>
          </div>

          {/* Pro */}
          <div className="bg-gradient-to-b from-brand-950/80 to-slate-900 border-2 border-brand-500 rounded-3xl p-8 flex flex-col justify-between relative shadow-2xl shadow-brand-900/40">
            <span className="absolute -top-3 right-6 bg-brand-500 text-white text-[10px] uppercase font-extrabold px-3 py-0.5 rounded-full tracking-wider">
              {t("landing.pricing.pro.badge")}
            </span>
            <div>
              <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">{t("landing.pricing.pro.name")}</span>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">25€</span>
                <span className="text-slate-400 text-xs">{t("landing.pricing.perMonth")}</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">{t("landing.pricing.pro.desc")}</p>
              <ul className="mt-6 space-y-3 text-xs text-slate-200">
                {proFeatures.map((feat, i) => (
                  <li key={i}>✓ {feat}</li>
                ))}
              </ul>
            </div>
            <Link
              to="/login"
              className="mt-8 w-full block text-center bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs py-3 rounded-xl transition-colors shadow-lg shadow-brand-600/30"
            >
              {t("landing.pricing.pro.cta")}
            </Link>
          </div>

          {/* Enterprise */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("landing.pricing.enterprise.name")}</span>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">49€</span>
                <span className="text-slate-400 text-xs">{t("landing.pricing.perMonth")}</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">{t("landing.pricing.enterprise.desc")}</p>
              <ul className="mt-6 space-y-3 text-xs text-slate-300">
                {enterpriseFeatures.map((feat, i) => (
                  <li key={i}>✓ {feat}</li>
                ))}
              </ul>
            </div>
            <Link
              to="/login"
              className="mt-8 w-full block text-center bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs py-3 rounded-xl transition-colors"
            >
              {t("landing.pricing.enterprise.cta")}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-12 px-6 bg-slate-950 text-center text-xs text-slate-500">
        <p>{t("landing.footer.rights")}</p>
        <p className="mt-2">{t("landing.footer.tagline")}</p>
      </footer>
    </div>
  );
}
