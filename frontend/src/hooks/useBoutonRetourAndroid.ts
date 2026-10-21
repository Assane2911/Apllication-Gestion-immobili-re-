import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useHistorique } from "../context/historique";
import { traiterRetourSurCouche } from "../utils/couchesRetour";

/**
 * Bouton retour du téléphone, dans l'application Android (Capacitor).
 *
 * Sans écouteur, Capacitor recule dans l'historique de la WebView, puis quitte l'application : un menu ou une
 * fenêtre ouverts restaient derrière la page qu'on quittait. Dès qu'un écouteur est posé, ce comportement par défaut
 * disparaît et tout se décide ici, dans cet ordre :
 *   1. refermer ce qui recouvre la page (menu, fenêtre modale : voir couchesRetour) ;
 *   2. sinon reculer d'une page dans l'application, comme le bouton « Retour » des en-têtes ;
 *   3. sinon (première page de la session) quitter l'application, comme le fait Android.
 *
 * Sans effet dans un navigateur et sur iOS, qui n'ont pas de bouton retour matériel. À placer dans le routeur, sous
 * le fournisseur d'historique.
 */
export function useBoutonRetourAndroid() {
  const navigate = useNavigate();
  const { peutReculer } = useHistorique();
  // L'écouteur est posé une fois ; il lit l'état courant plutôt que celui du rendu qui l'a créé.
  const peutReculerRef = useRef(peutReculer);
  useEffect(() => {
    peutReculerRef.current = peutReculer;
  }, [peutReculer]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

    let demonte = false;
    let ecouteur: PluginListenerHandle | null = null;

    void App.addListener("backButton", () => {
      if (traiterRetourSurCouche()) return;
      if (peutReculerRef.current) navigate(-1);
      else void App.exitApp();
    }).then((poignee) => {
      // Démonté avant que la pose ne se termine : on retire aussitôt l'écouteur qui vient d'être posé.
      if (demonte) void poignee.remove();
      else ecouteur = poignee;
    });

    return () => {
      demonte = true;
      void ecouteur?.remove();
    };
  }, [navigate]);
}
