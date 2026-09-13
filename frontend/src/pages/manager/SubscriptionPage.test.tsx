import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { AuthUser, SubscriptionInfo, SubscriptionPlanDetail } from "../../types";
import SubscriptionPage from "./SubscriptionPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

// Sans ce mock, Capacitor.isNativePlatform() tourne avec son implémentation
// web réelle (toujours `false` sous jsdom) : la branche mobile ajoutée pour
// la conformité App Store/Play Store (grille de plans masquée, message de
// repli) n'était alors exercée par AUCUN test. Défaut à `false` (web) pour
// que tous les tests existants continuent d'exercer la branche web sans
// changement ; les tests dédiés ci-dessous le passent à `true`.
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
}));

const mockedApi = vi.mocked(api, { deep: true });
const mockedIsNativePlatform = vi.mocked(Capacitor.isNativePlatform);

function plan(overrides: Partial<SubscriptionPlanDetail> = {}): SubscriptionPlanDetail {
  return {
    id: "STARTER",
    name: "Starter",
    description: "Pour débuter en toute simplicité",
    monthlyPrice: 19,
    annualPrice: 182,
    currency: "EUR",
    maxProperties: 5,
    popular: false,
    features: ["5 biens", "Support par email"],
    ...overrides,
  };
}

function subscription(overrides: Partial<SubscriptionInfo> = {}): SubscriptionInfo {
  return {
    status: "TRIAL",
    plan: "STARTER",
    trialEndsAt: "2026-09-20T00:00:00.000Z",
    subscriptionEndsAt: null,
    trialDaysRemaining: 7,
    isTrialActive: true,
    isSubscriptionActive: false,
    isExpired: false,
    ...overrides,
  };
}

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "mgr-1",
    email: "gestionnaire@example.com",
    role: "MANAGER",
    subscription: subscription(),
    ...overrides,
  };
}

// Seed un utilisateur déjà connecté (sans "token" : évite que le refreshUser()
// déclenché au montage d'AuthProvider n'appelle /auth/me, ce qui simplifierait
// artificiellement les enchaînements d'appels mockés ci-dessous).
function seedUser(user: AuthUser) {
  localStorage.setItem("user", JSON.stringify(user));
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <SubscriptionPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}


/**
 * Les écrans de paiement interrogent désormais /payments/methods (voir
 * useMoyensDePaiement) : les moyens proposés viennent du serveur et non d'une
 * liste écrite dans le composant. Cette requête supplémentaire décalerait la
 * file des réponses mockées par ordre d'appel, d'où cette file explicite qui
 * ne concerne que les AUTRES requêtes. Les mocks deviennent ainsi
 * indépendants du nombre d'appels que fait la page.
 */
const MOYENS_PAR_DEFAUT = ["PAYDUNYA", "BANK_TRANSFER"];
const fileGet: { ok: boolean; valeur: unknown }[] = [];

function queueGet(reponse: unknown) {
  fileGet.push({ ok: true, valeur: reponse });
}

function queueGetError(erreur: unknown) {
  fileGet.push({ ok: false, valeur: erreur });
}

function installerGet(moyens: string[] = MOYENS_PAR_DEFAUT) {
  mockedApi.get.mockImplementation((url: string) => {
    if (String(url).startsWith("/payments/methods")) {
      return Promise.resolve({ data: { currency: "EUR", methods: moyens } }) as never;
    }
    const suivant = fileGet.shift();
    if (!suivant) {
      // La file s'epuise des que la page recharge plus de fois que le test n'a
      // prevu de reponses -- ce qui arrive normalement : changement de devise,
      // rechargements apres un retour de paiement. Renvoyer `undefined`
      // injectait une valeur impossible dans l'etat du composant, et
      // l'exception remontait APRES la fin du test : les tests passaient, mais
      // vitest sortait en erreur et la CI echouait. On renvoie donc une
      // reponse vide mais valide, conforme a la forme attendue par l'appelant.
      if (String(url).startsWith("/subscription/status")) {
        return Promise.resolve({ data: { history: [] } }) as never;
      }
      return Promise.resolve({ data: [] }) as never;
    }
    return (suivant.ok ? Promise.resolve(suivant.valeur) : Promise.reject(suivant.valeur)) as never;
  });
}

