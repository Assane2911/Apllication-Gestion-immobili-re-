import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

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

interface CurrencyContextValue {
  currency: string;
  currentCurrencyConfig: CurrencyConfig;
  setCurrency: (code: string) => Promise<void>;
  formatMoney: (amount: number | null | undefined, overrideCurrency?: string | null) => string;
  availableCurrencies: CurrencyConfig[];
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currency, setCurrencyState] = useState<string>(() => {
    return localStorage.getItem("app_currency") || user?.currency || "EUR";
  });

  useEffect(() => {
    if (user?.currency && user.currency !== currency) {
      setCurrencyState(user.currency);
      localStorage.setItem("app_currency", user.currency);
    }
  }, [user?.currency]);

  async function setCurrency(code: string) {
    if (!CURRENCIES[code]) return;
    setCurrencyState(code);
    localStorage.setItem("app_currency", code);

    // Si l'utilisateur est connecté, sauvegarder sa préférence sur le backend
    const token = localStorage.getItem("token");
    if (token) {
      try {
        await api.patch("/auth/currency", { currency: code });
      } catch (err) {
        console.warn("Impossible de sauvegarder la devise sur le profil:", err);
      }
    }
  }

  function formatMoney(amount: number | null | undefined, overrideCurrency?: string | null): string {
    if (amount === null || amount === undefined || isNaN(amount)) return "—";

    const currCode = overrideCurrency && CURRENCIES[overrideCurrency] ? overrideCurrency : currency;
    const config = CURRENCIES[currCode] || CURRENCIES.EUR;

    const formattedNumber = new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);

    if (config.symbolPosition === "before") {
      return `${config.symbol}${formattedNumber}`;
    }
    return `${formattedNumber} ${config.symbol}`;
  }

  const currentCurrencyConfig = CURRENCIES[currency] || CURRENCIES.EUR;
  const availableCurrencies = Object.values(CURRENCIES);

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        currentCurrencyConfig,
        setCurrency,
        formatMoney,
        availableCurrencies,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency doit être utilisé dans un CurrencyProvider");
  return ctx;
}

/** Composant Sélecteur de Devise élégant pour la barre de navigation */
export function CurrencySelector({ className = "" }: { className?: string }) {
  const { currency, setCurrency, availableCurrencies } = useCurrency();

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className="bg-slate-800/80 hover:bg-slate-800 text-slate-100 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer shadow-sm transition-all"
        title="Changer la devise de règlement"
      >
        {availableCurrencies.map((c) => (
          <option key={c.code} value={c.code} className="bg-slate-900 text-white">
            {c.flag} {c.code} ({c.symbol}) — {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
