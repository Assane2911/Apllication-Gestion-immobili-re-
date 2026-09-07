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
  USD: { code: "USD", symbol: "$", name: "Dollar US", flag: "🇺🇸", symbolPosition: "before" },
  XOF: { code: "XOF", symbol: "FCFA", name: "Franc CFA (UEMOA)", flag: "🌍", symbolPosition: "after" },
  XAF: { code: "XAF", symbol: "FCFA", name: "Franc CFA (CEMAC)", flag: "🌍", symbolPosition: "after" },
  STN: { code: "STN", symbol: "Db", name: "Dobra (São Tomé)", flag: "🇸🇹", symbolPosition: "after" },
  GBP: { code: "GBP", symbol: "£", name: "Livre Sterling", flag: "🇬🇧", symbolPosition: "before" },
  CAD: { code: "CAD", symbol: "$CA", name: "Dollar Canadien", flag: "🇨🇦", symbolPosition: "before" },
  CHF: { code: "CHF", symbol: "CHF", name: "Franc Suisse", flag: "🇨🇭", symbolPosition: "after" },
  MAD: { code: "MAD", symbol: "DH", name: "Dirham Marocain", flag: "🇲🇦", symbolPosition: "after" },
};

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
