import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fous du manifeste de l'application Android (Capacitor). Le projet natif n'est pas compilé par la CI :
 * ces contrôles lisent le fichier tel qu'il sera livré.
 */
const manifeste = readFileSync(resolve(__dirname, "../../android/app/src/main/AndroidManifest.xml"), "utf8");

describe("AndroidManifest.xml", () => {
  // L'application garde son jeton de session dans le stockage local de la WebView (voir api/client.ts). Avec la
  // sauvegarde automatique d'Android, ce stockage part dans le cloud du compte Google de l'utilisateur et se
  // restaure sur un autre appareil : la session suit, sans connexion, pendant toute la durée du jeton.
  it("désactive la sauvegarde automatique Android : le jeton de session ne doit pas quitter l'appareil", () => {
    expect(manifeste).toMatch(/android:allowBackup="false"/);
  });

  it("n'autorise pas le trafic en clair (http) vers le serveur", () => {
    expect(manifeste).not.toMatch(/usesCleartextTraffic="true"/);
  });

  it("ne partage pas le fournisseur de fichiers avec les autres applications", () => {
    expect(manifeste).toMatch(/FileProvider[\s\S]*?android:exported="false"/);
  });
});
