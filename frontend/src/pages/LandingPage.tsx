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
  Menu,
  PenLine,
  Receipt,
  Scale,
  Smartphone,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";
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
  { key: "receipts", icon: Receipt, color: "bg-brand-500/15 text-brand-700" },
  { key: "signature", icon: PenLine, color: "bg-ink-800/10 text-ink-800" },
  { key: "reminders", icon: Megaphone, color: "bg-emerald-600/20 text-emerald-800" },
  { key: "dashboard", icon: LayoutDashboard, color: "bg-ocre/25 text-amber-800" },
  { key: "expenses", icon: Wallet, color: "bg-amber-600/20 text-amber-800" },
  { key: "tenantPortal", icon: Home, color: "bg-ink-800/10 text-ink-700" },
  { key: "security", icon: Lock, color: "bg-rose-600/20 text-rose-700" },
  { key: "multiCurrency", icon: Globe, color: "bg-teal-600/20 text-teal-800" },
  { key: "multiLanguage", icon: Languages, color: "bg-brand-500/15 text-brand-700" },
] as const;

const COMPARE_ROWS = [
  { key: "reminders", icon: Megaphone },
  { key: "receipts", icon: Receipt },
  { key: "signature", icon: PenLine },
  { key: "incidents", icon: Camera },
  { key: "expenses", icon: Wallet },
  { key: "branding", icon: Building2 },
] as const;

