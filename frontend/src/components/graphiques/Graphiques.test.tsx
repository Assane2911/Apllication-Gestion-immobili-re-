import { fireEvent, render, waitFor } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { GraphiqueComparaisonFiscale, GraphiqueParc, GraphiqueRevenusDepenses } from "./Graphiques";
import { COULEUR_REVENUS } from "./couleurs";

// jsdom n'a aucune taille de mise en page : le conteneur adaptatif ne dessinerait rien. On lui en donne une, fixe.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 400 } as never) };
});
// Le formatage de la devise est testé ailleurs : ici on vérifie QUEL montant et QUELLE devise le graphique lui transmet.
vi.mock("../../context/currency", () => ({ useCurrency: () => ({ formatMoney: (valeur: number, devise: string) => `${valeur} ${devise}` }) }));

/**
 * Les graphiques du tableau de bord et du bilan fiscal : libellés de légende et d'infobulle (traduits), montant affiché dans la
 * BONNE devise, une paire de barres par devise, couleurs par statut. Un graphique qui montre un montant dans la mauvaise devise
 * est plus trompeur qu'un graphique absent.
 */

const MOIS = [
  { month: "Jan", revenue: 1600000, expense: 400000 },
  { month: "Fév", revenue: 900000, expense: 100000 },
];

/** Survole la zone du graphique : recharts lit la position de la souris par rapport au cadre. */
function survoler(conteneur: HTMLElement, x = 150) {
  const cadre = conteneur.querySelector(".recharts-wrapper") as HTMLElement;
  cadre.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
  fireEvent.mouseMove(conteneur.querySelector(".recharts-surface")!, { clientX: x, clientY: 150 });
}
const infobulle = (conteneur: HTMLElement) => conteneur.querySelector(".recharts-tooltip-wrapper")?.textContent ?? "";
/** La légende, série par série : un libellé « Revenus » collé à la série des dépenses serait une erreur que l'ordre ne montre pas. */
const legende = (conteneur: HTMLElement) =>
  Object.fromEntries(
    Array.from(conteneur.querySelectorAll(".recharts-legend-item")).map((item) => [
      item.querySelector("svg")?.getAttribute("aria-label")?.replace(" legend icon", "") ?? "?",
      item.querySelector(".recharts-legend-item-text")?.textContent ?? "",
    ])
  );
/**
 * Les barres sont dessinées par une animation que jsdom ne déroule pas : on lit leurs couleurs là où elles sont écrites, sur les
 * pastilles de la légende (une par série, repérée par son nom : « revenue », « expense_XOF »…).
 */
const pastille = (conteneur: HTMLElement, serie: string) => conteneur.querySelector(`svg[aria-label="${serie} legend icon"] path`)?.getAttribute("fill");

describe("GraphiqueRevenusDepenses (tableau de bord)", () => {
  it("la légende est traduite : « Revenus » et « Dépenses »", () => {
    const { container } = render(<GraphiqueRevenusDepenses data={MOIS} currency="XOF" />);

    expect(legende(container)).toEqual({ revenue: "Revenus", expense: "Dépenses" });
  });

  it("l'infobulle montre le mois, les libellés traduits et chaque montant dans la devise du graphique", async () => {
    const { container } = render(<GraphiqueRevenusDepenses data={MOIS} currency="XOF" />);

    survoler(container);

    await waitFor(() => expect(infobulle(container)).toContain("Revenus encaissés : 1600000 XOF"));
    expect(infobulle(container)).toContain("Dépenses & Travaux : 400000 XOF");
    expect(infobulle(container)).toContain("Jan");
  });

  it("une autre devise passée au graphique est celle qui s'affiche", async () => {
    const { container } = render(<GraphiqueRevenusDepenses data={MOIS} currency="EUR" />);

    survoler(container);

    await waitFor(() => expect(infobulle(container)).toContain("1600000 EUR"));
    expect(infobulle(container)).not.toContain("XOF");
  });

  it("les revenus sont pleins et les dépenses hachurées, avec leurs couleurs", () => {
    const { container } = render(<GraphiqueRevenusDepenses data={MOIS} currency="XOF" />);

    expect(pastille(container, "revenue")).toBe(COULEUR_REVENUS);
    expect(pastille(container, "expense")).toBe("url(#hachure-depenses)");
    expect(container.querySelector("pattern#hachure-depenses")).not.toBeNull();
  });
});

