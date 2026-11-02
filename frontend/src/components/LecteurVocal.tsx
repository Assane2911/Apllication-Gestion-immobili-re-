import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formaterDuree, VITESSES_LECTURE } from "../utils/messageVocal";

/** Le lecteur en cours : lancer un second vocal met le premier en pause, comme dans une messagerie vocale. */
let lecteurActif: HTMLAudioElement | null = null;

/**
 * Lecteur d'un message vocal : lecture/pause, barre de progression déplaçable, durée, et vitesse 1× / 1,5× / 2×. Rien ne se
 * lance seul. La durée affichée est celle annoncée par le serveur : les enregistrements d'un navigateur n'ont souvent pas de
 * durée lisible dans leur en-tête. Sans adresse (fichier effacé, lien impossible à générer ou expiré), le message le dit.
 */
export default function LecteurVocal({ url, duree, surFondPlein = false }: { url?: string | null; duree: number; surFondPlein?: boolean }) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const [lecture, setLecture] = useState(false);
  const [position, setPosition] = useState(0);
  const [vitesse, setVitesse] = useState<(typeof VITESSES_LECTURE)[number]>(1);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    const element = audio.current;
    return () => {
      if (element && lecteurActif === element) lecteurActif = null;
      element?.pause();
    };
  }, []);

  if (!url || erreur) {
    return (
      <p className={`text-xs italic ${surFondPlein ? "text-white/80" : "text-slate-600"}`} role="note">
        {t("voice.unavailable")}
      </p>
    );
  }

  function basculer() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      if (lecteurActif && lecteurActif !== element) lecteurActif.pause();
      lecteurActif = element;
      element.playbackRate = vitesse;
      void element.play().catch(() => setErreur(true));
    } else {
      element.pause();
    }
  }

  function changerVitesse() {
    const suivante = VITESSES_LECTURE[(VITESSES_LECTURE.indexOf(vitesse) + 1) % VITESSES_LECTURE.length];
    setVitesse(suivante);
    if (audio.current) audio.current.playbackRate = suivante;
  }

  function deplacer(valeur: number) {
    setPosition(valeur);
    if (audio.current) audio.current.currentTime = valeur;
  }

  const bouton = surFondPlein ? "border-white/70 text-white hover:bg-white/10" : "border-ink-900 text-ink-900 hover:bg-ink-900 hover:text-white";
  const Icone = lecture ? Pause : Play;

  return (
    <div className="flex min-w-56 items-center gap-3">
      <audio
        ref={audio}
        src={url}
        preload="none"
        onPlay={() => setLecture(true)}
        onPause={() => setLecture(false)}
        onEnded={() => {
          setLecture(false);
          setPosition(0);
          if (audio.current) audio.current.currentTime = 0;
        }}
        onTimeUpdate={(e) => setPosition(Math.min(duree, e.currentTarget.currentTime))}
        onError={() => setErreur(true)}
      />
      <button
        type="button"
        onClick={basculer}
        aria-label={lecture ? t("voice.pause") : t("voice.play")}
        className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center border transition-colors ${bouton}`}
      >
        <Icone size={15} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={Math.max(1, duree)}
          step={0.1}
          value={position}
          onChange={(e) => deplacer(Number(e.target.value))}
          aria-label={t("voice.seek")}
          aria-valuetext={`${formaterDuree(position)} / ${formaterDuree(duree)}`}
          className={`h-1.5 w-full cursor-pointer ${surFondPlein ? "accent-white" : "accent-orange-700"}`}
        />
        <p className={`mt-0.5 font-mono text-[10px] tabular-nums ${surFondPlein ? "text-white/80" : "text-slate-600"}`}>
          {formaterDuree(position)} / {formaterDuree(duree)}
        </p>
      </div>
      <button
        type="button"
        onClick={changerVitesse}
        aria-label={t("voice.speed", { speed: vitesse })}
        className={`shrink-0 cursor-pointer border px-1.5 py-1 font-mono text-[10px] font-semibold tabular-nums transition-colors ${bouton}`}
      >
        {vitesse}×
      </button>
    </div>
  );
}
