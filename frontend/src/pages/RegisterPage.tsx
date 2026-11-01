import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Circle, Eye, EyeOff, Gift, Lock, Mail } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import AuthLayout from "../components/AuthLayout";
import ChampAuth from "../components/ChampAuth";
import GoogleSignInButton from "../components/GoogleSignInButton";
import Seo from "../components/Seo";
import SelecteurPays from "../components/SelecteurPays";
import { useAuth } from "../context/auth";
import { isGoogleSignInEnabled } from "../utils/googleAuth";
import { forceMotDePasse } from "../utils/forceMotDePasse";
import { homePathForRole } from "../utils/roleHome";

const BOUTON_PRINCIPAL =
  "flex w-full cursor-pointer items-center justify-center gap-2 bg-ink-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const MESSAGE_ERREUR = "border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800";

/** Couleur de chaque segment de l'indicateur de force, selon le niveau atteint. */
const COULEUR_FORCE = ["bg-slate-200", "bg-orange-700", "bg-amber-500", "bg-emerald-600", "bg-emerald-700"] as const;

/** Rubrique du formulaire : numéro de repère et titre en police technique, filet dessous. */
function Rubrique({ numero, titre, children }: { numero: string; titre: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className="mb-3 flex w-full items-baseline gap-2.5 border-b border-slate-300 pb-2">
        <span aria-hidden="true" className="font-mono text-[11px] font-semibold text-orange-700">{numero}</span>
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{titre}</span>
      </legend>
      {children}
    </fieldset>
  );
}

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { user: utilisateur, register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  // Pays de l'agence : vide tant qu'il n'est pas choisi, jamais deviné (pas de pays « par défaut » : il fixe les règles
  // de location appliquées et ne se change plus ensuite).
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Pré-rempli depuis un lien de parrainage partagé (?ref=CODE, voir
  // ReferralPage.tsx) mais toujours modifiable : rien n'empêche une personne
  // de saisir un autre code à la main.
  const [referralCode, setReferralCode] = useState(() => (searchParams.get("ref") ?? "").toUpperCase());
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const force = forceMotDePasse(password);
  const critereLabels = {
    longueur: t("auth.register.checks.length"),
    casse: t("auth.register.checks.case"),
    chiffre: t("auth.register.checks.digit"),
    symbole: t("auth.register.checks.symbol"),
  } as const;
  const etapes = t("auth.register.nextSteps", { returnObjects: true }) as string[];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("auth.register.mismatchError"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.register.tooShortError"));
      return;
    }
    if (!country) {
      setError(t("auth.register.countryRequiredError"));
      return;
    }

    setLoading(true);
    try {
      await register(email, password, country, referralCode);
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(credential: string) {
    setError(null);
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      const result = await loginWithGoogle(credential, referralCode.trim() || undefined);
      // Cas marginal : ce compte Google est déjà lié à un compte gestionnaire
      // existant (voir loginWithGoogle, auth.controller.ts) qui a depuis
      // activé la double authentification — la page d'inscription n'a pas de
      // formulaire pour ce second facteur, contrairement à LoginPage.
      if ("twoFactorRequired" in result) {
        navigate("/login");
        return;
      }
      navigate(homePathForRole(result.role), { replace: true });
    } catch (err) {
      setGoogleError(apiErrorMessage(err));
    } finally {
      setGoogleLoading(false);
    }
  }

  // Déjà connecté : revenir ici (bouton Retour, adresse saisie) réaffichait le formulaire alors que la session restait
  // ouverte, ce qui ressemblait à une déconnexion sans confirmation. On renvoie vers l'espace de l'utilisateur.
  if (utilisateur) return <Navigate to={homePathForRole(utilisateur.role)} replace />;

  return (
    <AuthLayout page="register" retour={t("auth.register.backToHome")}>
      <Seo title={`${t("seo.register.title")} | ${t("common.appName")}`} description={t("seo.register.description")} canonical="/inscription" />

      {sent ? (
        <div>
          <div className="flex size-12 items-center justify-center border border-emerald-300 bg-emerald-50 text-emerald-800">
            <Mail size={22} aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t("auth.register.sentTitle")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("auth.register.sentSubtitle")}</p>

          {/* Ce qu'il reste à faire pour ouvrir le compte, dans l'ordre. */}
          <ol className="mt-6 border-t border-slate-300">
            {etapes.map((etape, i) => (
              <li key={i} className="flex items-baseline gap-3 border-b border-slate-200 py-2.5 text-sm text-slate-800">
                <span aria-hidden="true" className="font-mono text-[11px] font-semibold text-orange-700">{String(i + 1).padStart(2, "0")}</span>
                {etape}
              </li>
            ))}
          </ol>

          <Link to="/login" className={`mt-6 ${BOUTON_PRINCIPAL}`}>
            {t("auth.register.loginLink")}
          </Link>
        </div>
      ) : (
        <>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{t("auth.register.trialTag")}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{t("auth.register.title")}</h1>
          <p className="mt-1.5 text-sm text-slate-600">{t("auth.register.subtitle")}</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-6">
            <Rubrique numero="01" titre={t("auth.register.sections.access")}>
              <ChampAuth
                id="register-email"
                label={t("auth.register.email")}
                icone={Mail}
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.register.emailPlaceholder")}
              />

              <ChampAuth
                id="register-password"
                label={t("auth.register.password")}
                icone={Lock}
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.register.passwordPlaceholder")}
                droite={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
                    className="flex h-6 w-6 cursor-pointer items-center justify-center text-slate-500 transition-colors hover:text-ink-900"
                  >
                    {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                }
                aide={
                  <>
                    <p className="mt-1.5 text-[11px] text-slate-600">{t("auth.register.passwordHint")}</p>
                    {/* Force du mot de passe : une aide à la saisie, qui ne bloque rien de plus que la longueur minimale. */}
                    {force.niveau > 0 && (
                      <div className="mt-2.5">
                        <div
                          role="meter"
                          aria-label={t("auth.register.strength.label")}
                          aria-valuemin={1}
                          aria-valuemax={4}
                          aria-valuenow={force.niveau}
                          aria-valuetext={t(`auth.register.strength.level${force.niveau}`)}
                          className="flex gap-1"
                        >
                          {[1, 2, 3, 4].map((segment) => (
                            <span key={segment} className={`h-1.5 flex-1 ${segment <= force.niveau ? COULEUR_FORCE[force.niveau] : "bg-slate-200"}`} />
                          ))}
                        </div>
                        <p aria-live="polite" className="mt-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-800">
                          {t(`auth.register.strength.level${force.niveau}`)}
                        </p>
                        <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                          {(Object.keys(critereLabels) as Array<keyof typeof critereLabels>).map((cle) => (
                            <li
                              key={cle}
                              className={`flex items-center gap-1.5 text-[11px] ${force.criteres[cle] ? "text-emerald-800" : "text-slate-600"}`}
                            >
                              {force.criteres[cle] ? <Check size={11} aria-hidden="true" /> : <Circle size={9} aria-hidden="true" />}
                              {critereLabels[cle]}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                }
              />

              <ChampAuth
                id="register-confirm-password"
                label={t("auth.register.confirmPassword")}
                icone={Lock}
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                maxLength={128}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("auth.register.passwordPlaceholder")}
                aide={
                  confirmPassword !== "" && (
                    <p className={`mt-1.5 flex items-center gap-1.5 font-mono text-[11px] ${confirmPassword === password ? "text-emerald-800" : "text-orange-700"}`}>
                      {confirmPassword === password ? <Check size={12} aria-hidden="true" /> : <Circle size={9} aria-hidden="true" />}
                      {confirmPassword === password ? t("auth.register.match") : t("auth.register.noMatch")}
                    </p>
                  )
                }
              />
            </Rubrique>

            <Rubrique numero="02" titre={t("auth.register.sections.agency")}>
              <div>
                <label htmlFor="register-country" className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                  {t("auth.register.country")}
                </label>
                <SelecteurPays
                  id="register-country"
                  value={country}
                  onChange={setCountry}
                  placeholder={t("auth.register.countryPlaceholder")}
                  className="w-full border border-slate-400 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/20"
                />
                <p className="mt-1.5 border-l-2 border-orange-700 pl-2.5 text-[11px] leading-relaxed text-slate-700">{t("auth.register.countryHint")}</p>
              </div>
            </Rubrique>

            <Rubrique numero="03" titre={t("auth.register.sections.referral")}>
              <ChampAuth
                id="register-referral-code"
                label={t("auth.register.referralCode")}
                icone={Gift}
                type="text"
                maxLength={64}
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder={t("auth.register.referralCodePlaceholder")}
                aide={referralCode && (searchParams.get("ref") ?? "").toUpperCase() === referralCode ? <p className="mt-1.5 font-mono text-[11px] text-emerald-800">{t("auth.register.referralFromLink")}</p> : undefined}
              />
            </Rubrique>

            {error && (
              <p role="alert" className={MESSAGE_ERREUR}>
                {error}
              </p>
            )}

            <button type="submit" disabled={loading || googleLoading} className={BOUTON_PRINCIPAL}>
              {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {loading ? t("auth.register.submitting") : t("auth.register.submit")}
            </button>
          </form>

          {isGoogleSignInEnabled() && (
            <div className="mt-5">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-300" />
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-600">{t("auth.google.orDivider")}</span>
                <div className="h-px flex-1 bg-slate-300" />
              </div>
              <div className="mt-4">
                <GoogleSignInButton
                  onCredential={handleGoogleCredential}
                  onError={() => setGoogleError(t("auth.google.error"))}
                  locale={i18n.language}
                />
              </div>
              {googleLoading && <p className="mt-3 text-center text-xs text-slate-600">{t("auth.register.submitting")}</p>}
              {googleError && (
                <p role="alert" className={`mt-3 ${MESSAGE_ERREUR}`}>
                  {googleError}
                </p>
              )}
            </div>
          )}

          <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-600">
            {t("auth.register.legalPrefix")}{" "}
            <Link to="/cgu" className="font-semibold text-ink-900 underline decoration-ink-900/30 underline-offset-2 hover:text-orange-700">
              {t("auth.register.legalTerms")}
            </Link>{" "}
            {t("auth.register.legalAnd")}{" "}
            <Link to="/confidentialite" className="font-semibold text-ink-900 underline decoration-ink-900/30 underline-offset-2 hover:text-orange-700">
              {t("auth.register.legalPrivacy")}
            </Link>
            {t("auth.register.legalSuffix")}
          </p>

          <p className="mt-5 border-t border-dashed border-slate-300 pt-5 text-center text-xs text-slate-700">
            {t("auth.register.alreadyHaveAccount")}{" "}
            <Link to="/login" className="border-b border-ink-900/40 pb-0.5 font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700">
              {t("auth.register.loginLink")}
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
