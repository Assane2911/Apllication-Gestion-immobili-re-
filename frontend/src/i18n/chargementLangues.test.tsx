import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LanguageSwitcher from "../components/LanguageSwitcher";
import i18n, { chargerLangue, changerLangue } from "./index";

/**
 * Les quatre langues étaient embarquées d'office dans le fichier principal (≈ 260 Ko compressés) : un visiteur
 * français téléchargeait aussi l'anglais, l'espagnol et le portugais avant de voir la première page. Le français
 * (langue par défaut et de repli) reste dans le fichier principal ; les autres se chargent à la demande.
 */
afterEach(async () => {
  await changerLangue("fr");
});

describe("Chargement des langues à la demande", () => {
  it("garde le français disponible en permanence, langue de repli", () => {
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(true);
    expect(i18n.t("common.language.selectAria")).toBe("Changer de langue");
  });

  it("charge une langue au moment où on la demande, puis la garde", async () => {
    await chargerLangue("es");
    expect(i18n.hasResourceBundle("es", "translation")).toBe(true);
    await chargerLangue("es"); // déjà chargée : sans effet, sans erreur
    expect(i18n.hasResourceBundle("es", "translation")).toBe(true);
  });

  it("changerLangue charge la langue AVANT de basculer : jamais de clés brutes ni de français par erreur", async () => {
    await changerLangue("en");
    expect(i18n.language).toBe("en");
    expect(i18n.t("common.language.selectAria")).toBe("Change language");
  });

  it("ignore une langue non prise en charge, sans erreur ni changement", async () => {
    await chargerLangue("xx");
    expect(i18n.hasResourceBundle("xx", "translation")).toBe(false);
    await changerLangue("xx");
    expect(i18n.language).toBe("fr");
  });

  it("le sélecteur de langue bascule vers une langue chargée à la demande", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    await user.selectOptions(screen.getByRole("combobox"), "pt");
    await waitFor(() => expect(i18n.language).toBe("pt"));
    expect(i18n.hasResourceBundle("pt", "translation")).toBe(true);
  });

  it("au démarrage, charge la langue mémorisée du visiteur avant l'affichage (pas de français passager)", async () => {
    localStorage.setItem("app_language", "es");
    vi.resetModules();
    const neuf = await import("./index");
    await neuf.i18nPret;
    expect(neuf.default.language).toBe("es");
    expect(neuf.default.hasResourceBundle("es", "translation")).toBe(true);
    expect(neuf.default.t("common.language.selectAria")).not.toBe("Changer de langue");
    expect(neuf.default.t("common.language.selectAria")).not.toBe("common.language.selectAria");
    localStorage.removeItem("app_language");
  });
});
