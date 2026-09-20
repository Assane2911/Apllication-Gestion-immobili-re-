import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GoogleSignInButton from "./GoogleSignInButton";

const SCRIPT_SELECTOR = 'script[src="https://accounts.google.com/gsi/client"]';

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
  document.head.querySelectorAll(SCRIPT_SELECTOR).forEach((el) => el.remove());
});

describe("GoogleSignInButton", () => {
  it("ne rend rien tant que VITE_GOOGLE_CLIENT_ID n'est pas configuré", () => {
    render(<GoogleSignInButton onCredential={vi.fn()} />);
    expect(screen.queryByTestId("google-signin-button")).not.toBeInTheDocument();
  });

  it("initialise Google Identity Services et dessine le bouton une fois le Client ID configuré", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
    const initialize = vi.fn();
    const renderButton = vi.fn();
    // Simule un script déjà chargé (window.google disponible) : le
    // composant doit alors s'initialiser immédiatement, sans réinjecter de
    // <script> dans le document.
    (window as unknown as { google: unknown }).google = { accounts: { id: { initialize, renderButton } } };

    render(<GoogleSignInButton onCredential={vi.fn()} locale="fr" />);

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "test-client-id.apps.googleusercontent.com" })
    );
    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    expect(renderButton.mock.calls[0][1]).toMatchObject({ locale: "fr" });
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
  });

  it("transmet le jeton d'identité reçu du callback Google via onCredential", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
    const initialize = vi.fn();
    (window as unknown as { google: unknown }).google = {
      accounts: { id: { initialize, renderButton: vi.fn() } },
    };
    const onCredential = vi.fn();

    render(<GoogleSignInButton onCredential={onCredential} />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    const { callback } = initialize.mock.calls[0][0] as { callback: (r: { credential: string }) => void };
    callback({ credential: "jeton-google-de-test" });

    expect(onCredential).toHaveBeenCalledWith("jeton-google-de-test");
  });

  it("appelle onError et n'affiche pas le bouton si le script Google échoue à charger", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
    const onError = vi.fn();

    render(<GoogleSignInButton onCredential={vi.fn()} onError={onError} />);

    const script = await waitFor(() => {
      const el = document.head.querySelector(SCRIPT_SELECTOR);
      if (!el) throw new Error("script pas encore injecté");
      return el;
    });
    script.dispatchEvent(new Event("error"));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("google-signin-button")).not.toBeInTheDocument();
  });
});
