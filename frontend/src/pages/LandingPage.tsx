import {
  Apple,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  Globe,
  Home,
  Languages,
  LayoutDashboard,
  Lock,
  Megaphone,
  PenLine,
  Receipt,
  Scale,
  Smartphone,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import JsonLd from "../components/JsonLd";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useMediaQuery } from "../hooks/useMediaQuery";
import Reveal from "../components/Reveal";
import Seo from "../components/Seo";
import { FORMULE_REPRISE, LIGNES_FORMULES, type IdFormule } from "../data/lignesFormules";
import { useInView } from "../hooks/useInView";
import { useAuth } from "../context/auth";
import { buildOrganizationJsonLd, buildSoftwareApplicationJsonLd } from "../utils/structuredData";
import { homePathForRole } from "../utils/roleHome";

const FEATURE_CARDS = [
  { key: "receipts", icon: Receipt, color: "bg-brand-600/20 text-brand-400" },
  { key: "signature", icon: PenLine, color: "bg-indigo-600/20 text-indigo-400" },
  { key: "reminders", icon: Megaphone, color: "bg-emerald-600/20 text-emerald-400" },
  { key: "dashboard", icon: LayoutDashboard, color: "bg-purple-600/20 text-purple-400" },
  { key: "expenses", icon: Wallet, color: "bg-amber-600/20 text-amber-400" },
  { key: "tenantPortal", icon: Home, color: "bg-sky-600/20 text-sky-400" },
  { key: "security", icon: Lock, color: "bg-rose-600/20 text-rose-400" },
  { key: "multiCurrency", icon: Globe, color: "bg-teal-600/20 text-teal-400" },
  { key: "multiLanguage", icon: Languages, color: "bg-fuchsia-600/20 text-fuchsia-400" },
] as const;

const COMPARE_ROWS = [
  { key: "reminders", icon: Megaphone },
  { key: "receipts", icon: Receipt },
  { key: "signature", icon: PenLine },
  { key: "incidents", icon: Camera },
  { key: "expenses", icon: Wallet },
  { key: "branding", icon: Building2 },
] as const;

/**
 * Fond clair de la zone d'accueil, dessiné (aucune photo : pas de droit d'auteur, aucun poids d'image) : la lumière du jour
 * qui entre par de grandes fenêtres, légèrement floue, comme une photo d'intérieur. Purement décoratif.
 */
function FondAccueil() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-linear-to-b from-slate-200 via-slate-100 to-white">
      <div className="absolute -top-40 -right-24 h-152 w-152 rounded-full bg-sky-200/60 blur-3xl" />
      <div className="absolute top-1/3 -left-32 h-112 w-md rounded-full bg-brand-200/50 blur-3xl" />
      <svg className="absolute inset-0 h-full w-full opacity-60 blur-[3px]" viewBox="0 0 1200 760" preserveAspectRatio="xMaxYMid slice">
        <defs>
          <linearGradient id="accueil-vitre" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#bae6fd" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="accueil-rayon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* La grande fenêtre de droite : quatre vitres derrière un cadre clair */}
        <g transform="translate(700 40)">
          <rect width="440" height="640" rx="10" fill="#e2e8f0" />
          {[0, 1].flatMap((colonne) =>
            [0, 1].map((ligne) => (
              <rect key={`${colonne}-${ligne}`} x={16 + colonne * 214} y={16 + ligne * 312} width="196" height="296" rx="4" fill="url(#accueil-vitre)" stroke="#94a3b8" strokeOpacity="0.5" />
            )),
          )}
        </g>
        {/* Un encadrement de porte à gauche, dans l'ombre */}
        <g transform="translate(60 120)">
          <rect width="170" height="560" rx="6" fill="#cbd5e1" fillOpacity="0.7" />
          <rect x="18" y="18" width="134" height="524" rx="3" fill="#e2e8f0" />
          <rect x="112" y="280" width="26" height="8" rx="4" fill="#64748b" fillOpacity="0.6" />
        </g>
        {/* Le rayon de lumière qui traverse la pièce */}
        <polygon points="520,0 760,0 380,760 140,760" fill="url(#accueil-rayon)" />
      </svg>
    </div>
  );
}

/**
 * Carte d'essai gratuit de l'accueil : l'adresse e-mail saisie ici est reprise, déjà remplie, sur la page d'inscription. Rien n'est
 * envoyé ni enregistré tant que la personne n'a pas validé l'inscription elle-même.
 */
