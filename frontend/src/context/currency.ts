import { createContext, useContext } from "react";

export interface CurrencyConfig {
  code: string;
  symbol: string;
  name: string;
  flag: string;
  symbolPosition: "before" | "after";
}

export const CURRENCIES: Record<string, CurrencyConfig> = {
  EUR: { code: "EUR", symbol: "€", name: "Euro", flag: "🇪🇺", symbolPosition: "after" },
  XOF: { code: "XOF", symbol: "FCFA", name: "Franc CFA (UEMOA)", flag: "🌍", symbolPosition: "after" },
};

/**
 * Configuration d'affichage d'un code de devise, y compris inconnu.
 *
 * Le serveur n'impose aucune liste (`currency: z.string().min(1).max(10)`), et
 * la liste ci-dessus peut rétrécir : un code inconnu n'est donc pas une
 * anomalie théorique. Lui rendre une configuration bâtie sur lui-même — le
 * code en guise de symbole — fait afficher « 35 000 XYZ ». C'est volontaire et
 * préférable au repli historique vers l'euro, qui transformait un montant
 * inconnu en montant faux d'apparence normale.
 */
export function configDevise(code: string): CurrencyConfig {
  return (
    CURRENCIES[code] ?? { code, symbol: code, name: code, flag: "", symbolPosition: "after" }
  );
}

export interface CurrencyContextValue {
  currency: string;
  currentCurrencyConfig: CurrencyConfig;
  setCurrency: (code: string) => Promise<void>;
  formatMoney: (amount: number | null | undefined, overrideCurrency?: string | null) => string;
  availableCurrencies: CurrencyConfig[];
}

export const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency doit être utilisé dans un CurrencyProvider");
  return ctx;
}