/** Petite maquette illustrative du tableau de bord (pas une vraie capture d'écran). */
function DashboardMockup() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const bars = [40, 65, 50, 80, 60, 95];
  return (
    <div ref={ref} className="bg-white border border-slate-300 rounded-2xl p-5 h-full">
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { v: "94%", c: "text-emerald-800" },
          { v: "12", c: "text-brand-700" },
          { v: "2", c: "text-rose-700" },
        ].map((s, i) => (
          <div
            key={i}
            className={`bg-slate-100 rounded-xl p-2.5 text-center transition-all duration-500 motion-reduce:transition-none ${
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
            className="flex-1 rounded-t-xs bg-brand-600 transition-all duration-700 ease-out motion-reduce:transition-none"
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
    <div ref={ref} className="bg-white border border-slate-300 rounded-2xl p-5 h-full flex flex-col justify-between">
      <div className="space-y-2">
        <div className="h-2.5 w-2/3 bg-slate-700 rounded-full" />
        <div className="h-2 w-full bg-slate-200 rounded-full" />
        <div className="h-2 w-5/6 bg-slate-200 rounded-full" />
        <div className="h-2 w-4/6 bg-slate-200 rounded-full" />
      </div>
      <div className="mt-4 border-t border-slate-300 pt-4 flex items-center justify-between">
        <svg width="90" height="32" viewBox="0 0 90 32" className="text-ink-700 overflow-visible">
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
          className={`text-[10px] font-bold text-emerald-800 bg-emerald-500/10 px-2.5 py-1 rounded-full transition-all duration-500 motion-reduce:transition-none ${
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
    <div ref={ref} className="bg-white border border-slate-300 rounded-2xl p-5 h-full flex flex-col justify-between">
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
        <span className="text-slate-700">{t("landing.mock.netFlow")}</span>
        <span className="font-bold text-emerald-800">+ 68%</span>
      </div>
    </div>
  );
}

/** Maquette illustrative du portail locataire (mobile). */
function TenantMockup() {
  const { t } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="bg-white border border-slate-300 rounded-2xl p-5 h-full flex flex-col gap-3">
      <div className="bg-slate-100 rounded-xl p-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-700">{t("landing.mock.rentMonth")}</span>
        <span className="text-[10px] font-bold text-white bg-brand-600 px-2.5 py-1 rounded-full">
          {t("landing.mock.pay")}
        </span>
      </div>
      <div className="flex-1 flex flex-col gap-2 justify-end">
        <div
          className={`self-start max-w-[75%] bg-slate-200 text-slate-800 text-[10px] px-3 py-2 rounded-2xl rounded-bl-sm transition-all duration-500 motion-reduce:transition-none ${
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

/** En-tête de section : un numéro de feuille à la manière d'un plan, le titre à gauche, la phrase d'appui à droite. */
function EnteteSection({ numero, titre, sous }: { numero: string; titre: string; sous?: string }) {
  return (
    <Reveal className="mb-12 grid md:grid-cols-12 gap-4 md:gap-8 items-end">
      <div className="md:col-span-7">
        <span aria-hidden="true" className="font-mono text-xs tracking-widest text-orange-700">
          {numero} ——
        </span>
        <h2 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">{titre}</h2>
      </div>
      {sous && <p className="md:col-span-5 text-sm text-slate-700 leading-relaxed">{sous}</p>}
    </Reveal>
  );
}

/**
 * Illustration de l'accroche : le plan d'un logement coté comme sur une feuille d'architecte, avec deux petites
 * maquettes posées dessus. Purement décorative (aucun texte de plus à traduire).
 */
function PlanAccroche() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-xl aspect-5/4 border-2 border-ink-900 bg-white/70 rounded-md">
      <svg viewBox="0 0 500 400" className="absolute inset-0 h-full w-full text-ink-900">
        <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round">
          <path d="M60 60H440V340H60Z" pathLength="1" className="plan-trace" />
          <path d="M60 190H230M230 60V190M230 190V250M320 190H440M320 190V340M230 250H320" strokeWidth="3.5" pathLength="1" className="plan-trace" />
        </g>
        <g fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M230 120a34 34 0 0 1 -34 -34" opacity=".6" />
          <path d="M320 300a34 34 0 0 0 34 34" opacity=".6" />
        </g>
        <g className="text-orange-700" stroke="currentColor" strokeWidth="1.5" fill="none">
          <path d="M60 28H440M60 20V36M440 20V36M52 36L68 20M432 36L448 20" />
          <path d="M470 60V340M462 60H478M462 340H478" />
        </g>
        <g className="text-orange-700" fill="currentColor" fontFamily="DM Mono, monospace" fontSize="14">
          <text x="250" y="20" textAnchor="middle">7,60 m</text>
          <text x="490" y="205" textAnchor="middle" transform="rotate(90 490 205)">5,60 m</text>
        </g>
      </svg>
      <div className="absolute -bottom-8 -left-4 sm:-left-8 w-48 sm:w-56 h-40 shadow-xl">
        <DashboardMockup />
      </div>
      <div className="absolute -top-8 -right-4 sm:-right-8 w-44 sm:w-52 h-40 shadow-xl">
        <ContractMockup />
      </div>
    </div>
  );
}

/** Section affichée au centre de l'écran : sert à souligner le lien du menu et le repère de l'index latéral. */
function useSectionActive(ids: readonly string[]) {
  const [actif, setActif] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const entree of entrees) if (entree.isIntersecting) setActif(entree.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observateur.observe(element);
    }
    return () => observateur.disconnect();
  }, [ids]);
  return actif;
}

/** Filet de progression en haut de l'écran : la part de la page déjà parcourue, sans rendre la page à chaque pixel. */
function BarreProgression() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let image = 0;
    const mettreAJour = () => {
      image = 0;
      const barre = ref.current;
      if (!barre) return;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      barre.style.transform = `scaleX(${total > 0 ? Math.min(1, window.scrollY / total) : 0})`;
    };
    const auDefilement = () => {
      if (!image) image = requestAnimationFrame(mettreAJour);
    };
    window.addEventListener("scroll", auDefilement, { passive: true });
    mettreAJour();
    return () => {
      window.removeEventListener("scroll", auDefilement);
      if (image) cancelAnimationFrame(image);
    };
  }, []);
  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-[60] h-[3px] bg-slate-300/40">
      <div ref={ref} className="h-full origin-left bg-ocre" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}

/** Bouton « haut de page », qui n'apparaît qu'une fois l'accroche dépassée. */
function BoutonHautDePage({ libelle }: { libelle: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const auDefilement = () => setVisible(window.scrollY > 900);
    window.addEventListener("scroll", auDefilement, { passive: true });
    auDefilement();
    return () => window.removeEventListener("scroll", auDefilement);
  }, []);
  return (
    <a
      href="#top"
      aria-label={libelle}
      title={libelle}
      className={`fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center border-2 border-ink-900 bg-white text-ink-900 shadow-md transition-all duration-300 hover:bg-ink-900 hover:text-white motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 13V3M3 7.5 8 3l5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
      </svg>
    </a>
  );
}

/** Index latéral des feuilles (écrans larges) : un repère numéroté par section, celle en cours est pleine. */
function IndexFeuilles({ sections, actif }: { sections: ReadonlyArray<{ id: string; numero: string; libelle: string }>; actif: string | null }) {
  return (
    <div className="fixed right-2.5 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-1.5 min-[1360px]:flex">
      {sections.map((section) => {
        const courant = actif === section.id;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-label={section.libelle}
            title={section.libelle}
            aria-current={courant ? "location" : undefined}
            className={`flex h-6 w-7 items-center justify-center border font-mono text-[10px] transition-colors motion-reduce:transition-none ${
              courant
                ? "border-ink-900 bg-ink-900 text-white"
                : "border-slate-400/70 bg-white/80 text-slate-700 hover:border-ink-900 hover:text-ink-900"
            }`}
          >
            {section.numero}
          </a>
        );
      })}
    </div>
  );
}

const PORTEES_FONCTIONS = [
  "md:col-span-4",
  "md:col-span-2",
  "md:col-span-2",
  "md:col-span-2",
  "md:col-span-2",
  "md:col-span-3",
  "md:col-span-3",
  "md:col-span-3",
  "md:col-span-3",
] as const;

/** Entrées du menu : onglets numérotés, comme les feuilles d'un jeu de plans. */
const LIEN_MENU = "lien-plan flex items-center gap-1.5 px-3 xl:px-4 whitespace-nowrap border-l border-slate-300 last:border-r transition-colors duration-300";
const NUMERO_MENU = "font-mono text-[10px] text-orange-700";

export default function LandingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Sous 640 px, l'en-tête ne tient qu'en version resserrée (voir LandingPage.mobile.test.tsx).
  const telephone = useMediaQuery("(max-width: 639px)");
  // Entre 640 et 1279 px, la barre flottante garde le code court de la langue pour que tous les liens tiennent.
  const ecranMoyen = useMediaQuery("(max-width: 1279px)");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  // Barre qui se resserre et prend une ombre dès que la page défile ; menu plein écran sur téléphone et tablette.
  const [defile, setDefile] = useState(false);
  const [menuOuvert, setMenuOuvert] = useState(false);
  useEffect(() => {
    const surDefilement = () => setDefile(window.scrollY > 12);
    surDefilement();
    window.addEventListener("scroll", surDefilement, { passive: true });
    return () => window.removeEventListener("scroll", surDefilement);
  }, []);
  useEffect(() => {
    if (!menuOuvert) return;
    const surTouche = (e: KeyboardEvent) => e.key === "Escape" && setMenuOuvert(false);
    window.addEventListener("keydown", surTouche);
    const debordement = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", surTouche);
      document.body.style.overflow = debordement;
    };
  }, [menuOuvert]);
  const sectionsSuivies = [
    { id: "features", numero: "01", libelle: t("landing.nav.features") },
    { id: "pdf", numero: "02", libelle: t("landing.nav.receipts") },
    { id: "profils", numero: "03", libelle: t("landing.forWho.title") },
    { id: "compare", numero: "04", libelle: t("landing.nav.compare") },
    { id: "trust", numero: "05", libelle: t("landing.nav.security") },
    { id: "faq", numero: "06", libelle: t("landing.nav.faq") },
    { id: "pricing", numero: "07", libelle: t("landing.nav.pricing") },
  ] as const;
  const sectionActive = useSectionActive(sectionsSuivies.map((section) => section.id));

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
    <div id="top" className="min-h-screen text-slate-900 selection:bg-brand-500 selection:text-white">
      <BarreProgression />
      <IndexFeuilles sections={sectionsSuivies} actif={sectionActive} />
      <BoutonHautDePage libelle={t("landing.nav.top")} />
      <Seo title={t("seo.landing.title")} description={t("seo.landing.description")} canonical="/" />
      <JsonLd data={buildOrganizationJsonLd()} />
      <JsonLd data={buildSoftwareApplicationJsonLd()} />
      {/* Navigation */}
      <nav className={`fixed inset-x-0 top-0 z-50 bg-white border-b-[1.5px] border-ink-900 transition-shadow duration-500 ${defile || menuOuvert ? "shadow-md" : ""}`}>
        <div aria-hidden="true" className="bande-motif h-1.5" />
        <div className={`max-w-7xl mx-auto px-3 sm:px-4 flex items-stretch justify-between gap-2 transition-[height] duration-500 ease-out motion-reduce:transition-none ${defile ? "h-12" : "h-14"}`}>
          <div className="flex items-center gap-3 shrink-0">
            <Logo taille={defile ? 28 : 32} />
            <span className="sr-only sm:not-sr-only lg:sr-only xl:not-sr-only whitespace-nowrap font-bold text-lg tracking-tight text-slate-900">
              {t("common.appName")}
            </span>
          </div>

          <div className="hidden lg:flex items-stretch whitespace-nowrap text-[11px] xl:text-xs font-medium text-slate-700">
            {/*
              La vitrine publique existait — route, page, API — mais AUCUN
              écran n'y menait : `/vitrine` n'apparaissait qu'une fois dans
              tout le frontend, dans sa propre déclaration de route. Les
              annonces étaient donc publiées et servies correctement, et
              simplement invisibles pour qui ne tapait pas l'adresse à la main.
            */}
            <Link to="/vitrine" className={LIEN_MENU}>
              {t("landing.nav.vitrine")}
            </Link>
            {[
              { href: "#features", label: t("landing.nav.features") },
              { href: "#pdf", label: t("landing.nav.receipts") },
              { href: "#compare", label: t("landing.nav.compare") },
              { href: "#trust", label: t("landing.nav.security") },
              { href: "#faq", label: t("landing.nav.faq") },
              { href: "#pricing", label: t("landing.nav.pricing") },
            ].map((link) => {
              const actif = sectionActive === link.href.slice(1);
              return (
                <a
                  key={link.href}
                  href={link.href}
                  className={`${LIEN_MENU} ${actif ? "bg-ink-900 text-white" : "hover:bg-slate-100 hover:text-slate-900"}`}
                  aria-current={actif ? "location" : undefined}
                >
                  <span aria-hidden="true" className={`${NUMERO_MENU} ${actif ? "text-orange-300" : ""}`}>{sectionsSuivies.find((section) => section.id === link.href.slice(1))?.numero}</span>
                  {link.label}
                </a>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <LanguageSwitcher compact={telephone || ecranMoyen} />
            {user ? (
              <Link
                to={homePathForRole(user.role)}
                className="whitespace-nowrap bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 sm:px-4 py-2 transition-colors shadow-sm"
              >
                {t("landing.nav.goToSpace")}
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="hidden sm:inline-block whitespace-nowrap text-xs font-medium text-slate-700 hover:text-slate-900 px-1.5 sm:px-3 py-2"
                >
                  {t("landing.nav.login")}
                </Link>
                <Link
                  to="/inscription"
                  className="whitespace-nowrap bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-2.5 sm:px-4 py-2 transition-colors shadow-sm"
                >
                  {telephone ? t("landing.nav.trialShort") : t("landing.nav.trial")}
                </Link>
              </>
            )}
            <button
              type="button"
              onClick={() => setMenuOuvert((o) => !o)}
              aria-expanded={menuOuvert}
              aria-controls="menu-accueil"
              aria-label={t("landing.nav.menu")}
              className="lg:hidden self-center flex h-9 w-9 items-center justify-center border-[1.5px] border-ink-900 text-ink-900 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {menuOuvert ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </nav>

      {menuOuvert && (
        <div id="menu-accueil" className="menu-ouvert fixed inset-0 z-40 lg:hidden overflow-y-auto bg-white px-6 pt-24 pb-10" onClick={() => setMenuOuvert(false)}>
          <ul className="border-t-[1.5px] border-ink-900">
            {[
              { href: "/vitrine", label: t("landing.nav.vitrine"), numero: "" },
              ...sectionsSuivies.map((section) => ({ href: `#${section.id}`, label: section.libelle, numero: section.numero })),
            ].map((lien, i) => (
              <li key={lien.href} className="menu-entree border-b border-slate-300" style={{ ["--i" as string]: i }}>
                {lien.href.startsWith("/") ? (
                  <Link to={lien.href} className="flex items-baseline gap-4 py-4 text-lg font-semibold text-slate-900">
                    <span aria-hidden="true" className="w-6 shrink-0 font-mono text-xs text-orange-700">{lien.numero}</span>
                    {lien.label}
                  </Link>
                ) : (
                  <a
                    href={lien.href}
                    className={`flex items-baseline gap-4 py-4 text-lg font-semibold ${sectionActive === lien.href.slice(1) ? "text-orange-700" : "text-slate-900"}`}
                    aria-current={sectionActive === lien.href.slice(1) ? "location" : undefined}
                  >
                    <span aria-hidden="true" className="w-6 shrink-0 font-mono text-xs text-orange-700">{lien.numero}</span>
                    {lien.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
          {!user && (
            <div className="menu-entree mt-8 flex flex-col gap-3" style={{ ["--i" as string]: 8 }}>
              <Link to="/login" className="border-[1.5px] border-ink-900 py-3 text-center text-sm font-semibold text-ink-900">
                {t("landing.nav.login")}
              </Link>
              <Link to="/inscription" className="bg-brand-600 py-3 text-center text-sm font-semibold text-white">
                {t("landing.nav.trial")}
              </Link>
            </div>
          )}
        </div>
      )}

      <main>
      {/* Hero Section : texte à gauche, plan coté à droite */}
      <section className="relative pt-28 pb-20 md:pt-36 md:pb-28 px-6 max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-12 gap-14 lg:gap-8 items-center">
          <div className="lg:col-span-6 text-center lg:text-left">
            <Reveal>
              <div className="inline-flex items-center gap-2 bg-ocre/20 border border-ocre/60 rounded-full px-4 py-1.5 text-xs text-slate-900 font-medium mb-7">
                <span className="w-2 h-2 rounded-full bg-brand-600"></span>
                {t("landing.badge")}
              </div>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="text-4xl sm:text-5xl xl:text-6xl font-semibold tracking-tight text-slate-900 leading-[1.08]">
                {t("landing.hero.titleLine1")} <br />
                <span className="text-orange-700">
                  {t("landing.hero.titleLine2")}
                </span>
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="mt-6 text-base sm:text-lg text-slate-700 max-w-xl mx-auto lg:mx-0 leading-relaxed sm:leading-7">
                {t("landing.hero.subtitle")}
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-9 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <Link
                  to="/inscription"
                  className="w-full sm:w-auto bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm px-8 py-3.5 rounded-md shadow-lg shadow-brand-600/25 transition-colors"
                >
                  {t("landing.hero.ctaTrial")}
                </Link>
                {/* Ce bouton annoncait « Tester en mode demo » et menait a /login,
                    ou deux comptes de demonstration remplissaient le formulaire.
                    Ces comptes ont ete retires : leur mot de passe etait ecrit en
                    clair dans le code du frontend, donc servi au navigateur de
                    chaque visiteur. Le bouton promettait donc une porte qui
                    n'existe plus. Il mene desormais aux tarifs — ce que veut
                    generalement voir un visiteur qui hesite a demarrer l'essai. */}
                <a
                  href="#pricing"
                  className="w-full sm:w-auto text-center border-2 border-ink-900 text-slate-900 hover:bg-ink-900 hover:text-white font-semibold text-sm px-6 py-3 rounded-md transition-colors"
                >
                  {t("landing.hero.ctaPricing")}
                </a>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <p className="mt-6 flex items-center justify-center lg:justify-start gap-2 text-xs text-slate-700">
                <Apple className="w-4 h-4 shrink-0" aria-hidden="true" />
                <Smartphone className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t("landing.hero.mobileSoon")}
              </p>
            </Reveal>
          </div>

          <Reveal delay={200} className="lg:col-span-6 pb-6">
            <PlanAccroche />
          </Reveal>
        </div>
      </section>

      {/* Features Section : grille asymétrique */}
      <section id="features" className="py-24 px-6 max-w-7xl mx-auto border-t-2 border-ink-900/80">
        <EnteteSection numero="01" titre={t("landing.featuresSection.title")} sous={t("landing.featuresSection.subtitle")} />

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 text-left">
          {FEATURE_CARDS.map((card, i) => (
            <Reveal key={card.key} delay={(i % 3) * 100} className={`group ${PORTEES_FONCTIONS[i]}`}>
              <div className="relative h-full bg-white/70 border border-slate-400/70 p-6 rounded-md hover:border-ink-900 transition-colors">
                <span aria-hidden="true" className="absolute top-4 right-5 font-mono text-[11px] text-slate-600">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className={`w-11 h-11 rounded-md ${card.color} flex items-center justify-center mb-4`}>
                  <card.icon size={22} strokeWidth={1.75} aria-hidden="true" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{t(`landing.features.${card.key}.title`)}</h3>
                <p className="text-xs text-slate-700 leading-relaxed max-w-md">{t(`landing.features.${card.key}.desc`)}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200} className="mt-8 flex flex-wrap gap-2.5">
          {extras.map((extra, i) => (
            <span
              key={i}
              className="font-mono text-[11px] uppercase tracking-wide text-slate-800 border border-slate-400/70 px-3 py-1.5 rounded-sm hover:border-ink-900 transition-colors"
            >
              {extra}
            </span>
          ))}
        </Reveal>
      </section>

      {/* Product Tour Section : quatre planches décalées */}
      <section id="pdf" className="py-24 px-6 max-w-7xl mx-auto border-t-2 border-ink-900/80">
        <EnteteSection numero="02" titre={t("landing.productTour.title")} sous={t("landing.productTour.subtitle")} />

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 xl:[&>*:nth-child(even)]:mt-10">
          {[
            { m: <DashboardMockup />, k: "dashboard" },
            { m: <ContractMockup />, k: "contracts" },
            { m: <ExpensesMockup />, k: "expenses" },
            { m: <TenantMockup />, k: "tenant" },
          ].map((item, i) => (
            <Reveal key={item.k} delay={i * 100}>
              <div className="h-full bg-white/50 border border-slate-400/70 rounded-md p-5">
                <div className="h-44 mb-5">{item.m}</div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">{t(`landing.productTour.${item.k}.title`)}</h3>
                <p className="text-xs text-slate-700 leading-relaxed">{t(`landing.productTour.${item.k}.desc`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* For Who Section : trois colonnes séparées par des filets */}
      <section id="profils" className="py-24 px-6 max-w-7xl mx-auto border-t-2 border-ink-900/80">
        <EnteteSection numero="03" titre={t("landing.forWho.title")} sous={t("landing.forWho.subtitle")} />

        <div className="grid grid-cols-1 md:grid-cols-3 border-y border-slate-400/70 divide-y md:divide-y-0 md:divide-x divide-slate-400/70">
          {(["independent", "agency", "enterprise"] as const).map((key, i) => (
            <Reveal key={key} delay={i * 100}>
              <div className="h-full p-8">
                <div aria-hidden="true" className="font-display text-5xl font-extrabold text-ocre mb-4">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">{t(`landing.forWho.${key}.title`)}</h3>
                <p className="text-xs text-slate-700 leading-relaxed">{t(`landing.forWho.${key}.desc`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Comparison Section: Gestion Traditionnelle vs ImmoPlatform Pro */}
      <section id="compare" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-300/80">
        <Reveal className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 bg-white border border-slate-300 rounded-sm px-4 py-1.5 text-xs text-slate-800 font-semibold mb-4">
            <Scale size={13} aria-hidden="true" /> <span>{t("landing.compare.badge")}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
            {t("landing.compare.titlePrefix")}{" "}
            <span className="text-orange-700">
              ImmoPlatform Pro
            </span>
          </h2>
          <p className="text-sm text-slate-700 mt-3 leading-relaxed">
            {t("landing.compare.subtitle")}
          </p>

          {/* Badges ROI */}
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-lg mx-auto">
            <div className="bg-white/80 border border-slate-300 rounded-2xl p-3 text-center hover:border-emerald-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-emerald-800">-85%</span>
              <span className="text-[11px] text-slate-700">{t("landing.compare.roi.adminTime")}</span>
            </div>
            <div className="bg-white/80 border border-slate-300 rounded-2xl p-3 text-center hover:border-brand-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-brand-700">0</span>
              <span className="text-[11px] text-slate-700">{t("landing.compare.roi.unpaidRent")}</span>
            </div>
            <div className="bg-white/80 border border-slate-300 rounded-2xl p-3 text-center hover:border-brand-500/40 transition-colors">
              <span className="block text-xl sm:text-2xl font-black text-brand-700">100%</span>
              <span className="text-[11px] text-slate-700">{t("landing.compare.roi.certified")}</span>
            </div>
          </div>
        </Reveal>

        {/* Tableau comparatif */}
        <Reveal delay={120}>
          <div className="bg-white border border-slate-300 rounded-md overflow-hidden shadow-md">
            {/* En-tête du tableau */}
            <div className="grid grid-cols-1 md:grid-cols-12 border-b border-slate-300 bg-white/90 text-sm font-bold">
              <div className="md:col-span-4 p-5 text-slate-700 uppercase tracking-wider text-xs flex items-center">
                {t("landing.compare.headers.feature")}
              </div>
              <div className="md:col-span-4 p-5 bg-slate-50 text-rose-700 border-t md:border-t-0 md:border-l border-slate-300 flex items-center gap-2">
                <X size={16} className="shrink-0" aria-hidden="true" />
                <span>{t("landing.compare.headers.traditional")}</span>
              </div>
              <div className="md:col-span-4 p-5 bg-brand-50 text-brand-800 border-t md:border-t-0 md:border-l border-slate-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="shrink-0" aria-hidden="true" />
                  <span>ImmoPlatform Pro</span>
                </div>
                <span className="text-[10px] bg-white text-brand-800 px-2.5 py-0.5 rounded-sm border border-brand-600 font-semibold">
                  {t("landing.compare.headers.recommended")}
                </span>
              </div>
            </div>

            {/* Lignes du comparatif */}
            <div className="divide-y divide-slate-300">
              {COMPARE_ROWS.map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 md:grid-cols-12 hover:bg-slate-200 transition-colors duration-200"
                >
                  {/* Nom du critère */}
                  <div className="md:col-span-4 p-5 flex items-start gap-3">
                    <row.icon size={20} strokeWidth={1.75} className="shrink-0 mt-0.5 text-slate-700" aria-hidden="true" />
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">{t(`landing.compare.rows.${row.key}.title`)}</h3>
                      <p className="text-xs text-slate-700 mt-0.5">{t(`landing.compare.rows.${row.key}.description`)}</p>
                    </div>
                  </div>

                  {/* Gestion traditionnelle */}
                  <div className="md:col-span-4 p-5 bg-slate-50 border-t md:border-t-0 md:border-l border-slate-300/80 flex items-start gap-2.5">
                    <X size={15} className="text-rose-700 shrink-0" aria-hidden="true" />
                    <span className="text-xs text-slate-700 leading-relaxed">{t(`landing.compare.rows.${row.key}.traditional`)}</span>
                  </div>

                  {/* ImmoPlatform Pro */}
                  <div className="md:col-span-4 p-5 bg-brand-50 border-t md:border-t-0 md:border-l border-slate-300/80 flex items-start gap-2.5">
                    <Check size={15} strokeWidth={2.5} className="text-brand-700 shrink-0" aria-hidden="true" />
                    <span className="text-xs text-slate-900 font-medium leading-relaxed">
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
          <div className="inline-flex flex-col sm:flex-row items-center gap-4 bg-white/80 border border-slate-300 p-4 sm:px-8 rounded-2xl shadow-lg">
            <span className="text-xs text-slate-700 font-medium">
              {t("landing.compare.cta.text")}
            </span>
            <Link
              to="/inscription"
              className="bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs px-6 py-2.5 rounded-xl shadow-sm transition-all hover:scale-105"
            >
              {t("landing.compare.cta.button")}
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Trust / Security Section : titre à gauche, engagements en liste à droite */}
      <section id="trust" className="py-24 px-6 max-w-7xl mx-auto border-t-2 border-ink-900/80">
        <div className="grid md:grid-cols-12 gap-10">
          <Reveal className="md:col-span-5">
            <span aria-hidden="true" className="font-mono text-xs tracking-widest text-orange-700">05 ——</span>
            <h2 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">{t("landing.trust.title")}</h2>
            <p className="text-sm text-slate-700 mt-3 leading-relaxed">{t("landing.trust.subtitle")}</p>
            <Link to="/confidentialite" className="mt-5 inline-block text-xs font-semibold text-brand-700 underline underline-offset-4 hover:text-brand-800">
              {t("landing.trust.linkLabel")}
            </Link>
          </Reveal>

          <div className="md:col-span-7 border-t border-slate-400/70">
            {trustItems.map((item, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="flex items-start gap-4 border-b border-slate-400/70 py-5 text-sm text-slate-800 leading-relaxed">
                  <span aria-hidden="true" className="font-mono text-[11px] text-slate-600 pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                  <Check size={15} strokeWidth={2.5} className="text-emerald-800 shrink-0 mt-1" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section : questions à droite, titre fixe à gauche */}
      <section id="faq" className="py-24 px-6 max-w-7xl mx-auto border-t-2 border-ink-900/80">
        <div className="grid md:grid-cols-12 gap-10">
          <Reveal className="md:col-span-4">
            <span aria-hidden="true" className="font-mono text-xs tracking-widest text-orange-700">06 ——</span>
            <h2 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">{t("landing.faq.title")}</h2>
          </Reveal>

          <div className="md:col-span-8 border-t border-slate-400/70">
            {faqItems.map((item, i) => {
              const isOpen = openFaq === i;
              return (
                <Reveal key={i} delay={i * 60}>
                  <div className="border-b border-slate-400/70">
                    <button
                      onClick={() => setOpenFaq(isOpen ? null : i)}
                      className="w-full flex items-center justify-between gap-4 text-left py-5"
                    >
                      <span className="text-base font-semibold text-slate-900">{item.q}</span>
                      <span
                        className={`text-xl leading-none text-orange-700 transition-transform duration-300 shrink-0 ${isOpen ? "rotate-45" : ""}`}
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
                        <p className="pb-5 text-sm text-slate-700 leading-relaxed max-w-2xl">{item.a}</p>
                      </div>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6 max-w-7xl mx-auto border-t-2 border-ink-900/80">
        <EnteteSection numero="07" titre={t("landing.pricing.title")} sous={t("landing.pricing.subtitle")} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Starter */}
          <Reveal delay={0}>
            <div className="h-full bg-white/40 border border-slate-300 rounded-lg p-8 flex flex-col justify-between hover:-translate-y-1.5 hover:border-slate-400 transition-all duration-300">
              <div>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">{t("landing.pricing.starter.name")}</span>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-slate-900">9€</span>
                  <span className="text-slate-700 text-xs">{t("landing.pricing.perMonth")}</span>
                </div>
                <p className="text-xs text-slate-700 mt-2">{t("manager.subscription.planDescriptions.STARTER")}</p>
                <ul className="mt-6 space-y-3 text-xs text-slate-700">
                  {starterFeatures.map((feat, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check size={13} strokeWidth={2.5} className="shrink-0 mt-0.5 text-emerald-800" aria-hidden="true" />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                to="/inscription"
                className="mt-8 w-full block text-center bg-slate-200 hover:bg-slate-300 text-slate-900 font-semibold text-xs py-3 rounded-xl transition-colors"
              >
                {t("landing.pricing.starter.cta")}
              </Link>
            </div>
          </Reveal>

          {/* Pro */}
          <Reveal delay={100}>
            <div className="h-full bg-brand-50 border-2 border-brand-600 rounded-md p-8 flex flex-col justify-between relative shadow-md">
              <span className="absolute -top-3 right-6 bg-brand-500 text-white text-[10px] uppercase font-extrabold px-3 py-0.5 rounded-full tracking-wider">
                {t("landing.pricing.pro.badge")}
              </span>
              <div>
                <span className="text-xs font-semibold text-brand-700 uppercase tracking-wider">{t("landing.pricing.pro.name")}</span>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-slate-900">29€</span>
                  <span className="text-slate-700 text-xs">{t("landing.pricing.perMonth")}</span>
                </div>
                <p className="text-xs text-slate-700 mt-2">{t("manager.subscription.planDescriptions.PRO")}</p>
                <ul className="mt-6 space-y-3 text-xs text-slate-800">
                  {proFeatures.map((feat, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check size={13} strokeWidth={2.5} className="shrink-0 mt-0.5 text-emerald-800" aria-hidden="true" />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                to="/inscription"
                className="mt-8 w-full block text-center bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs py-3 rounded-xl transition-colors shadow-sm"
              >
                {t("landing.pricing.pro.cta")}
              </Link>
            </div>
          </Reveal>

          {/* Enterprise */}
          <Reveal delay={200}>
            <div className="h-full bg-white/40 border border-slate-300 rounded-lg p-8 flex flex-col justify-between hover:-translate-y-1.5 hover:border-slate-400 transition-all duration-300">
              <div>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">{t("landing.pricing.enterprise.name")}</span>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-slate-900">49€</span>
                  <span className="text-slate-700 text-xs">{t("landing.pricing.perMonth")}</span>
                </div>
                <p className="text-xs text-slate-700 mt-2">{t("manager.subscription.planDescriptions.ENTERPRISE")}</p>
                <ul className="mt-6 space-y-3 text-xs text-slate-700">
                  {enterpriseFeatures.map((feat, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Check size={13} strokeWidth={2.5} className="shrink-0 mt-0.5 text-emerald-800" aria-hidden="true" />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                to="/inscription"
                className="mt-8 w-full block text-center bg-slate-200 hover:bg-slate-300 text-slate-900 font-semibold text-xs py-3 rounded-xl transition-colors"
              >
                {t("landing.pricing.enterprise.cta")}
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Final CTA Banner : cartouche de plan */}
      <section className="px-6 max-w-7xl mx-auto pb-24">
        <Reveal>
          <div className="overflow-hidden border-2 border-ink-900 bg-white rounded-md">
            <div aria-hidden="true" className="bande-motif h-3" />
            <div className="grid md:grid-cols-12 gap-8 items-center px-8 py-12 md:px-12">
              <div className="md:col-span-8">
                <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 max-w-2xl">
                  {t("landing.finalCta.title")}
                </h2>
                <p className="text-sm text-slate-700 mt-4 max-w-lg leading-relaxed">{t("landing.finalCta.subtitle")}</p>
              </div>
              <div className="md:col-span-4 md:text-right">
                <Link
                  to="/inscription"
                  className="inline-block bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm px-8 py-3.5 rounded-md shadow-lg shadow-brand-600/25 transition-colors"
                >
                  {t("landing.finalCta.cta")}
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-300/80 py-12 px-6 bg-white text-center text-xs text-slate-700">
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
