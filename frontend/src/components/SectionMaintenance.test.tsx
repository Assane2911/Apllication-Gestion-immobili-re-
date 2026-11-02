import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { problemeDeFenetre, versChampLocal } from "../utils/maintenance";
import SectionMaintenance from "./SectionMaintenance";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});
const mocked = vi.mocked(api, { deep: true });

const H = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const etat = (debutMs: number, finMs: number, message: string | null = null) => ({ maintenance: { debut: iso(debutMs), fin: iso(finMs), message } });

beforeEach(() => {
  mocked.get.mockReset();
  mocked.put.mockReset();
  mocked.delete.mockReset();
});

describe("problemeDeFenetre / versChampLocal", () => {
  const maintenant = new Date("2026-11-02T12:00:00").getTime();
  it("applique les mêmes règles que le serveur", () => {
    expect(problemeDeFenetre("", "2026-11-02T15:00", maintenant)).toBe("incomplete");
    expect(problemeDeFenetre("2026-11-02T14:00", "2026-11-02T13:00", maintenant)).toBe("order");
    expect(problemeDeFenetre("2026-11-02T09:00", "2026-11-02T11:00", maintenant)).toBe("past");
    expect(problemeDeFenetre("2026-11-02T12:00", "2026-11-03T13:00", maintenant)).toBe("tooLong");
    expect(problemeDeFenetre("2026-11-02T13:00", "2026-11-02T15:00", maintenant)).toBeNull();
    expect(problemeDeFenetre("2026-11-02T12:00", "2026-11-03T12:00", maintenant)).toBeNull(); // 24 h pile
  });
  it("met une date au format d'un champ datetime-local, en heure locale", () => {
    expect(versChampLocal(new Date(2026, 10, 2, 9, 5))).toBe("2026-11-02T09:05");
  });
});

