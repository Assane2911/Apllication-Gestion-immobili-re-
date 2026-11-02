import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/auth";
import { useMaintenance } from "../hooks/useMaintenance";
import BandeauMaintenance from "./BandeauMaintenance";
import PageMaintenance from "./PageMaintenance";

/** Pages qui restent accessibles pendant la maintenance : la connexion (l'administrateur doit pouvoir entrer) et les textes légaux. */
const PAGES_OUVERTES = ["/login", "/mentions-legales", "/cgu", "/confidentialite"];

const estPageOuverte = (chemin: string) => PAGES_OUVERTES.some((page) => chemin === page || chemin.startsWith(`${page}/`));

/**
 * Pendant une maintenance, affiche l'écran de maintenance à la place de l'application — pour tout le monde sauf l'administrateur,
 * qui garde l'accès pour mener l'opération. Avant son début, annonce la maintenance par un bandeau ; à sa fin, recharge la page
 * pour repartir sur des données fraîches (les écrans ouverts pendant la coupure n'ont pas pu se mettre à jour).
 */
export default function PorteMaintenance({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { etat, enCours, aAnnoncer, maintenant, verification, verifier } = useMaintenance();

  const administrateur = user?.role === "ADMIN";
  const bloque = enCours && etat !== null && !administrateur && !estPageOuverte(pathname);

  const etaitBloque = useRef(false);
  useEffect(() => {
    if (etaitBloque.current && !bloque && !enCours) window.location.reload();
    etaitBloque.current = bloque;
  }, [bloque, enCours]);

  if (bloque && etat) return <PageMaintenance etat={etat} maintenant={maintenant} verification={verification} onVerifier={verifier} />;
  return (
    <>
      {children}
      {etat && (enCours ? administrateur : aAnnoncer) && <BandeauMaintenance etat={etat} enCours={enCours} />}
    </>
  );
}
