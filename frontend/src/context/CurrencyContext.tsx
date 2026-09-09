import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { useAuth } from "./auth";
import { CURRENCIES, CurrencyContext, useCurrency } from "./currency";

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currency, setCurrencyState] = useState<string>(() => {
    return localStorage.getItem("app_currency") || user?.currency || "EUR";
  });
  // Synchronise la devise locale sur celle du profil dès qu'elle change (ex. après
  // connexion, une fois `user` chargé) — ajustement pendant le rendu plutôt que
  // dans un effet, cf. https://react.dev/learn/you-might-not-need-an-effect
  const [prevUserCurrency, setPrevUserCurrency] = useState(user?.currency);
  if (user?.currency !== prevUserCurrency) {
    setPrevUserCurrency(user?.currency);
    if (user?.currency && user.currency !== currency) {
      setCurrencyState(user.currency);
      localStorage.setItem("app_currency", user.currency);
    }
  }

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

/** Composant Sélecteur de Devise élégant pour la barre de navigation */
export function CurrencySelector({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const { currency, setCurrency, availableCurrencies } = useCurrency();

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className="bg-slate-800/80 hover:bg-slate-800 text-slate-100 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer shadow-sm transition-all"
        aria-label={t("nav.currencyLabel")}
        title={t("nav.currencyLabel")}
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