describe("SubscriptionPage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    fileGet.length = 0;
    mockedApi.get.mockReset();
    installerGet();
    mockedApi.post.mockReset();
    mockedIsNativePlatform.mockReturnValue(false);
  });

  it("annonce le retour d'un paiement et nettoie l'URL", async () => {
    // Stripe et PayDunya ramènent le payeur avec ?stripe=succes. Personne ne
    // lisait ce paramètre : le client revenait sans message, son abonnement
    // pas encore confirmé (le webhook arrive en parallèle), et pouvait croire
    // à un échec puis payer une seconde fois.
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    window.history.replaceState({}, "", "/subscription?stripe=succes");

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/confirmation arrive dans quelques instants/i)).toBeInTheDocument()
    );

    // Le paramètre disparaît : un rafraîchissement ne doit pas ré-annoncer un
    // paiement déjà traité.
    expect(window.location.search).not.toContain("stripe");
  });

  it("distingue un paiement annulé d'un paiement transmis", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    window.history.replaceState({}, "", "/subscription?stripe=annule");

    renderPage();

    await waitFor(() => expect(screen.getByText(/Aucun montant n'a été débité/i)).toBeInTheDocument());
    expect(screen.queryByText(/confirmation arrive dans quelques instants/i)).not.toBeInTheDocument();
  });

  it("recharge les données après le retour, pour laisser au webhook le temps d'arriver", async () => {
    // Un seul rechargement immédiat devancerait presque toujours la
    // confirmation et afficherait un état périmé.
    vi.useFakeTimers();
    try {
      seedUser(authUser());
      installerGet();
      mockedApi.get.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).startsWith("/payments/methods")
            ? { data: { currency: "EUR", methods: MOYENS_PAR_DEFAUT } }
            : String(url).startsWith("/subscription/plans")
              ? { data: [plan({ id: "STARTER" })] }
              : { data: { history: [] } }
        ) as never
      );
      window.history.replaceState({}, "", "/subscription?stripe=succes");

      renderPage();
      await vi.advanceTimersByTimeAsync(50);
      const avant = mockedApi.get.mock.calls.filter((appel) =>
        String(appel[0]).startsWith("/subscription/plans")
      ).length;

      await vi.advanceTimersByTimeAsync(11000);
      const apres = mockedApi.get.mock.calls.filter((appel) =>
        String(appel[0]).startsWith("/subscription/plans")
      ).length;

      expect(apres).toBeGreaterThan(avant);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ne propose que les moyens de paiement renvoyés par le serveur", async () => {
    // Le symptôme observé en production : PayDunya était affiché en dur, le
    // serveur le refusait (clés absentes), et le message d'erreur invitait à
    // « choisir un autre » moyen — alors que c'était le seul proposé. La liste
    // vient désormais du serveur, qui seul connaît les clés configurées et la
    // devise du compte encaisseur.
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    // Le serveur n'annonce que le virement : aucune clé PayDunya configurée.
    installerGet(["BANK_TRANSFER"]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    await waitFor(() => expect(screen.getByRole("radio", { name: /Virement bancaire/ })).toBeInTheDocument());
    expect(screen.queryByRole("radio", { name: /PayDunya/ })).not.toBeInTheDocument();
  });

  it("demande les tarifs dans la devise du gestionnaire et n'affiche jamais un symbole figé", async () => {
    // Les prix étaient rendus par `{price} €` et par des libellés i18n
    // contenant « € » : un gestionnaire réglant en FCFA voyait donc « 29 € »
    // pour un montant que le backend allait facturer en francs CFA. Le
    // symbole vient maintenant de la devise renvoyée avec le tarif.
    localStorage.removeItem("app_currency");
    seedUser(authUser({ currency: "XOF" }));
    mockedApi.get.mockImplementation((url: string) => {
      if (String(url).startsWith("/payments/methods")) {
        return Promise.resolve({ data: { currency: "XOF", methods: MOYENS_PAR_DEFAUT } }) as never;
      }
      return Promise.resolve(
        String(url).startsWith("/subscription/plans")
          ? { data: [plan({ id: "PRO", name: "Pro", monthlyPrice: 15000, annualPrice: 144000, currency: "XOF" })] }
          : { data: { history: [] } }
      ) as never;
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Pro")).toBeInTheDocument());

    // La devise voyage jusqu'à la requête : sans cela le backend tarifierait en euros.
    const urls = mockedApi.get.mock.calls.map((appel) => String(appel[0]));
    expect(urls.some((url) => url.includes("/subscription/plans") && url.includes("currency=XOF"))).toBe(true);

    // Et le montant est rendu dans cette devise, sans euro nulle part.
    expect(screen.getByText((texte) => texte.includes("FCFA"))).toBeInTheDocument();
    expect(screen.queryByText((texte) => texte.includes("€"))).not.toBeInTheDocument();
  });

  it("affiche le statut d'essai et les formules disponibles", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro", monthlyPrice: 39 })] });
    queueGet({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Essai : 7 j restant(s)")).toBeInTheDocument());
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("19 €")).toBeInTheDocument();
    expect(screen.getByText("39 €")).toBeInTheDocument();
  });

  it("désactive le bouton de la formule déjà active", async () => {
    seedUser(authUser({ subscription: subscription({ status: "ACTIVE", plan: "PRO", isTrialActive: false, isSubscriptionActive: true, subscriptionEndsAt: "2026-10-01T00:00:00.000Z" }) }));
    queueGet({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro", monthlyPrice: 39 })] });
    queueGet({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Formule PRO Active")).toBeInTheDocument());
    const currentPlanBtn = screen.getByRole("button", { name: "Votre formule actuelle" });
    expect(currentPlanBtn).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choisir Starter" })).not.toBeDisabled();
  });

  it("le basculement facturation annuelle change le prix affiché", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER", monthlyPrice: 19, annualPrice: 180 })] });
    queueGet({ data: { history: [] } });

    renderPage();
    await waitFor(() => expect(screen.getByText("19 €")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Facturation Annuelle/ }));

    await waitFor(() => expect(screen.getByText("15 €")).toBeInTheDocument()); // 180 / 12 arrondi
    expect(screen.getByText("(facturé 180 € / an)")).toBeInTheDocument();
  });

  it("n'expose plus le mode démo comme moyen de paiement", async () => {
    // Régression : « Mode démo » activait un abonnement payant complet,
    // instantanément et sans contrepartie — un bouton « contourner
    // l'abonnement » offert à tout gestionnaire dont l'essai venait d'expirer.
    // Le serveur le refuse désormais (voir payment.service.ts) ; il ne doit
    // pas non plus réapparaître ici.
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    expect(screen.queryByRole("radio", { name: /Mode démo/ })).not.toBeInTheDocument();
    // Les moyens légitimes restent proposés.
    expect(screen.getByRole("radio", { name: /PayDunya/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Virement bancaire/ })).toBeInTheDocument();
  });

  it("souscription : envoie la requête, affiche la confirmation et recharge", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    mockedApi.post.mockResolvedValueOnce({ data: { message: "Abonnement activé avec succès !" } });
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));
    // PAYDUNYA est sélectionné par défaut : aucun clic supplémentaire requis.
    await user.click(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/subscription/subscribe", {
        plan: "STARTER",
        billingCycle: "MONTHLY",
        paymentMethod: "PAYDUNYA",
        bankReference: undefined,
      })
    );
    await waitFor(() => expect(screen.getByText("Abonnement activé avec succès !")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Confirmer et Activer l'Abonnement" })).not.toBeInTheDocument();
  });

  it("virement bancaire : transmet la référence saisie", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    mockedApi.post.mockResolvedValueOnce({ data: { message: "Virement déclaré, en attente de validation." } });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    await user.click(screen.getByRole("radio", { name: /Virement bancaire/ }));
    await user.type(screen.getByPlaceholderText("Ex: VIR-2026-08-01"), "VIR-2026-09-01");
    await user.click(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/subscription/subscribe", {
        plan: "STARTER",
        billingCycle: "MONTHLY",
        paymentMethod: "BANK_TRANSFER",
        bankReference: "VIR-2026-09-01",
      })
    );
  });

  it("redirige vers l'URL PayDunya quand le paiement nécessite une action", async () => {
    const user = userEvent.setup();
    let hrefSet = "";
    Object.defineProperty(window, "location", {
      value: {
        ...window.location,
        get href() {
          return hrefSet;
        },
        set href(v: string) {
          hrefSet = v;
        },
      },
      writable: true,
    });

    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    mockedApi.post.mockResolvedValueOnce({
      data: { payment: { method: "PAYDUNYA", status: "REQUIRES_ACTION", redirectUrl: "https://paydunya.example/checkout" } },
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    await user.click(screen.getByRole("radio", { name: /PayDunya/ }));
    await user.click(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" }));

    await waitFor(() => expect(hrefSet).toBe("https://paydunya.example/checkout"));
  });

  it("affiche l'historique des paiements d'abonnement quand il existe", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({
      data: {
        history: [
          {
            id: "h1",
            plan: "STARTER",
            amount: 19,
            billingCycle: "MONTHLY",
            status: "PAID",
            paymentMethod: "DEMO",
            paymentRef: "ref-1",
            startDate: "2026-08-01T00:00:00.000Z",
            endDate: "2026-09-01T00:00:00.000Z",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Historique de vos factures d'abonnement")).toBeInTheDocument());
    const table = screen.getByRole("table");
    expect(within(table).getByText("19 €")).toBeInTheDocument();
    expect(within(table).getByText("PAID")).toBeInTheDocument();
  });

  it("affiche une erreur si le chargement des formules échoue", async () => {
    seedUser(authUser());
    queueGetError({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });

  it("sur mobile natif (Capacitor), masque la grille de plans et affiche le message de repli", async () => {
    mockedIsNativePlatform.mockReturnValue(true);
    seedUser(authUser()); // TRIAL par défaut, donc pas encore "ACTIVE"
    queueGet({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro" })] });
    queueGet({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Essai : 7 j restant(s)")).toBeInTheDocument());
    expect(screen.queryByText("Starter")).not.toBeInTheDocument();
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Choisir/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Pour souscrire ou changer d'offre, connectez-vous depuis le site web/)
    ).toBeInTheDocument();
  });

  it("sur mobile natif (Capacitor) avec un abonnement déjà actif, n'affiche ni grille ni message de repli", async () => {
    mockedIsNativePlatform.mockReturnValue(true);
    seedUser(
      authUser({
        subscription: subscription({ status: "ACTIVE", plan: "PRO", isTrialActive: false, isSubscriptionActive: true, subscriptionEndsAt: "2026-10-01T00:00:00.000Z" }),
      })
    );
    queueGet({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro" })] });
    queueGet({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Formule PRO Active")).toBeInTheDocument());
    expect(screen.queryByText("Starter")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Pour souscrire ou changer d'offre, connectez-vous depuis le site web/)
    ).not.toBeInTheDocument();
  });
});
