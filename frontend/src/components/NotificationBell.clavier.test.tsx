import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { NotificationItem } from "../types";
import NotificationBell from "./NotificationBell";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * La cloche s'ouvre au clavier mais ne se refermait qu'au clic de souris à l'extérieur : Échap ne faisait rien, le focus
 * pouvait quitter le panneau sans qu'il se ferme, le bouton ne disait pas s'il était ouvert, et le nombre de notifications
 * non vues (pastille visuelle) n'était pas lu.
 */
const notification = (id: string): NotificationItem => ({
  id,
  type: "message",
  severity: "info",
  title: `Titre ${id}`,
  description: "Description",
  link: "/messages",
  createdAt: "2026-09-10T10:00:00.000Z",
});

function rendre(n = 2) {
  mockedApi.get.mockResolvedValue({ data: { notifications: Array.from({ length: n }, (_, i) => notification(`n${i + 1}`)) } });
  return render(
    <MemoryRouter>
      <button type="button">Autre bouton</button>
      <NotificationBell />
    </MemoryRouter>
  );
}

const cloche = () => screen.getByRole("button", { name: /^Notifications/ });

describe("NotificationBell — clavier et lecteur d'écran", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.post.mockResolvedValue({ data: { success: true } });
  });

  it("dit si le panneau est ouvert (aria-expanded) et lequel il commande (aria-controls)", async () => {
    rendre();
    await waitFor(() => expect(cloche()).toHaveAccessibleName(/2/));
    const utilisateur = userEvent.setup();

    expect(cloche()).toHaveAttribute("aria-expanded", "false");
    await utilisateur.click(cloche());
    expect(cloche()).toHaveAttribute("aria-expanded", "true");
    const id = cloche().getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toBeInTheDocument();
  });

  it("lit le nombre de notifications non vues dans le nom du bouton, et garde le nom simple quand il n'y en a pas", async () => {
    rendre(2);
    expect(await screen.findByRole("button", { name: "Notifications, 2 non vues" })).toBeInTheDocument();
  });

  it("sans notification : le nom reste « Notifications »", async () => {
    rendre(0);
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("Échap ferme le panneau et rend le focus à la cloche", async () => {
    rendre();
    await waitFor(() => expect(cloche()).toHaveAccessibleName(/2/));
    const utilisateur = userEvent.setup();

    await utilisateur.click(cloche());
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    await utilisateur.keyboard("{Escape}");

    expect(screen.queryByRole("heading", { name: "Notifications" })).not.toBeInTheDocument();
    expect(cloche()).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(cloche());
  });

  it("le panneau se ferme quand le focus le quitte au clavier", async () => {
    rendre();
    await waitFor(() => expect(cloche()).toHaveAccessibleName(/2/));
    const utilisateur = userEvent.setup();

    await utilisateur.click(cloche());
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    // Sort du panneau par Tab jusqu'à un bouton situé avant la cloche.
    act(() => screen.getByRole("button", { name: "Autre bouton" }).focus());

    expect(screen.queryByRole("heading", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("un clic dans une zone non focalisable du panneau ne le ferme pas", async () => {
    rendre();
    await waitFor(() => expect(cloche()).toHaveAccessibleName(/2/));
    const utilisateur = userEvent.setup();

    await utilisateur.click(cloche());
    await utilisateur.click(screen.getByRole("heading", { name: "Notifications" }));
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
  });
});
