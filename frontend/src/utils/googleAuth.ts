/**
 * Client ID OAuth Google (public, jamais un secret) pour "Se connecter avec
 * Google" — voir GoogleSignInButton.tsx et auth.controller.ts::loginWithGoogle
 * côté serveur. Lu à CHAQUE appel (pas une constante figée au chargement du
 * module) afin que les tests puissent en changer la valeur (`vi.stubEnv`)
 * sans avoir à recharger le module, et pour que le composant se comporte
 * correctement même si la variable n'est disponible qu'après un premier
 * rendu (peu probable en pratique, mais sans coût ici).
 */
export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
}

/**
 * Tant que GOOGLE_CLIENT_ID n'est pas configuré (ni ici, ni côté serveur —
 * voir env.ts::googleClientId), le bouton "Se connecter avec Google" reste
 * simplement masqué : aucune autre partie de l'interface n'a besoin d'être
 * modifiée pour activer la fonctionnalité une fois le Client ID renseigné.
 */
export function isGoogleSignInEnabled(): boolean {
  return googleClientId() !== "";
}
