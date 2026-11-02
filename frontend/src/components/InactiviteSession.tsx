import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/auth";
import Dialogue from "./Dialogue";
import { BOUTON_PLEIN, BOUTON_TRAIT } from "./styleFormulaire";
import { AVERTISSEMENT_MS, CLE_DERNIERE_ACTIVITE, dureeInactiviteMs, INTERVALLE_RENOUVELLEMENT_MS } from "../utils/inactivite";

const GESTES = ["mousedown", "keydown", "touchstart", "wheel", "scroll"] as const;

/**
 * Déconnexion à l'inactivité (web uniquement : l'app mobile garde sa session longue). 15 minutes pour
 * l'administrateur, 30 pour tous les autres rôles. Une minute avant l'échéance, un avertissement propose de rester
 * connecté ; passé le délai, la session est fermée et la personne revient à la page de connexion.
 *
 * Le serveur fait respecter la même règle (cookie court, voir backend/src/utils/session.ts) : cette interface
 * prolonge le cookie sur un GESTE de l'utilisateur, au plus une fois par minute, et jamais sur les requêtes
 * automatiques. La dernière activité est partagée entre les onglets (localStorage) : travailler dans un onglet
 * garde les autres ouverts.
 */
export default function InactiviteSession() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [secondesRestantes, setSecondesRestantes] = useState<number | null>(null);
  const avertissementRef = useRef(false);
  const dernierRenouvellementRef = useRef(0);
  const deconnexionRef = useRef<() => void>(() => undefined);

  const role = user?.role;
  const actif = Boolean(user) && !Capacitor.isNativePlatform();

  useEffect(() => {
    if (!actif || !role) return;
    const limite = dureeInactiviteMs(role);
    let termine = false;

    const derniereActivite = () => Number(localStorage.getItem(CLE_DERNIERE_ACTIVITE)) || Date.now();
    const marquerActivite = () => localStorage.setItem(CLE_DERNIERE_ACTIVITE, String(Date.now()));
    const prolongerSession = () => {
      dernierRenouvellementRef.current = Date.now();
      void api.post("/auth/session/refresh").catch(() => undefined);
    };

    const quitter = async () => {
      if (termine) return;
      termine = true;
      avertissementRef.current = false;
      setSecondesRestantes(null);
      await logout();
      navigate("/login?inactif=1", { replace: true });
    };
    deconnexionRef.current = () => void quitter();

    marquerActivite();
    dernierRenouvellementRef.current = Date.now();

    const surGeste = () => {
      // L'avertissement affiché, seul un clic sur « Rester connecté » prolonge : un mouvement de souris
      // involontaire ne doit pas annuler la déconnexion d'un poste que la personne a quitté.
      if (avertissementRef.current) return;
      const maintenant = Date.now();
      if (maintenant - derniereActivite() >= 1000) marquerActivite();
      if (maintenant - dernierRenouvellementRef.current >= INTERVALLE_RENOUVELLEMENT_MS) prolongerSession();
    };

    const verifier = () => {
      const inactif = Date.now() - derniereActivite();
      if (inactif >= limite) {
        void quitter();
      } else if (inactif >= limite - AVERTISSEMENT_MS) {
        avertissementRef.current = true;
        setSecondesRestantes(Math.ceil((limite - inactif) / 1000));
      } else if (avertissementRef.current) {
        // Activité dans un autre onglet pendant l'avertissement.
        avertissementRef.current = false;
        setSecondesRestantes(null);
      }
    };

    for (const geste of GESTES) window.addEventListener(geste, surGeste, { passive: true, capture: true });
    const minuteur = window.setInterval(verifier, 1000);
    return () => {
      termine = true;
      window.clearInterval(minuteur);
      for (const geste of GESTES) window.removeEventListener(geste, surGeste, { capture: true });
    };
  }, [actif, role, logout, navigate]);

  if (!actif || secondesRestantes === null) return null;

  function resterConnecte() {
    localStorage.setItem(CLE_DERNIERE_ACTIVITE, String(Date.now()));
    dernierRenouvellementRef.current = Date.now();
    avertissementRef.current = false;
    setSecondesRestantes(null);
    void api.post("/auth/session/refresh").catch(() => undefined);
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-slate-900/60 p-4">
      <Dialogue
        onClose={resterConnecte}
        titreId="inactivite-titre"
        className="w-full max-w-sm border-2 border-ink-900 bg-white p-6"
      >
        <h2 id="inactivite-titre" className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">
          {t("components.inactivite.title")}
        </h2>
        <p role="status" className="mt-2 text-sm text-slate-700">
          {t("components.inactivite.message", { count: secondesRestantes })}
        </p>
        <div
          role="progressbar"
          aria-hidden="true"
          aria-valuemin={0}
          aria-valuemax={AVERTISSEMENT_MS / 1000}
          aria-valuenow={Math.min(secondesRestantes, AVERTISSEMENT_MS / 1000)}
          className="mt-3 h-2 border border-slate-400 bg-white"
        >
          <div className="h-full bg-orange-700" style={{ width: `${Math.max(0, Math.min(100, (secondesRestantes / (AVERTISSEMENT_MS / 1000)) * 100))}%` }} />
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-300 pt-4">
          <button
            type="button"
            onClick={() => deconnexionRef.current()}
            className={BOUTON_TRAIT}
          >
            {t("components.inactivite.logout")}
          </button>
          <button
            type="button"
            onClick={resterConnecte}
            data-autofocus
            className={BOUTON_PLEIN}
          >
            {t("components.inactivite.stay")}
          </button>
        </div>
      </Dialogue>
    </div>
  );
}