function CarteEssai() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");

  function demarrer(e: React.FormEvent) {
    e.preventDefault();
    const adresse = email.trim();
    navigate(adresse ? `/inscription?email=${encodeURIComponent(adresse)}` : "/inscription");
  }

  return (
    <form onSubmit={demarrer} className="mx-auto w-full max-w-3xl rounded-sm bg-white px-5 py-6 shadow-2xl shadow-slate-900/15 sm:px-8" aria-label={t("landing.hero.formLabel")}>
      <p className="text-center font-accueil text-[11px] tracking-wide text-slate-700 uppercase">
        <span className="font-bold text-slate-900">{t("landing.hero.formTitle")}</span> / {t("landing.hero.formSubtitle")}
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="accueil-email" className="sr-only">
          {t("landing.hero.emailLabel")}
        </label>
        <input
          id="accueil-email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("landing.hero.emailPlaceholder")}
          className="min-w-0 flex-1 border border-brand-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-600 focus:outline-2 focus:outline-offset-0 focus:outline-brand-600"
        />
        <button type="submit" className="bg-brand-600 px-6 py-3 font-accueil text-sm font-black tracking-wide text-white uppercase transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">
          {t("landing.hero.ctaTrial")}
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-slate-600">
        <a href="#pricing" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
          {t("landing.hero.ctaPricing")}
        </a>
      </p>
    </form>
  );
}

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
            className="flex-1 rounded-t-md bg-linear-to-t from-brand-600 to-indigo-400 transition-all duration-700 ease-out motion-reduce:transition-none"
            style={{ height: inView ? `${h}%` : "4%", transitionDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Maquette illustrative d'un contrat signé électroniquement (la signature se trace à l'écran). */
function ContractMockup() {
  const { t } = useTranslation();
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
          <CheckCircle2 size={11} className="inline shrink-0 -mt-0.5" aria-hidden="true" /> {t("landing.mock.signed")}
        </span>
      </div>
    </div>
  );
}

/** Maquette illustrative du suivi de rentabilité (revenus vs dépenses). */
function ExpensesMockup() {
  const { t } = useTranslation();
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
        <span className="text-slate-400">{t("landing.mock.netFlow")}</span>
        <span className="font-bold text-emerald-400">+ 68%</span>
      </div>
    </div>
  );
}

