import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Reveal, { useInView } from "../components/Reveal";
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

const COMPARE_ROWS = [
  {
    icon: "📢",
    title: "Avis d'échéance & Relances de loyer",
    description: "Anticipation des paiements et réduction des impayés",
    traditional: "Oublis fréquents, appels gênants, messages WhatsApp éparpillés, retards de paiement réguliers.",
    immoplatform: "Alerte automatique chaque 1er du mois avec échéance stricte au 5. Factures instantanées avec statut en direct.",
  },
  {
    icon: "📄",
    title: "Quittances de loyer certifiées",
    description: "Génération et délivrance légale aux locataires",
    traditional: "Création manuelle sur Word/Excel, conversion PDF fastidieuse, envois par email souvent oubliés.",
    immoplatform: "Génération automatique en 1 clic au format officiel certifié avec cachet agence, QR/numéro unique et mentions légales.",
  },
  {
    icon: "✍️",
    title: "Signature des contrats de bail",
    description: "Validation juridique et conclusion des baux",
    traditional: "Impression papier, paraphage page par page, déplacements physiques obligatoires, baux égarés.",
    immoplatform: "Signature tactile électronique (ordinateur, tablette, mobile) avec horodatage certifié en 2 minutes.",
  },
  {
    icon: "📷",
    title: "Signalement des pannes & Incidents",
    description: "Suivi des réparations et de la maintenance",
    traditional: "Appels téléphoniques d'urgence, descriptions vagues, photos non datées, historique inexistant.",
    immoplatform: "Prise de photo directe par le locataire, galerie haute résolution pour l'agence et suivi d'intervention en temps réel.",
  },
  {
    icon: "💰",
    title: "Suivi des dépenses & Cash-Flow Net",
    description: "Calcul de rentabilité réelle et comptabilité",
    traditional: "Factures d'artisans dispersées, calculs manuels de fin d'année, aucune visibilité sur le rendement net.",
    immoplatform: "Enregistrement des dépenses par catégorie, calcul automatique du Cash-Flow net et export comptable CSV en 1 clic.",
  },
  {
    icon: "🏢",
    title: "Image de marque & Multi-devises",
    description: "Professionnalisme et dimension internationale",
    traditional: "Documents neutres ou non professionnels, conversion manuelle sujette aux erreurs de change.",
    immoplatform: "Marque blanche agence (logo, SIRET, en-tête) et prise en charge multi-devises intégrale (EUR, USD, FCFA, STN, etc.).",
  },
];

