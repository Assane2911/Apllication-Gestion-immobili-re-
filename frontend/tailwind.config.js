/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Remplace la pile système par défaut de Tailwind (font-sans) — texte
        // courant et tableaux. Le fallback système reste actif tant que la
        // police Google Fonts (chargée dans index.html) n'a pas fini de charger.
        sans: ['"Public Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        // Réservée aux titres (h1-h3, voir index.css) — plus de caractère que
        // le corps de texte, sans devenir un second style à gérer page par page.
        display: ['"Manrope"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Fond des pages en thème clair : un cran plus soutenu que slate-50, pour
        // que les cartes blanches (bg-white) se détachent du fond au lieu de s'y
        // fondre. En thème sombre, les pages gardent slate-950 (voir les layouts).
        canvas: "#edf1f6",
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        // Bleu-nuit affiné pour les surfaces toujours sombres (barre latérale,
        // en-tête locataire) — mêmes usages que le slate par défaut, en plus
        // riche : évite le gris plat sans introduire une nouvelle palette
        // dans chaque page.
        ink: {
          950: "#0a0e1a",
          900: "#0f1524",
          800: "#151b2c",
          700: "#232b3f",
        },
      },
      // Les teintes des ombres sont celles du texte (slate-900), pas du noir pur :
      // plus douces sur fond clair. `xs` et `2xs` n'existent pas dans Tailwind 3 (ce
      // sont des noms de la v4) : les ~50 éléments qui les utilisaient n'avaient
      // aucune ombre — d'où des cartes plates. Elles sont définies ici, et les
      // ombres courantes (sm, DEFAULT, md) sont renforcées pour le thème clair. En
      // thème sombre elles restent à peine visibles sur fond sombre, sans gêne.
      boxShadow: {
        "2xs": "0 1px 1px 0 rgb(15 23 42 / 0.06)",
        xs: "0 1px 2px 0 rgb(15 23 42 / 0.08)",
        sm: "0 1px 3px 0 rgb(15 23 42 / 0.1), 0 1px 2px -1px rgb(15 23 42 / 0.08)",
        DEFAULT: "0 2px 6px -1px rgb(15 23 42 / 0.12), 0 1px 3px -1px rgb(15 23 42 / 0.08)",
        md: "0 6px 14px -3px rgb(15 23 42 / 0.14), 0 2px 6px -2px rgb(15 23 42 / 0.08)",
      },
      // Contour des cartes et champs : slate-200 (#e2e8f0) disparaissait sur fond
      // clair. Seule l'utilité `border-slate-200` est resserrée (le texte et les
      // fonds en slate-200 gardent leur teinte).
      borderColor: {
        slate: { 200: "#d4dce8" },
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-18px)" },
        },
        gradientX: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        shine: {
          "0%": { transform: "translateX(-150%) skewX(-20deg)" },
          "100%": { transform: "translateX(250%) skewX(-20deg)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        "float-slow": "float 9s ease-in-out infinite",
        "float-delay": "float 7s ease-in-out 1.5s infinite",
        "gradient-x": "gradientX 6s ease infinite",
        shine: "shine 3.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