describe("GraphiqueComparaisonFiscale (bilan fiscal)", () => {
  const donnees = [{ month: "Jan", revenue_XOF: 500000, expense_XOF: 120000, revenue_EUR: 800, expense_EUR: 200 }];

  it("une seule devise : légende simple, sans rappel de la devise", () => {
    const { container } = render(<GraphiqueComparaisonFiscale data={donnees} devises={["XOF"]} />);

    expect(legende(container)).toEqual({ revenue_XOF: "Revenus", expense_XOF: "Dépenses" });
  });

  it("plusieurs devises : une paire de barres par devise, légende et infobulle précisent laquelle", async () => {
    const { container } = render(<GraphiqueComparaisonFiscale data={donnees} devises={["XOF", "EUR"]} />);

    expect(legende(container)).toEqual({ revenue_XOF: "Revenus (XOF)", expense_XOF: "Dépenses (XOF)", revenue_EUR: "Revenus (EUR)", expense_EUR: "Dépenses (EUR)" });
    expect(container.querySelectorAll(".recharts-bar").length).toBe(4);

    survoler(container);

    await waitFor(() => expect(infobulle(container)).toContain("Revenus encaissés (XOF) : 500000 XOF"));
    expect(infobulle(container)).toContain("Dépenses & Travaux (EUR) : 200 EUR");
    expect(infobulle(container)).toContain("Revenus encaissés (EUR) : 800 EUR");
  });

  it("chaque devise a sa propre couleur de revenus et sa propre hachure de dépenses", () => {
    const { container } = render(<GraphiqueComparaisonFiscale data={donnees} devises={["XOF", "EUR"]} />);

    expect(pastille(container, "revenue_XOF")).toBeTruthy();
    expect(pastille(container, "revenue_EUR")).toBeTruthy();
    expect(pastille(container, "revenue_XOF")).not.toBe(pastille(container, "revenue_EUR"));
    expect(pastille(container, "expense_XOF")).toBe("url(#hachure-fiscal-0)");
    expect(pastille(container, "expense_EUR")).toBe("url(#hachure-fiscal-1)");
    expect(container.querySelector("pattern#hachure-fiscal-0")).not.toBeNull();
    expect(container.querySelector("pattern#hachure-fiscal-1")).not.toBeNull();
  });

  it("une seule devise : l'infobulle n'ajoute pas la devise au libellé, mais le montant la porte", async () => {
    const { container } = render(<GraphiqueComparaisonFiscale data={donnees} devises={["XOF"]} />);

    survoler(container);

    await waitFor(() => expect(infobulle(container)).toContain("Revenus encaissés : 500000 XOF"));
    expect(infobulle(container)).not.toContain("(XOF)");
  });
});

describe("GraphiqueParc (répartition du parc)", () => {
  const libelles = { AVAILABLE: "Disponible", OCCUPIED: "Occupé", MAINTENANCE: "En travaux" };

  it("l'infobulle d'un secteur dit « 1 bien » (singulier) avec le libellé du statut", async () => {
    const { container } = render(<GraphiqueParc data={[{ status: "OCCUPIED", value: 1 }]} libelles={libelles} />);
    await waitFor(() => expect(container.querySelector(".recharts-pie-sector")).not.toBeNull());

    fireEvent.mouseEnter(container.querySelector(".recharts-pie-sector")!);
    fireEvent.mouseMove(container.querySelector(".recharts-pie-sector")!);

    await waitFor(() => expect(infobulle(container)).toContain("Occupé : 1 bien"));
    expect(infobulle(container)).not.toContain("1 biens");
  });

  it("l'infobulle d'un secteur dit « 4 biens » (pluriel) avec le libellé du statut", async () => {
    const { container } = render(<GraphiqueParc data={[{ status: "AVAILABLE", value: 4 }]} libelles={libelles} />);
    await waitFor(() => expect(container.querySelector(".recharts-pie-sector")).not.toBeNull());

    fireEvent.mouseEnter(container.querySelector(".recharts-pie-sector")!);
    fireEvent.mouseMove(container.querySelector(".recharts-pie-sector")!);

    await waitFor(() => expect(infobulle(container)).toContain("Disponible : 4 biens"));
  });
});