/** Petite maquette illustrative du tableau de bord (pas une vraie capture d'écran). */
function DashboardMockup() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const bars = [40, 65, 50, 80, 60, 95];
  return (
    <div ref={ref} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full">
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { v: "94%", c: "text-emerald-400" },
          { v: "12", c: "text-brand-400" },
          { v: "2", c: "text-rose-400" },
        ].map((s, i) => (
          <div
            key={i}
            className={`bg-slate-950/60 rounded-xl p-2.5 text-center transition-all duration-500 motion-reduce:transition-none ${
              inView ? "opacity-100 scale-100" : "opacity-0 scale-90"
            }`}
            style={{ transitionDelay: inView ? `${i * 100}ms` : "0ms" }}
          >
            <div className={`text-lg font-extrabold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-1.5 h-24">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-md bg-gradient-to-t from-brand-600 to-indigo-400 transition-all duration-700 ease-out motion-reduce:transition-none"
            style={{ height: inView ? `${h}%` : "4%", transitionDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Maquette illustrative d'un contrat signé électroniquement (la signature se trace à l'écran). */
function ContractMockup() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full flex flex-col justify-between">
      <div className="space-y-2">
        <div className="h-2.5 w-2/3 bg-slate-700 rounded-full" />
        <div className="h-2 w-full bg-slate-800 rounded-full" />
        <div className="h-2 w-5/6 bg-slate-800 rounded-full" />
        <div className="h-2 w-4/6 bg-slate-800 rounded-full" />
      </div>
      <div className="mt-4 border-t border-slate-800 pt-4 flex items-center justify-between">
        <svg width="90" height="32" viewBox="0 0 90 32" className="text-indigo-400 overflow-visible">
          <path
            d="M2 24 C 10 6, 16 6, 22 18 S 34 30, 40 14 S 52 4, 58 20 S 70 28, 76 10 S 84 4, 88 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={160}
            strokeDashoffset={inView ? 0 : 160}
            style={{ transition: "stroke-dashoffset 1.1s ease-out 0.2s" }}
            className="motion-reduce:transition-none"
          />
        </svg>
        <span
          className={`text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full transition-all duration-500 motion-reduce:transition-none ${
            inView ? "opacity-100 scale-100" : "opacity-0 scale-75"
          }`}
          style={{ transitionDelay: "1.1s" }}
        >
          ✓ Signé
        </span>
      </div>
    </div>
  );
}

/** Maquette illustrative du suivi de rentabilité (revenus vs dépenses). */
function ExpensesMockup() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full flex flex-col justify-between">
      <div className="flex items-end gap-3 h-24">
        {[
          { r: 55, e: 20 },
          { r: 70, e: 30 },
          { r: 60, e: 25 },
          { r: 85, e: 22 },
        ].map((m, i) => (
          <div key={i} className="flex-1 flex items-end gap-0.5 h-full">
            <div
              className="flex-1 rounded-t-md bg-emerald-500/70 transition-all duration-700 ease-out motion-reduce:transition-none"
              style={{ height: inView ? `${m.r}%` : "4%", transitionDelay: `${i * 90}ms` }}
            />
            <div
              className="flex-1 rounded-t-md bg-rose-500/60 transition-all duration-700 ease-out motion-reduce:transition-none"
              style={{ height: inView ? `${m.e}%` : "4%", transitionDelay: `${i * 90 + 40}ms` }}
            />
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
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full flex flex-col gap-3">
      <div className="bg-slate-950/60 rounded-xl p-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">Loyer de septembre</span>
        <span className="text-[10px] font-bold text-white bg-brand-600 px-2.5 py-1 rounded-full animate-pulse">
          Payer
        </span>
      </div>
      <div className="flex-1 flex flex-col gap-2 justify-end">
        <div
          className={`self-start max-w-[75%] bg-slate-800 text-slate-200 text-[10px] px-3 py-2 rounded-2xl rounded-bl-sm transition-all duration-500 motion-reduce:transition-none ${
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
          style={{ transitionDelay: "150ms" }}
        >
          Bonjour, le chauffe-eau fait du bruit 🙈
        </div>
        <div
          className={`self-end max-w-[75%] bg-brand-600 text-white text-[10px] px-3 py-2 rounded-2xl rounded-br-sm transition-all duration-500 motion-reduce:transition-none ${
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
          style={{ transitionDelay: "550ms" }}
        >
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
            <img src="/app-icon.png" alt="Logo" className="w-8 h-8 rounded-xl shadow transition-transform duration-300 hover:rotate-6 hover:scale-105" />
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              {t("common.appName")}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-xs font-medium text-slate-300">
            {[
              { href: "#features", label: t("landing.nav.features") },
              { href: "#pdf", label: t("landing.nav.receipts") },
              { href: "#compare", label: t("landing.nav.compare", "Comparatif") },
              { href: "#pricing", label: t("landing.nav.pricing") },
              { href: "#trust", label: t("landing.nav.security") },
              { href: "#faq", label: t("landing.nav.faq") },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="relative hover:text-white transition-colors after:content-[''] after:absolute after:left-0 after:-bottom-1 after:h-px after:w-0 after:bg-brand-400 after:transition-all after:duration-300 hover:after:w-full"
              >
                {link.label}
              </a>
            ))}
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
        {/* Formes décoratives flottantes en arrière-plan */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-24 left-1/4 w-72 h-72 bg-brand-600/20 rounded-full blur-3xl animate-float-slow" />
          <div className="absolute top-10 right-1/4 w-72 h-72 bg-purple-600/20 rounded-full blur-3xl animate-float-delay" />
          <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-indigo-600/10 rounded-full blur-3xl animate-float" />
        </div>

        <Reveal>
          <div className="inline-flex items-center gap-2 bg-brand-950/80 border border-brand-500/30 rounded-full px-4 py-1.5 text-xs text-brand-300 font-medium mb-8 shadow-inner">
            <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse"></span>
            {t("landing.badge")}
          </div>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-[1.1]">
            {t("landing.hero.titleLine1")} <br />
            <span className="bg-[length:200%_auto] bg-gradient-to-r from-brand-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent italic animate-gradient-x">
              {t("landing.hero.titleLine2")}
            </span>
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            {t("landing.hero.subtitle")}
          </p>
        </Reveal>

        <Reveal delay={240}>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/login"
              className="w-full sm:w-auto bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm px-8 py-3.5 rounded-xl shadow-xl shadow-brand-600/30 transition-all hover:scale-105"
            >
              {t("landing.hero.ctaTrial")}
            </Link>
            <Link
              to="/login"
              className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-sm px-6 py-3.5 rounded-xl transition-all hover:scale-105"
            >
              {t("landing.hero.ctaDemo")}
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <Reveal className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.featuresSection.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">{t("landing.featuresSection.subtitle")}</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          {FEATURE_CARDS.map((card, i) => (
            <Reveal key={card.key} delay={(i % 3) * 100} className="group">
              <div className="h-full bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-black/20 transition-all duration-300">
                <div
                  className={`w-12 h-12 rounded-2xl ${card.color} flex items-center justify-center text-2xl mb-4 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6`}
                >
                  {card.icon}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{t(`landing.features.${card.key}.title`)}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{t(`landing.features.${card.key}.desc`)}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200} className="mt-8 flex flex-wrap justify-center gap-2.5">
          {extras.map((extra, i) => (
            <span
              key={i}
              className="text-xs font-medium text-slate-300 bg-slate-900/60 border border-slate-800 px-3.5 py-2 rounded-full hover:border-brand-500/50 hover:text-white transition-colors"
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              {extra}
            </span>
          ))}
        </Reveal>
      </section>

      {/* Product Tour Section */}
      <section id="pdf" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <Reveal className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.productTour.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">{t("landing.productTour.subtitle")}</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Reveal delay={0}>
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 hover:border-slate-700 transition-colors">
              <div className="h-40 mb-5">
                <DashboardMockup />
              </div>
              <h3 className="text-base font-bold text-white mb-1.5">{t("landing.productTour.dashboard.title")}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t("landing.productTour.dashboard.desc")}</p>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 hover:border-slate-700 transition-colors">
              <div className="h-40 mb-5">
                <ContractMockup />
              </div>
              <h3 className="text-base font-bold text-white mb-1.5">{t("landing.productTour.contracts.title")}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t("landing.productTour.contracts.desc")}</p>
            </div>
          </Reveal>

          <Reveal delay={0}>
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 hover:border-slate-700 transition-colors">
              <div className="h-40 mb-5">
                <ExpensesMockup />
              </div>
              <h3 className="text-base font-bold text-white mb-1.5">{t("landing.productTour.expenses.title")}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t("landing.productTour.expenses.desc")}</p>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 hover:border-slate-700 transition-colors">
              <div className="h-40 mb-5">
                <TenantMockup />
              </div>
              <h3 className="text-base font-bold text-white mb-1.5">{t("landing.productTour.tenant.title")}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t("landing.productTour.tenant.desc")}</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* For Who Section */}
      <section className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <Reveal className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.forWho.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">{t("landing.forWho.subtitle")}</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(["independent", "agency", "enterprise"] as const).map((key, i) => (
            <Reveal key={key} delay={i * 100}>
              <div className="h-full bg-slate-900/60 border border-slate-800 p-6 rounded-3xl hover:-translate-y-1.5 hover:border-slate-700 transition-all duration-300">
                <h3 className="text-base font-bold text-white mb-2">{t(`landing.forWho.${key}.title`)}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{t(`landing.forWho.${key}.desc`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Comparison Section: Gestion Traditionnelle vs ImmoPlatform Pro */}
      <section id="compare" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <Reveal className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 bg-emerald-950/70 border border-emerald-500/30 rounded-full px-4 py-1.5 text-xs text-emerald-300 font-semibold mb-4 shadow-inner">
            <span>⚖️ Comparatif & Valeur Ajoutée</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
            Gestion Traditionnelle vs{" "}
            <span className="bg-gradient-to-r from-brand-400 via-indigo-300 to-emerald-400 bg-clip-text text-transparent">
              ImmoPlatform Pro
            </span>
          </h2>
          <p className="text-sm text-slate-400 mt-3 leading-relaxed">
            Découvrez pourquoi les agences et propriétaires modernes abandonnent les tableurs Excel, les échanges WhatsApp éparpillés et la paperasse pour une gestion locative 100% automatisée.
          </p>

          {/* Badges ROI */}
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-lg mx-auto">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center hover:border-emerald-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-emerald-400">-85%</span>
              <span className="text-[11px] text-slate-400">Temps administratif</span>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center hover:border-brand-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-brand-400">0</span>
              <span className="text-[11px] text-slate-400">Loyer impayé oublié</span>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center hover:border-purple-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-purple-400">100%</span>
              <span className="text-[11px] text-slate-400">Baux & quittances certifiés</span>
            </div>
          </div>
        </Reveal>

        {/* Tableau comparatif */}
        <Reveal delay={120}>
          <div className="bg-slate-900/50 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
            {/* En-tête du tableau */}
            <div className="grid grid-cols-1 md:grid-cols-12 border-b border-slate-800 bg-slate-900/90 text-sm font-bold">
              <div className="md:col-span-4 p-5 text-slate-400 uppercase tracking-wider text-xs flex items-center">
                Fonctionnalité & Processus
              </div>
              <div className="md:col-span-4 p-5 bg-rose-950/20 text-rose-300 border-t md:border-t-0 md:border-l border-slate-800 flex items-center gap-2">
                <span className="text-base">❌</span>
                <span>Gestion Traditionnelle (Excel / Papier)</span>
              </div>
              <div className="md:col-span-4 p-5 bg-emerald-950/30 text-emerald-300 border-t md:border-t-0 md:border-l border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">✨</span>
                  <span>ImmoPlatform Pro</span>
                </div>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-semibold">
                  Recommandé
                </span>
              </div>
            </div>

            {/* Lignes du comparatif */}
            <div className="divide-y divide-slate-800/80">
              {COMPARE_ROWS.map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 md:grid-cols-12 hover:bg-slate-800/30 transition-colors duration-200"
                >
                  {/* Nom du critère */}
                  <div className="md:col-span-4 p-5 flex items-start gap-3">
                    <span className="text-xl shrink-0 mt-0.5">{row.icon}</span>
                    <div>
                      <h4 className="font-bold text-white text-sm">{row.title}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{row.description}</p>
                    </div>
                  </div>

                  {/* Gestion traditionnelle */}
                  <div className="md:col-span-4 p-5 bg-rose-950/10 border-t md:border-t-0 md:border-l border-slate-800/80 flex items-start gap-2.5">
                    <span className="text-rose-400 shrink-0 font-bold text-sm">✕</span>
                    <span className="text-xs text-slate-300 leading-relaxed">{row.traditional}</span>
                  </div>

                  {/* ImmoPlatform Pro */}
                  <div className="md:col-span-4 p-5 bg-emerald-950/15 border-t md:border-t-0 md:border-l border-slate-800/80 flex items-start gap-2.5">
                    <span className="text-emerald-400 shrink-0 font-bold text-sm">✓</span>
                    <span className="text-xs text-emerald-200/90 font-medium leading-relaxed">
                      {row.immoplatform}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* CTA sous le comparatif */}
        <Reveal delay={200} className="mt-12 text-center">
          <div className="inline-flex flex-col sm:flex-row items-center gap-4 bg-slate-900/80 border border-slate-800 p-4 sm:px-8 rounded-2xl shadow-lg">
            <span className="text-xs text-slate-300 font-medium">
              Prêt à moderniser la gestion de votre parc immobilier dès aujourd'hui ?
            </span>
            <Link
              to="/login"
              className="bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs px-6 py-2.5 rounded-xl shadow-lg shadow-brand-600/30 transition-all hover:scale-105"
            >
              Démarrer 15 jours d'essai gratuit →
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Trust / Security Section */}
      <section id="trust" className="py-24 px-6 max-w-4xl mx-auto border-t border-slate-800/80">
        <Reveal className="text-center mb-12">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.trust.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">{t("landing.trust.subtitle")}</p>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {trustItems.map((item, i) => (
            <Reveal key={i} delay={i * 80}>
              <div className="flex items-start gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 leading-relaxed hover:border-emerald-500/30 transition-colors">
                <span className="text-emerald-400 shrink-0">✓</span>
                <span>{item}</span>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200} className="text-center mt-8">
          <Link to="/confidentialite" className="text-xs font-semibold text-brand-400 hover:text-brand-300">
            {t("landing.trust.linkLabel")}
          </Link>
        </Reveal>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-24 px-6 max-w-3xl mx-auto border-t border-slate-800/80">
        <Reveal className="text-center mb-12">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.faq.title")}</h2>
        </Reveal>

        <div className="space-y-3">
          {faqItems.map((item, i) => {
            const isOpen = openFaq === i;
            return (
              <Reveal key={i} delay={i * 60}>
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-colors">
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    className="w-full flex items-center justify-between gap-4 text-left px-5 py-4"
                  >
                    <span className="text-sm font-semibold text-white">{item.q}</span>
                    <span
                      className={`text-slate-500 transition-transform duration-300 shrink-0 ${isOpen ? "rotate-45" : ""}`}
                    >
                      +
                    </span>
                  </button>
                  <div
                    className={`grid transition-all duration-300 ease-in-out motion-reduce:transition-none ${
                      isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 pb-4 text-xs text-slate-400 leading-relaxed">{item.a}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <Reveal className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">{t("landing.pricing.title")}</h2>
          <p className="text-sm text-slate-400 mt-3">
            {t("landing.pricing.subtitle")}
          </p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Starter */}
          <Reveal delay={0}>
            <div className="h-full bg-slate-900/40 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between hover:-translate-y-1.5 hover:border-slate-700 transition-all duration-300">
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
          </Reveal>

          {/* Pro */}
          <Reveal delay={100}>
            <div className="h-full bg-gradient-to-b from-brand-950/80 to-slate-900 border-2 border-brand-500 rounded-3xl p-8 flex flex-col justify-between relative shadow-2xl shadow-brand-900/40 hover:-translate-y-2 transition-all duration-300">
              <span className="absolute -top-3 right-6 bg-brand-500 text-white text-[10px] uppercase font-extrabold px-3 py-0.5 rounded-full tracking-wider animate-pulse">
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
          </Reveal>

          {/* Enterprise */}
          <Reveal delay={200}>
            <div className="h-full bg-slate-900/40 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between hover:-translate-y-1.5 hover:border-slate-700 transition-all duration-300">
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
          </Reveal>
        </div>
      </section>

      {/* Final CTA Banner */}
      <section className="px-6 max-w-7xl mx-auto pb-24">
        <Reveal>
          <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 to-indigo-700 rounded-3xl px-8 py-16 text-center shadow-2xl shadow-brand-900/40">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute inset-y-0 -left-1/2 w-1/3 bg-white/10 animate-shine" />
            </div>
            <h2 className="relative text-2xl sm:text-3xl font-extrabold text-white max-w-xl mx-auto">
              {t("landing.finalCta.title")}
            </h2>
            <p className="relative text-sm text-brand-100 mt-4 max-w-lg mx-auto">{t("landing.finalCta.subtitle")}</p>
            <Link
              to="/login"
              className="relative mt-8 inline-block bg-white hover:bg-slate-100 text-brand-700 font-bold text-sm px-8 py-3.5 rounded-xl shadow-xl transition-all hover:scale-105"
            >
              {t("landing.finalCta.cta")}
            </Link>
          </div>
        </Reveal>
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
