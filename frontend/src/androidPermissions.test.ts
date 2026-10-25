import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Permissions de l'application Android (Capacitor), tenues par deux fichiers : le manifeste, et le script
 * `scripts/add-mobile-permissions.sh` qui les y insère après `npx cap add android` (un projet régénéré repartirait
 * sinon d'un manifeste différent).
 *
 * L'application n'a besoin que de la CAMÉRA : ses envois de fichiers passent par `<input type="file">`, y compris
 * `capture="environment"` pour photographier un incident. Le pont Capacitor y demande la permission caméra, et le
 * sélecteur de fichiers du système donne l'accès aux seules photos choisies, sans permission de lecture des médias.
 *
 * `READ_MEDIA_IMAGES` (accès à TOUTES les photos de l'appareil) n'a donc aucune utilité ici. C'est de plus une
 * permission restreinte de Google Play : une application qui la déclare doit justifier son usage, et se voit refuser
 * la publication quand le sélecteur de photos du système suffit.
 */
const RACINE = join(__dirname, "..");
const manifeste = join(RACINE, "android/app/src/main/AndroidManifest.xml");
const script = join(RACINE, "scripts/add-mobile-permissions.sh");
const dispo = existsSync(manifeste) && existsSync(script);

const permissions = (xml: string) => [...xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);

describe.skipIf(!dispo)("permissions Android", () => {
  const declarees = () => permissions(readFileSync(manifeste, "utf8"));

  it("déclare la caméra (photographier un incident) et Internet", () => {
    expect(declarees()).toContain("android.permission.CAMERA");
    expect(declarees()).toContain("android.permission.INTERNET");
  });

  it("n'exige pas de matériel photo pour s'installer (tablettes, appareils sans caméra)", () => {
    expect(readFileSync(manifeste, "utf8")).toMatch(/<uses-feature android:name="android\.hardware\.camera" android:required="false"/);
  });

  it("ne demande aucune permission de lecture des photos ni du stockage", () => {
    const interdites = ["READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_MEDIA_AUDIO", "READ_MEDIA_VISUAL_USER_SELECTED", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "MANAGE_EXTERNAL_STORAGE"];
    for (const p of interdites) expect(declarees(), p).not.toContain(`android.permission.${p}`);
  });

  it("le script d'installation des permissions ne les remet pas dans un projet régénéré", () => {
    // Le code seulement : les commentaires du script expliquent justement pourquoi cette permission est absente.
    const code = readFileSync(script, "utf8")
      .split("\n")
      .filter((ligne) => !ligne.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toContain("READ_MEDIA_IMAGES");
    expect(code).not.toContain("READ_EXTERNAL_STORAGE");
    expect(code).toContain("android.permission.CAMERA");
  });

  it("garde les descriptions d'usage iOS de la caméra et de la photothèque (App Store)", () => {
    const code = readFileSync(script, "utf8");
    expect(code).toContain("NSCameraUsageDescription");
    expect(code).toContain("NSPhotoLibraryUsageDescription");
  });
});
