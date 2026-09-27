import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./theme";
import { ThemeProvider } from "./ThemeContext";

function Consommateur() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span>Thème actuel : {theme}</span>
      <button onClick={toggleTheme}>Basculer</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("démarre en thème clair par défaut, sans classe dark sur <html>", () => {
    render(
      <ThemeProvider>
        <Consommateur />
      </ThemeProvider>
    );

    expect(screen.getByText("Thème actuel : light")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reprend le thème déjà enregistré dans localStorage", () => {
    localStorage.setItem("theme", "dark");
    render(
      <ThemeProvider>
        <Consommateur />
      </ThemeProvider>
    );

    expect(screen.getByText("Thème actuel : dark")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("bascule le thème, applique/retire la classe dark sur <html> et persiste le choix", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Consommateur />
      </ThemeProvider>
    );

    await user.click(screen.getByRole("button", { name: "Basculer" }));
    expect(screen.getByText("Thème actuel : dark")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Basculer" }));
    expect(screen.getByText("Thème actuel : light")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("ignore une valeur invalide en localStorage et retombe sur le thème clair", () => {
    localStorage.setItem("theme", "sepia");
    render(
      <ThemeProvider>
        <Consommateur />
      </ThemeProvider>
    );

    expect(screen.getByText("Thème actuel : light")).toBeInTheDocument();
  });
});