describe("SectionMaintenance", () => {
  it("sans maintenance, le dit et propose de programmer (désactivé tant que la fenêtre est incomplète)", async () => {
    mocked.get.mockResolvedValue({ data: { maintenance: null } });
    render(<SectionMaintenance numero="03" />);
    expect(await screen.findByText("Aucune maintenance programmée")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/admin/maintenance");
    expect(screen.getByRole("button", { name: "Programmer la maintenance" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Annuler la maintenance" })).not.toBeInTheDocument();
  });

  it("programme une maintenance : dates converties en UTC, message nettoyé, retour affiché", async () => {
    mocked.get.mockResolvedValue({ data: { maintenance: null } });
    mocked.put.mockResolvedValue({ data: etat(3 * H, 4 * H, "Sauvegarde") });
    const user = userEvent.setup();
    render(<SectionMaintenance numero="03" />);
    await screen.findByText("Aucune maintenance programmée");

    const debut = new Date(Date.now() + 3 * H);
    const fin = new Date(Date.now() + 4 * H);
    await user.type(screen.getByLabelText("Début"), versChampLocal(debut));
    await user.type(screen.getByLabelText("Fin"), versChampLocal(fin));
    await user.type(screen.getByLabelText(/Message affiché/), "  Sauvegarde  ");
    await user.click(screen.getByRole("button", { name: "Programmer la maintenance" }));

    await waitFor(() => expect(mocked.put).toHaveBeenCalledTimes(1));
    const [url, corps] = mocked.put.mock.calls[0] as [string, { debut: string; fin: string; message: string }];
    expect(url).toBe("/admin/maintenance");
    expect(corps.message).toBe("Sauvegarde");
    expect(new Date(corps.debut).getTime()).toBe(new Date(versChampLocal(debut)).getTime());
    expect(new Date(corps.fin).getTime()).toBe(new Date(versChampLocal(fin)).getTime());
    expect(await screen.findByText(/Maintenance programmée\. Les utilisateurs en seront informés/)).toBeInTheDocument();
    expect(screen.getByText(/^Programmée : du/)).toBeInTheDocument();
  });

  it("refuse d'envoyer une fenêtre incohérente et dit pourquoi", async () => {
    mocked.get.mockResolvedValue({ data: { maintenance: null } });
    const user = userEvent.setup();
    render(<SectionMaintenance numero="03" />);
    await screen.findByText("Aucune maintenance programmée");
    await user.type(screen.getByLabelText("Début"), versChampLocal(new Date(Date.now() + 5 * H)));
    await user.type(screen.getByLabelText("Fin"), versChampLocal(new Date(Date.now() + 4 * H)));
    expect(screen.getByRole("alert")).toHaveTextContent("La fin doit être postérieure au début.");
    expect(screen.getByRole("button", { name: "Programmer la maintenance" })).toBeDisabled();
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it("« Commencer maintenant » remplit le début, et une maintenance imminente demande confirmation", async () => {
    mocked.get.mockResolvedValue({ data: { maintenance: null } });
    mocked.put.mockResolvedValue({ data: etat(-1000, H) });
    const confirmation = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<SectionMaintenance numero="03" />);
    await screen.findByText("Aucune maintenance programmée");
    await user.click(screen.getByRole("button", { name: "Commencer maintenant" }));
    expect((screen.getByLabelText("Début") as HTMLInputElement).value).not.toBe("");
    await user.type(screen.getByLabelText("Fin"), versChampLocal(new Date(Date.now() + 2 * H)));

    await user.click(screen.getByRole("button", { name: "Programmer la maintenance" }));
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(mocked.put).not.toHaveBeenCalled(); // refusée

    await user.click(screen.getByRole("button", { name: "Programmer la maintenance" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^En cours, jusqu'au/)).toBeInTheDocument();
    confirmation.mockRestore();
  });

  it("montre la maintenance programmée, pré-remplit le formulaire, et l'annule", async () => {
    mocked.get.mockResolvedValue({ data: etat(3 * H, 4 * H, "Opération X") });
    mocked.delete.mockResolvedValue({ data: { maintenance: null } });
    const user = userEvent.setup();
    render(<SectionMaintenance numero="03" />);
    expect(await screen.findByText(/^Programmée : du/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Message affiché/)).toHaveValue("Opération X");
    expect(screen.getByRole("button", { name: "Mettre à jour la maintenance" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler la maintenance" }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith("/admin/maintenance"));
    expect(await screen.findByText("Maintenance annulée.")).toBeInTheDocument();
    expect(screen.getByText("Aucune maintenance programmée")).toBeInTheDocument();
    expect(screen.getByLabelText("Début")).toHaveValue("");
  });

  it("une maintenance en cours se termine d'un clic (« Terminer maintenant »)", async () => {
    mocked.get.mockResolvedValue({ data: etat(-H, H) });
    mocked.delete.mockResolvedValue({ data: { maintenance: null } });
    const user = userEvent.setup();
    render(<SectionMaintenance numero="03" />);
    expect(await screen.findByText(/^En cours, jusqu'au/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Terminer maintenant" }));
    expect(await screen.findByText(/Maintenance terminée : l'application est de nouveau accessible/)).toBeInTheDocument();
  });

  it("affiche l'erreur du serveur, sans perdre la saisie", async () => {
    mocked.get.mockResolvedValue({ data: { maintenance: null } });
    mocked.put.mockRejectedValue(Object.assign(new Error("boom"), { isAxiosError: true, response: { data: { code: "MAINTENANCE_TOO_LONG", error: "Une maintenance ne peut pas durer plus de 24 heures." } } }));
    const user = userEvent.setup();
    render(<SectionMaintenance numero="03" />);
    await screen.findByText("Aucune maintenance programmée");
    await user.type(screen.getByLabelText("Début"), versChampLocal(new Date(Date.now() + 2 * H)));
    await user.type(screen.getByLabelText("Fin"), versChampLocal(new Date(Date.now() + 3 * H)));
    await user.click(screen.getByRole("button", { name: "Programmer la maintenance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Une maintenance ne peut pas durer plus de 24 heures.");
    expect(screen.getByLabelText("Fin")).not.toHaveValue("");
  });

  it("n'affiche pas le formulaire quand l'état n'a pas pu être lu : on n'écrase pas ce qu'on ne connaît pas", async () => {
    mocked.get.mockRejectedValue(Object.assign(new Error("boom"), { isAxiosError: true, response: { data: { error: "Erreur serveur de test" } } }));
    render(<SectionMaintenance numero="03" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Erreur serveur de test");
    expect(screen.queryByRole("button", { name: "Programmer la maintenance" })).not.toBeInTheDocument();
  });
});
