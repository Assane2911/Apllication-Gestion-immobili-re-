import { createContext, useContext } from "react";

/** Ce que l'historique de navigation de l'application permet de faire depuis la page courante. */
export interface Historique {
  peutReculer: boolean;
  peutAvancer: boolean;
}

export const HistoriqueContext = createContext<Historique>({ peutReculer: false, peutAvancer: false });

export function useHistorique(): Historique {
  return useContext(HistoriqueContext);
}
