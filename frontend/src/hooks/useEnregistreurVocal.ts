import { useCallback, useEffect, useRef, useState } from "react";
import {
  choisirTypeEnregistrement,
  classerErreurMicro,
  DUREE_MAX_MESSAGE_VOCAL_SEC,
  DUREE_MIN_MESSAGE_VOCAL_SEC,
  type ErreurMicro,
  enregistrementPossible,
} from "../utils/messageVocal";

export interface EnregistrementVocal {
  blob: Blob;
  /** Durée en secondes, arrondie. */
  duree: number;
  /** Type du fichier (« audio/webm », « audio/mp4 »…), sans paramètres de codec. */
  type: string;
  /** Adresse locale pour réécouter avant d'envoyer ; révoquée à la remise à zéro. */
  url: string;
}

export type EtatEnregistreur = "repos" | "demarrage" | "enregistrement" | "ecoute";
export type ErreurEnregistreur = ErreurMicro | "tooShort";

/**
 * Enregistrement d'un message vocal : demande le micro, enregistre jusqu'à « Terminer » (ou jusqu'à la durée maximale),
 * puis garde l'enregistrement à réécouter avant l'envoi. Le micro est toujours relâché : à la fin, à l'annulation, à
 * l'erreur et au démontage — un voyant de micro qui reste allumé ferait croire à une écoute.
 */
export function useEnregistreurVocal() {
  const [etat, setEtat] = useState<EtatEnregistreur>("repos");
  const [secondes, setSecondes] = useState(0);
  const [erreur, setErreur] = useState<ErreurEnregistreur | null>(null);
  const [enregistrement, setEnregistrement] = useState<EnregistrementVocal | null>(null);

  const flux = useRef<MediaStream | null>(null);
  const enregistreur = useRef<MediaRecorder | null>(null);
  const morceaux = useRef<Blob[]>([]);
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null);
  const debut = useRef(0);
  const annule = useRef(false);
  const urlCourante = useRef<string | null>(null);

  const relacherMicro = useCallback(() => {
    if (minuteur.current) clearInterval(minuteur.current);
    minuteur.current = null;
    flux.current?.getTracks().forEach((piste) => piste.stop());
    flux.current = null;
  }, []);

  const revoquerUrl = useCallback(() => {
    if (urlCourante.current) URL.revokeObjectURL(urlCourante.current);
    urlCourante.current = null;
  }, []);

  const reinitialiser = useCallback(() => {
    annule.current = true;
    if (enregistreur.current && enregistreur.current.state !== "inactive") {
      try {
        enregistreur.current.stop();
      } catch {
        // Déjà arrêté : rien à faire.
      }
    }
    enregistreur.current = null;
    relacherMicro();
    revoquerUrl();
    morceaux.current = [];
    setEnregistrement(null);
    setSecondes(0);
    setErreur(null);
    setEtat("repos");
  }, [relacherMicro, revoquerUrl]);

  const terminer = useCallback(() => {
    const rec = enregistreur.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const demarrer = useCallback(async () => {
    if (!enregistrementPossible()) {
      setErreur("unsupported");
      return;
    }
    setErreur(null);
    setEtat("demarrage");
    annule.current = false;
    let micro: MediaStream;
    try {
      micro = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setErreur(classerErreurMicro(err));
      setEtat("repos");
      return;
    }
    // Annulé pendant que le navigateur demandait la permission : on relâche aussitôt.
    if (annule.current) {
      micro.getTracks().forEach((piste) => piste.stop());
      return;
    }
    flux.current = micro;
    morceaux.current = [];
    const type = choisirTypeEnregistrement();
    let rec: MediaRecorder;
    try {
      rec = type ? new MediaRecorder(micro, { mimeType: type }) : new MediaRecorder(micro);
    } catch (err) {
      relacherMicro();
      setErreur(classerErreurMicro(err) === "unknown" ? "unsupported" : classerErreurMicro(err));
      setEtat("repos");
      return;
    }
    enregistreur.current = rec;
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) morceaux.current.push(e.data);
    };
    rec.onstop = () => {
      relacherMicro();
      if (annule.current) return;
      const duree = Math.round((Date.now() - debut.current) / 1000);
      const typeFinal = (rec.mimeType || type || "audio/webm").split(";")[0];
      if (duree < DUREE_MIN_MESSAGE_VOCAL_SEC || morceaux.current.length === 0) {
        setErreur("tooShort");
        setEtat("repos");
        setSecondes(0);
        return;
      }
      const blob = new Blob(morceaux.current, { type: rec.mimeType || type || "audio/webm" });
      revoquerUrl();
      const url = URL.createObjectURL(blob);
      urlCourante.current = url;
      setEnregistrement({ blob, duree: Math.min(duree, DUREE_MAX_MESSAGE_VOCAL_SEC), type: typeFinal, url });
      setSecondes(Math.min(duree, DUREE_MAX_MESSAGE_VOCAL_SEC));
      setEtat("ecoute");
    };
    rec.onerror = () => {
      relacherMicro();
      setErreur("unknown");
      setEtat("repos");
    };

    debut.current = Date.now();
    rec.start();
    setSecondes(0);
    setEtat("enregistrement");
    minuteur.current = setInterval(() => {
      const ecoule = Math.floor((Date.now() - debut.current) / 1000);
      setSecondes(ecoule);
      if (ecoule >= DUREE_MAX_MESSAGE_VOCAL_SEC) terminer();
    }, 250);
  }, [relacherMicro, revoquerUrl, terminer]);

  // Démontage (changement de page ou de fil) : micro relâché, adresse locale révoquée.
  useEffect(
    () => () => {
      annule.current = true;
      if (enregistreur.current && enregistreur.current.state !== "inactive") {
        try {
          enregistreur.current.stop();
        } catch {
          // Déjà arrêté.
        }
      }
      relacherMicro();
      revoquerUrl();
    },
    [relacherMicro, revoquerUrl]
  );

  return { etat, secondes, erreur, enregistrement, demarrer, terminer, annuler: reinitialiser, reinitialiser };
}
