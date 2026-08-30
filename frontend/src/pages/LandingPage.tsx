import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useAuth } from "../context/AuthContext";

const FEATURE_CARDS = [
  { key: "receipts", icon: "📄", color: "bg-brand-600/20 text-brand-400" },
  { key: "signature", icon: "✍️", color: "bg-indigo-600/20 text-indigo-400" },
  { key: "reminders", icon: "📢", color: "bg-emerald-600/20 text-emerald-400" },
  { key: "dashboard", icon: "📊", color: "bg-purple-600/20 text-purple-400" },
  { key: "expenses", icon: "💰", color: "bg-amber-600/20 text-amber-400" },
  { key: "tenantPortal", icon: "🏠", color: "bg-sky-600/20 text-sky-400" },
  { key: "security", icon: "🔒", color: "bg-rose-600/20 text-rose-400" },
  { key: "multiCurrency", icon: "🌍", color: "bg-teal-600/20 text-teal-400" },
  { key: "multiLanguage", icon: "🗣️", color: "bg-fuchsia-600/20 text-fuchsia-400" },
] as const;

/** Petite maquette illustrative du tableau de bord (pas une vraie capture d'écran). */
function DashboardMockup() {
  const bars = [40, 65, 50, 80, 60, 95];
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full">
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { v: "94%", c: "text-emerald-400" },
          { v: "12", c: "text-brand-400" },
          { v: "2", c: "text-rose-400" },
        ].map((s, i) => (
          <div key={i} className="bg-slate-950/60 rounded-xl p-2.5 text-center">
            <div className={`text-lg font-extrabold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-1.5 h-24">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-md bg-gradient-to-t from-brand-600 to-indigo-400"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Maquette illustrative d'un contrat signé électroniquement. */
function ContractMockup() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full flex flex-col justify-between">
      <div className="space-y-2">
        <div className="h-2.5 w-2/3 bg-slate-700 rounded-full" />
        <div className="h-2 w-full bg-slate-800 rounded-full" />
        <div className="h-2 w-5/6 bg-slate-800 rounded-full" />
        <div className="h-2 w-4/6 bg-slate-800 rounded-full" />
      </div>
      <div className="mt-4 border-t border-slate-800 pt-4 flex items-center justify-between">
        <svg width="90" height="32" viewBox="0 0 90 32" className="text-indigo-400">
          <path
            d="M2 24 C 10 6, 16 6, 22 18 S 34 30, 40 14 S 52 4, 58 20 S 70 28, 76 10 S 84 4, 88 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">
          ✓ Signé
        </span>
      </div>
    </div>
  );
}

/** Maquette illustrative du suivi de rentabilité (revenus vs dépenses). */
function ExpensesMockup() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full flex flex-col justify-between">
      <div className="flex items-end gap-3 h-24">
        {[
          { r: 55, e: 20 },
          { r: 70, e: 30 },
          { r: 60, e: 25 },
          { r: 85, e: 22 },
        ].map((m, i) => (
          <div key={i} className="flex-1 flex items-end gap-0.5 h-full">
            <div className="flex-1 rounded-t-md bg-emerald-500/70" style={{ height: `${m.r}%` }} />
            <div className="flex-1 rounded-t-md bg-rose-500/60" style={{ height: `${m.e}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-slate-400">Flux net</span>
        <span className="font-bold text-emerald-400">+ 68%</span>
      </div>
    </div>
  );
}

/** Maquette illustrative du portail locataire (mobile). */
function TenantMockup() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full flex flex-col gap-3">
      <div className="bg-slate-950/60 rounded-xl p-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">Loyer de septembre</span>
        <span className="text-[10px] font-bold text-white bg-brand-600 px-2.5 py-1 rounded-full">Payer</span>
      </div>
      <div className="flex-1 flex flex-col gap-2 justify-end">
        <div className="self-start max-w-[75%] bg-slate-800 text-slate-200 text-[10px] px-3 py-2 rounded-2xl rounded-bl-sm">
          Bonjour, le chauffe-eau fait du bruit 🙈
        </div>
        <div className="self-end max-w-[75%] bg-brand-600 text-white text-[10px] px-3 py-2 rounded-2xl rounded-br-sm">
          Merci, j'envoie un plombier demain !
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const starterFeatures = t("landing.pricing.starter.features", { returnObjects: true }) as string[];
  const proFeatures = t("landing.pricing.pro.features", { returnObjects: true }) as string[];
  const enterpriseFeatures = t("landing.pricing.enterprise.features", { returnObjects: true }) as string[];
  const extras = t("landing.extras", { returnObjects: true }) as string[];
  const trustItems = t("landing.trust.items", { returnObjects: true }) as string[];
  const faqItems = t("landing.faq.items", { returnObjects: true }) as { q: string; a: string }[];

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
            <a href="#trust" className="hover:text-white transition-colors">
              {t("landing.nav.security")}
            </a>
            <a href="#faq" className="hover:text-white transition-colors">
              {t("landing.nav.faq")}
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
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.featuresSection.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">{t("landing.featuresSection.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          {FEATURE_CARDS.map((card) => (
            <div
              key={card.key}
              className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 transition-colors"
            >
              <div className={`w-12 h-12 rounded-2xl ${card.color} flex items-center justify-center text-2xl mb-4`}>
                {card.icon}
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{t(`landing.features.${card.key}.title`)}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t(`landing.features.${card.key}.desc`)}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          {extras.map((extra, i) => (
            <span
              key={i}
              className="text-xs font-medium text-slate-300 bg-slate-900/60 border border-slate-800 px-3.5 py-2 rounded-full"
            >
              {extra}
            </span>
          ))}
        </div>
      </section>

      {/* Product Tour Section */}
      <section id="pdf" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.productTour.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">{t("landing.productTour.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
            <div className="h-40 mb-5">
              <DashboardMockup />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">{t("landing.productTour.dashboard.title")}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{t("landing.productTour.dashboard.desc")}</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
            <div className="h-40 mb-5">
              <ContractMockup />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">{t("landing.productTour.contracts.title")}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{t("landing.productTour.contracts.desc")}</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
            <div className="h-40 mb-5">
              <ExpensesMockup />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">{t("landing.productTour.expenses.title")}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{t("landing.productTour.expenses.desc")}</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
            <div className="h-40 mb-5">
              <TenantMockup />
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">{t("landing.productTour.tenant.title")}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{t("landing.productTour.tenant.desc")}</p>
          </div>
        </div>
      </section>

      {/* For Who Section */}
      <section className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.forWho.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">{t("landing.forWho.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(["independent", "agency", "enterprise"] as const).map((key) => (
            <div key={key} className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl">
              <h3 className="text-base font-bold text-white mb-2">{t(`landing.forWho.${key}.title`)}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t(`landing.forWho.${key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust / Security Section */}
      <section id="trust" className="py-24 px-6 max-w-4xl mx-auto border-t border-slate-800/80">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.trust.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">{t("landing.trust.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {trustItems.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 leading-relaxed"
            >
              <span className="text-emerald-400 shrink-0">✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <Link to="/confidentialite" className="text-xs font-semibold text-brand-400 hover:text-brand-300">
            {t("landing.trust.linkLabel")}
          </Link>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-24 px-6 max-w-3xl mx-auto border-t border-slate-800/80">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.faq.title")}</h2>
        </div>

        <div className="space-y-3">
          {faqItems.map((item, i) => {
            const isOpen = openFaq === i;
            return (
              <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 text-left px-5 py-4"
                >
                  <span className="text-sm font-semibold text-white">{item.q}</span>
                  <span className={`text-slate-500 transition-transform shrink-0 ${isOpen ? "rotate-45" : ""}`}>
                    +
                  </span>
                </button>
                {isOpen && (
                  <p className="px-5 pb-4 text-xs text-slate-400 leading-relaxed">{item.a}</p>
                )}
              </div>
            );
          })}
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

      {/* Final CTA Banner */}
      <section className="px-6 max-w-7xl mx-auto pb-24">
        <div className="bg-gradient-to-br from-brand-600 to-indigo-700 rounded-3xl px-8 py-16 text-center shadow-2xl shadow-brand-900/40">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white max-w-xl mx-auto">
            {t("landing.finalCta.title")}
          </h2>
          <p className="text-sm text-brand-100 mt-4 max-w-lg mx-auto">{t("landing.finalCta.subtitle")}</p>
          <Link
            to="/login"
            className="mt-8 inline-block bg-white hover:bg-slate-100 text-brand-700 font-bold text-sm px-8 py-3.5 rounded-xl shadow-xl transition-all hover:scale-105"
          >
            {t("landing.finalCta.cta")}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-12 px-6 bg-slate-950 text-center text-xs text-slate-500">
        <p>{t("landing.footer.rights")}</p>
        <p className="mt-2">{t("landing.footer.tagline")}</p>
        <div className="mt-4 flex items-center justify-center gap-4">
          <Link to="/mentions-legales" className="hover:text-slate-300 transition-colors">
            Mentions légales
          </Link>
          <span className="text-slate-700">·</span>
          <Link to="/cgu" className="hover:text-slate-300 transition-colors">
            CGU &amp; CGV
          </Link>
          <span className="text-slate-700">·</span>
          <Link to="/confidentialite" className="hover:text-slate-300 transition-colors">
            Confidentialité
          </Link>
        </div>
      </footer>
    </div>
  );
}