/** Maquette illustrative du portail locataire (mobile). */
function TenantMockup() {
  const { t } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-full flex flex-col gap-3">
      <div className="bg-slate-950/60 rounded-xl p-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{t("landing.mock.rentMonth")}</span>
        <span className="text-[10px] font-bold text-white bg-brand-600 px-2.5 py-1 rounded-full animate-pulse">
          {t("landing.mock.pay")}
        </span>
      </div>
      <div className="flex-1 flex flex-col gap-2 justify-end">
        <div
          className={`self-start max-w-[75%] bg-slate-800 text-slate-200 text-[10px] px-3 py-2 rounded-2xl rounded-bl-sm transition-all duration-500 motion-reduce:transition-none ${
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
          style={{ transitionDelay: "150ms" }}
        >
          {t("landing.mock.tenantMessage")}
        </div>
        <div
          className={`self-end max-w-[75%] bg-brand-600 text-white text-[10px] px-3 py-2 rounded-2xl rounded-br-sm transition-all duration-500 motion-reduce:transition-none ${
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
          style={{ transitionDelay: "550ms" }}
        >
          {t("landing.mock.managerReply")}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Sous 640 px, l'en-tête ne tient qu'en version resserrée (voir LandingPage.mobile.test.tsx).
  const telephone = useMediaQuery("(max-width: 639px)");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Mêmes lignes et mêmes descriptions que les cartes de la page Abonnement du gestionnaire (voir data/lignesFormules.ts).
  const lignesFormule = (id: IdFormule) =>
    LIGNES_FORMULES[id].map((cle) =>
      t(`manager.subscription.features.${cle}`, {
        plan: FORMULE_REPRISE[cle] ? t(`common.plans.${FORMULE_REPRISE[cle]}`) : undefined,
      })
    );
  const starterFeatures = lignesFormule("STARTER");
  const proFeatures = lignesFormule("PRO");
  const enterpriseFeatures = lignesFormule("ENTERPRISE");
  const extras = t("landing.extras", { returnObjects: true }) as string[];
  const trustItems = t("landing.trust.items", { returnObjects: true }) as string[];
  const faqItems = t("landing.faq.items", { returnObjects: true }) as { q: string; a: string }[];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-brand-500 selection:text-white">
      <Seo title={t("seo.landing.title")} description={t("seo.landing.description")} canonical="/" />
      <JsonLd data={buildOrganizationJsonLd()} />
      <JsonLd data={buildSoftwareApplicationJsonLd()} />
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/app-icon.png" alt="Logo" className="w-8 h-8 rounded-xl shadow transition-transform duration-300 hover:rotate-6 hover:scale-105" />
            <span className="sr-only sm:not-sr-only whitespace-nowrap font-bold text-lg tracking-tight bg-linear-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              {t("common.appName")}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-xs font-medium text-slate-300">
            {/*
              La vitrine publique existait — route, page, API — mais AUCUN
              écran n'y menait : `/vitrine` n'apparaissait qu'une fois dans
              tout le frontend, dans sa propre déclaration de route. Les
              annonces étaient donc publiées et servies correctement, et
              simplement invisibles pour qui ne tapait pas l'adresse à la main.
            */}
            <Link
              to="/vitrine"
              className="relative hover:text-white transition-colors after:content-[''] after:absolute after:left-0 after:-bottom-1 after:h-px after:w-0 after:bg-brand-400 after:transition-all after:duration-300 hover:after:w-full"
            >
              {t("landing.nav.vitrine")}
            </Link>
            {[
              { href: "#features", label: t("landing.nav.features") },
              { href: "#pdf", label: t("landing.nav.receipts") },
              { href: "#compare", label: t("landing.nav.compare") },
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

          <div className="flex items-center gap-1.5 sm:gap-3">
            <LanguageSwitcher compact={telephone} />
            {user ? (
              <Link
                to={homePathForRole(user.role)}
                className="whitespace-nowrap bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 sm:px-4 py-2 rounded-xl transition-all shadow-lg shadow-brand-600/30"
              >
                {t("landing.nav.goToSpace")}
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="whitespace-nowrap text-xs font-medium text-slate-300 hover:text-white px-1.5 sm:px-3 py-2"
                >
                  {t("landing.nav.login")}
                </Link>
                <Link
                  to="/inscription"
                  className="whitespace-nowrap bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-2.5 sm:px-4 py-2 rounded-xl transition-all shadow-lg shadow-brand-600/30"
                >
                  {telephone ? t("landing.nav.trialShort") : t("landing.nav.trial")}
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main>
      {/* Zone d'accueil : fond clair dessiné, bloc logo, titre fin avec le nom en gras, carte d'essai gratuit, barre de la marque. */}
      <section className="relative isolate overflow-hidden pt-16">
        <FondAccueil />

        <div className="mx-auto flex max-w-7xl flex-col items-center px-6 text-center">
          <Reveal>
            <div className="bg-slate-950 px-8 py-5 text-white shadow-xl shadow-slate-900/20">
              <div className="flex items-center justify-center gap-3">
                <img src="/app-icon.png" alt="" className="h-8 w-8 rounded-lg" />
                <span className="text-lg font-bold tracking-tight">{t("common.appName")}</span>
              </div>
              <p className="mt-1 font-accueil text-[10px] tracking-[0.3em] text-slate-300 uppercase">{t("landing.hero.logoCaption")}</p>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="mt-10 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-4 py-1.5 text-xs font-medium text-brand-800 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-brand-600 motion-safe:animate-pulse"></span>
              {t("landing.badge")}
            </div>
          </Reveal>

          <Reveal delay={140}>
            <h1 className="mt-8 max-w-5xl font-accueil text-3xl leading-tight tracking-wide text-slate-900 uppercase sm:text-4xl lg:text-5xl">
              <span className="block font-light">{t("landing.hero.titleLine1")}</span>
              <strong className="mt-1 block font-black">{t("landing.hero.titleLine2")}</strong>
            </h1>
          </Reveal>

          <Reveal delay={200}>
            <p className="mt-6 max-w-2xl font-accueil text-base leading-relaxed font-light text-slate-800 sm:text-lg">{t("landing.hero.subtitle")}</p>
          </Reveal>

          <Reveal delay={260} className="mt-14 w-full">
            <div className="relative z-10 -mb-8">
              <CarteEssai />
            </div>
          </Reveal>
        </div>

        <div className="bg-brand-600 pt-14 pb-5">
          <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-6 text-xs text-white">
            <Apple className="h-4 w-4 shrink-0" aria-hidden="true" />
            <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t("landing.hero.mobileSoon")}
          </p>
        </div>
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
              <div className="h-full bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-xs hover:border-slate-700 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-black/20 transition-all duration-300">
                <div
                  className={`w-12 h-12 rounded-2xl ${card.color} flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6`}
                >
                  <card.icon size={24} strokeWidth={1.75} aria-hidden="true" />
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
            <Scale size={13} aria-hidden="true" /> <span>{t("landing.compare.badge")}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
            {t("landing.compare.titlePrefix")}{" "}
            <span className="bg-linear-to-r from-brand-400 via-indigo-300 to-emerald-400 bg-clip-text text-transparent">
              ImmoPlatform Pro
            </span>
          </h2>
          <p className="text-sm text-slate-400 mt-3 leading-relaxed">
            {t("landing.compare.subtitle")}
          </p>

          {/* Badges ROI */}
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-lg mx-auto">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center hover:border-emerald-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-emerald-400">-85%</span>
              <span className="text-[11px] text-slate-400">{t("landing.compare.roi.adminTime")}</span>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center hover:border-brand-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-brand-400">0</span>
              <span className="text-[11px] text-slate-400">{t("landing.compare.roi.unpaidRent")}</span>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center hover:border-purple-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-purple-400">100%</span>
              <span className="text-[11px] text-slate-400">{t("landing.compare.roi.certified")}</span>
            </div>
          </div>
        </Reveal>

        {/* Tableau comparatif */}
        <Reveal delay={120}>
          <div className="bg-slate-900/50 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
            {/* En-tête du tableau */}
            <div className="grid grid-cols-1 md:grid-cols-12 border-b border-slate-800 bg-slate-900/90 text-sm font-bold">
              <div className="md:col-span-4 p-5 text-slate-400 uppercase tracking-wider text-xs flex items-center">
                {t("landing.compare.headers.feature")}
              </div>
              <div className="md:col-span-4 p-5 bg-rose-950/20 text-rose-300 border-t md:border-t-0 md:border-l border-slate-800 flex items-center gap-2">
                <X size={16} className="shrink-0" aria-hidden="true" />
                <span>{t("landing.compare.headers.traditional")}</span>
              </div>
              <div className="md:col-span-4 p-5 bg-emerald-950/30 text-emerald-300 border-t md:border-t-0 md:border-l border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="shrink-0" aria-hidden="true" />
                  <span>ImmoPlatform Pro</span>
                </div>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-semibold">
                  {t("landing.compare.headers.recommended")}
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
                    <row.icon size={20} strokeWidth={1.75} className="shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
                    <div>
                      <h3 className="font-bold text-white text-sm">{t(`landing.compare.rows.${row.key}.title`)}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">{t(`landing.compare.rows.${row.key}.description`)}</p>
                    </div>
                  </div>

                  {/* Gestion traditionnelle */}
                  <div className="md:col-span-4 p-5 bg-rose-950/10 border-t md:border-t-0 md:border-l border-slate-800/80 flex items-start gap-2.5">
                    <X size={15} className="text-rose-400 shrink-0" aria-hidden="true" />
                    <span className="text-xs text-slate-300 leading-relaxed">{t(`landing.compare.rows.${row.key}.traditional`)}</span>
                  </div>

                  {/* ImmoPlatform Pro */}
                  <div className="md:col-span-4 p-5 bg-emerald-950/15 border-t md:border-t-0 md:border-l border-slate-800/80 flex items-start gap-2.5">
                    <Check size={15} strokeWidth={2.5} className="text-emerald-400 shrink-0" aria-hidden="true" />
                    <span className="text-xs text-emerald-200/90 font-medium leading-relaxed">
                      {t(`landing.compare.rows.${row.key}.immoplatform`)}
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
              {t("landing.compare.cta.text")}
            </span>
            <Link
              to="/inscription"
              className="bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs px-6 py-2.5 rounded-xl shadow-lg shadow-brand-600/30 transition-all hover:scale-105"
            >
              {t("landing.compare.cta.button")}
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
                <Check size={15} strokeWidth={2.5} className="text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
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
                <p className="text-xs text-slate-400 mt-2">{t("manager.subscription.planDescriptions.STARTER")}</p>
                <ul className="mt-6 space-y-3 text-xs text-slate-300">
                  {starterFeatures.map((feat, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check size={13} strokeWidth={2.5} className="shrink-0 mt-0.5 text-emerald-400" aria-hidden="true" />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                to="/inscription"
                className="mt-8 w-full block text-center bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs py-3 rounded-xl transition-colors"
              >
                {t("landing.pricing.starter.cta")}
              </Link>
            </div>
          </Reveal>

          {/* Pro */}
          <Reveal delay={100}>
            <div className="h-full bg-linear-to-b from-brand-950/80 to-slate-900 border-2 border-brand-500 rounded-3xl p-8 flex flex-col justify-between relative shadow-2xl shadow-brand-900/40 hover:-translate-y-2 transition-all duration-300">
              <span className="absolute -top-3 right-6 bg-brand-500 text-white text-[10px] uppercase font-extrabold px-3 py-0.5 rounded-full tracking-wider animate-pulse">
                {t("landing.pricing.pro.badge")}
              </span>
              <div>
                <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">{t("landing.pricing.pro.name")}</span>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-white">29€</span>
                  <span className="text-slate-400 text-xs">{t("landing.pricing.perMonth")}</span>
                </div>
                <p className="text-xs text-slate-400 mt-2">{t("manager.subscription.planDescriptions.PRO")}</p>
                <ul className="mt-6 space-y-3 text-xs text-slate-200">
                  {proFeatures.map((feat, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check size={13} strokeWidth={2.5} className="shrink-0 mt-0.5 text-emerald-400" aria-hidden="true" />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                to="/inscription"
                className="mt-8 w-full block text-center bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs py-3 rounded-xl transition-colors shadow-lg shadow-brand-600/30"
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
                <p className="text-xs text-slate-400 mt-2">{t("manager.subscription.planDescriptions.ENTERPRISE")}</p>
                <ul className="mt-6 space-y-3 text-xs text-slate-300">
                  {enterpriseFeatures.map((feat, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check size={13} strokeWidth={2.5} className="shrink-0 mt-0.5 text-emerald-400" aria-hidden="true" />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                to="/inscription"
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
          <div className="relative overflow-hidden bg-linear-to-br from-brand-600 to-indigo-700 rounded-3xl px-8 py-16 text-center shadow-2xl shadow-brand-900/40">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute inset-y-0 -left-1/2 w-1/3 bg-white/10 animate-shine" />
            </div>
            <h2 className="relative text-2xl sm:text-3xl font-extrabold text-white max-w-xl mx-auto">
              {t("landing.finalCta.title")}
            </h2>
            <p className="relative text-sm text-brand-100 mt-4 max-w-lg mx-auto">{t("landing.finalCta.subtitle")}</p>
            <Link
              to="/inscription"
              className="relative mt-8 inline-block bg-white hover:bg-slate-100 text-brand-700 font-bold text-sm px-8 py-3.5 rounded-xl shadow-xl transition-all hover:scale-105"
            >
              {t("landing.finalCta.cta")}
            </Link>
          </div>
        </Reveal>
      </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-12 px-6 bg-slate-950 text-center text-xs text-slate-400">
        <p>{t("landing.footer.rights")}</p>
        <p className="mt-2">{t("landing.footer.tagline")}</p>
        <div className="mt-4 flex items-center justify-center gap-4">
          <Link to="/vitrine" className="hover:text-slate-300 transition-colors">
            {t("landing.nav.vitrine")}
          </Link>
          <Link to="/mentions-legales" className="hover:text-slate-300 transition-colors">
            {t("landing.footer.legal")}
          </Link>
          <span className="text-slate-700">·</span>
          <Link to="/cgu" className="hover:text-slate-300 transition-colors">
            {t("landing.footer.terms")}
          </Link>
          <span className="text-slate-700">·</span>
          <Link to="/confidentialite" className="hover:text-slate-300 transition-colors">
            {t("landing.footer.privacy")}
          </Link>
        </div>
      </footer>
    </div>
  );
}
