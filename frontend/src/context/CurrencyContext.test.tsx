import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "./AuthContext";
import { CurrencyProvider } from "./CurrencyContext";
import { useCurrency } from "./currency";

// AuthProvider ne fait un appel réseau (api.get("/auth/me")) que si un token
// est déjà présent dans localStorage — aucun test ci-dessous n'en pose un,
// donc aucun mock d'axios n'est nécessaire pour ces tests de formatage.

function TestConsumer() {
  const { formatMoney, currency, setCurrency, availableCurrencies } = useCurrency();
  return (
    <div>
      <span data-testid="currency">{currency}</span>
      <span data-testid="amount-500">{formatMoney(500)}</span>
      <span data-testid="amount-null">{formatMoney(null)}</span>
      <span data-testid="amount-nan">{formatMoney(NaN)}</span>
      <span data-testid="amount-override">{formatMoney(1234.5, "USD")}</span>
      <span data-testid="amount-inconnue">{formatMoney(35000, "XYZ")}</span>
      <span data-testid="amount-gnf">{formatMoney(50000, "GNF")}</span>
      <select data-testid="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {availableCurrencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
      <button type="button" data-testid="set-invalid" onClick={() => setCurrency("NOPE")}>
        devise invalide
      </button>
    </div>
  );
}

function renderWithProviders() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <TestConsumer />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("CurrencyProvider — formatMoney", () => {
  it("formate un montant en EUR par défaut, symbole après le nombre", () => {
    renderWithProviders();
    expect(screen.getByTestId("amount-500").textContent).toBe("500 €");
  });

  it("affiche un tiret pour un montant null, undefined ou NaN", () => {
    renderWithProviders();
    expect(screen.getByTestId("amount-null").textContent).toBe("—");
    expect(screen.getByTestId("amount-nan").textContent).toBe("—");
  });

  it("respecte une devise de remplacement (overrideCurrency), symbole avant le nombre pour l'USD", () => {
    renderWithProviders();
    // fr-FR sépare les milliers par une espace fine insécable (U+202F), pas
    // une espace normale — on reproduit le même formatage que l'app plutôt que
    // de deviner le caractère exact.
    const expectedNumber = new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(1234.5);
    expect(screen.getByTestId("amount-override").textContent).toBe(`$${expectedNumber}`);
  });

  it("affiche le code brut d'une devise inconnue, au lieu de la faire passer pour une autre", () => {
    // Le cas dangereux. Une facture libellée dans une devise absente de la
    // liste — retirée du sélecteur, saisie par une version antérieure, ou
    // simplement acceptée par le serveur qui ne valide pas le code — était
    // formatée avec le symbole de la devise d'AFFICHAGE du gestionnaire :
    // 35 000 d'une monnaie quelconque devenaient « 35 000 € » sans le moindre
    // signe. Un montant faux qui a l'air juste ne se découvre qu'au litige.
    // Afficher le code brut est laid, et c'est exactement ce qu'il faut : ça
    // se voit.
    renderWithProviders();

    const expectedNumber = new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(35000);
    expect(screen.getByTestId("amount-inconnue").textContent).toBe(`${expectedNumber} XYZ`);
  });

  it("propose les devises des pays déjà couverts par la plateforme", () => {
    // La Guinée, la Mauritanie et la RDC figuraient dans la liste des pays
    // sans que leur monnaie existe ici : on pouvait publier un bien à Conakry
    // sans pouvoir en fixer le loyer en francs guinéens.
    renderWithProviders();

    const expectedNumber = new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(50000);
    expect(screen.getByTestId("amount-gnf").textContent).toBe(`${expectedNumber} FG`);
    const codes = Array.from(screen.getByTestId("select").querySelectorAll("option")).map((o) => o.value);
    expect(codes).toEqual(expect.arrayContaining(["GNF", "MRU", "CDF"]));
  });
});

describe("CurrencyProvider — la devise de la pièce prime sur celle du gestionnaire", () => {
  it("garde la devise d'une facture même quand le gestionnaire affiche autre chose", async () => {
    // Une facture porte sa propre devise : la changer parce que le
    // gestionnaire a choisi d'afficher ses totaux en FCFA reviendrait à
    // réécrire la pièce. Seuls les montants SANS devise propre suivent la
    // préférence d'affichage.
    const user = userEvent.setup();
    renderWithProviders();

    await user.selectOptions(screen.getByTestId("select"), "XOF");

    expect(screen.getByTestId("amount-500").textContent).toBe("500 FCFA");
    const attendu = new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(1234.5);
    expect(screen.getByTestId("amount-override").textContent).toBe(`$${attendu}`);
  });
});

describe("CurrencyProvider — setCurrency", () => {
  it("change la devise active et la persiste dans localStorage", async () => {
    const user = userEvent.setup();
    renderWithProviders();

    await user.selectOptions(screen.getByTestId("select"), "XOF");

    expect(screen.getByTestId("currency").textContent).toBe("XOF");
    expect(localStorage.getItem("app_currency")).toBe("XOF");
    expect(screen.getByTestId("amount-500").textContent).toBe("500 FCFA");
  });

  it("ignore un code de devise inconnu (garde silencieusement l'ancienne devise)", async () => {
    const user = userEvent.setup();
    renderWithProviders();

    expect(screen.getByTestId("currency").textContent).toBe("EUR");
    await user.click(screen.getByTestId("set-invalid"));
    expect(screen.getByTestId("currency").textContent).toBe("EUR");
    expect(localStorage.getItem("app_currency")).not.toBe("NOPE");
  });
});
