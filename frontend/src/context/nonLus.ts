import { createContext, useContext } from "react";

/** Messages non lus du gestionnaire : le total, et sa répartition entre locataires et propriétaires (onglets de la messagerie). */
export interface NonLusGestionnaire {
  count: number;
  tenants: number;
  owners: number;
}

export const NonLusContext = createContext<NonLusGestionnaire>({ count: 0, tenants: 0, owners: 0 });

/** Les compteurs de la messagerie du gestionnaire, fournis par ManagerLayout (zéros hors de ce contexte). */
export const useNonLusGestionnaire = () => useContext(NonLusContext);
