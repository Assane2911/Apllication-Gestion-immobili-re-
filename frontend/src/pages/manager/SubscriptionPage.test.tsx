import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { AuthUser, SubscriptionInfo, SubscriptionPlanDetail } from "../../types";
import { changerLangue } from "../../i18n";
import SubscriptionPage from "./SubscriptionPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

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
const MOYENS_PAR_DEFAUT = ["PAYDUNYA", "STRIPE"];
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
  });

  it("porte l'unique titre de niveau 1 de la page : le menu de l'espace n'en pose plus, le titre est celui de la page", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });

    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Abonnement & Formules SaaS" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
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
    // Le serveur n'annonce que la carte : aucune clé PayDunya configurée.
    installerGet(["STRIPE"]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    await waitFor(() => expect(screen.getByRole("radio", { name: /Carte bancaire/ })).toBeInTheDocument());
    expect(screen.queryByRole("radio", { name: /PayDunya/ })).not.toBeInTheDocument();
  });

  // Plus de virement : sans Stripe dans la devise d'affichage (euro et franc CFA seulement), aucun moyen n'est proposé. L'écran le dit
  // et bloque la confirmation, au lieu d'ouvrir une fenêtre muette.
  it("aucun moyen de règlement dans la devise d'affichage : message clair, confirmation bloquée, aucune coordonnée bancaire", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    installerGet([]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Aucun moyen de règlement n'est disponible dans votre devise d'affichage (EUR)");
    expect(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" })).toBeDisabled();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/IBAN|virement/i)).not.toBeInTheDocument();
    expect(mockedApi.get.mock.calls.some((appel) => String(appel[0]).includes("bank-details"))).toBe(false);
  });

  // Tant que le compte marchand PayDunya n'est pas approuvé, le serveur ne le propose pas : une agence de la zone franc CFA doit le
  // voir annoncé « bientôt disponible » — sans pouvoir le choisir.
  describe("mobile money bientôt disponible", () => {
    async function ouvrirLePaiement(devise: string, moyens: string[], pays?: string) {
      const user = userEvent.setup();
      localStorage.removeItem("app_currency");
      seedUser(authUser({ currency: devise, ...(pays ? { country: pays } : {}) }));
      queueGet({ data: [plan({ id: "STARTER" })] });
      queueGet({ data: { history: [] } });
      installerGet(moyens);
      renderPage();
      await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Choisir Starter" }));
      await waitFor(() => expect(screen.getByRole("radio", { name: /Carte bancaire/ })).toBeInTheDocument());
    }

    it("une agence en FCFA voit l'annonce, qui n'est pas un choix possible", async () => {
      await ouvrirLePaiement("XOF", ["STRIPE"]);

      const annonce = screen.getByTestId("mobile-money-bientot");
      expect(annonce).toHaveTextContent("Mobile money (Wave, Orange Money, MTN…)");
      expect(annonce).toHaveTextContent("Bientôt disponible");
      expect(annonce).toHaveTextContent("est en cours d'approbation");
      expect(screen.queryByRole("radio", { name: /Mobile money/ })).not.toBeInTheDocument();
    });

    it("une agence d'un pays de la zone franc CFA l'a aussi, même avec un affichage en euros", async () => {
      await ouvrirLePaiement("EUR", ["STRIPE"], "SN");

      expect(screen.getByTestId("mobile-money-bientot")).toBeInTheDocument();
    });

    it("une agence en euros (France) ne la voit pas", async () => {
      await ouvrirLePaiement("EUR", ["STRIPE"], "FR");

      expect(screen.queryByTestId("mobile-money-bientot")).not.toBeInTheDocument();
    });

    it("dès que PayDunya est actif côté serveur, il devient un vrai choix et l'annonce disparaît", async () => {
      await ouvrirLePaiement("XOF", ["PAYDUNYA", "STRIPE"]);

      expect(screen.getByRole("radio", { name: /PayDunya/ })).toBeInTheDocument();
      expect(screen.queryByTestId("mobile-money-bientot")).not.toBeInTheDocument();
    });
  });

  // L'abonnement est la seule chose que Stripe et PayDunya encaissent : l'écran le dit au serveur.
  it("demande les moyens de paiement d'un ABONNEMENT", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    installerGet();

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    await waitFor(() =>
      expect(mockedApi.get.mock.calls.some((appel) => String(appel[0]).includes("/payments/methods") && String(appel[0]).includes("usage=abonnement"))).toBe(true)
    );
    expect(mockedApi.get.mock.calls.some((appel) => String(appel[0]).includes("usage=loyer"))).toBe(false);
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

    await waitFor(() => expect(screen.getByText("Professionnel")).toBeInTheDocument());

    // La devise voyage jusqu'à la requête : sans cela le backend tarifierait en euros.
    const urls = mockedApi.get.mock.calls.map((appel) => String(appel[0]));
    expect(urls.some((url) => url.includes("/subscription/plans") && url.includes("currency=XOF"))).toBe(true);

    // Et le montant est rendu dans cette devise, sans euro nulle part.
    expect(screen.getByText((texte) => texte.includes("FCFA"))).toBeInTheDocument();
    expect(screen.queryByText((texte) => texte.includes("€"))).not.toBeInTheDocument();
  });

  it("calcule le badge de remise annuelle depuis les tarifs reçus, jamais figé à -20%", async () => {
    // Le badge affichait "-20%" en dur : un futur changement de TARIFS
    // (backend) aurait pu changer la remise réelle sans que rien côté
    // interface ne le reflète. Ici le tarif annuel ne respecte volontairement
    // PAS 20 % (25 % de remise) pour prouver que le badge est recalculé
    // depuis les prix reçus, pas simplement recopié.
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER", monthlyPrice: 20, annualPrice: 180 })] }); // 12×20×0,75 = 180 → -25 %
    queueGet({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeInTheDocument());
    expect(screen.getByText("-25%")).toBeInTheDocument();
    expect(screen.queryByText("-20%")).not.toBeInTheDocument();
  });

  it("prévient le gestionnaire quand sa devise d'affichage n'est pas tarifée pour les abonnements", async () => {
    // Les 12 devises du sélecteur sont désormais toutes tarifées, et
    // updateCurrency valide lui aussi via deviseSchema depuis le 24 sept.
    // (auth.controller.ts) : une devise comme le yen ne peut donc plus être
    // posée via l'API normale. Le cas réel restant est une valeur héritée
    // d'avant cette validation, ou posée directement en base — le serveur
    // retombe alors sur EUR. Sans ce message, le gestionnaire concerné
    // croirait à un bug d'affichage plutôt qu'à un repli de sécurité.
    localStorage.removeItem("app_currency");
    seedUser(authUser({ currency: "JPY" }));
    mockedApi.get.mockImplementation((url: string) => {
      if (String(url).startsWith("/payments/methods")) {
        return Promise.resolve({ data: { currency: "EUR", methods: MOYENS_PAR_DEFAUT } }) as never;
      }
      return Promise.resolve(
        String(url).startsWith("/subscription/plans")
          ? { data: [plan({ id: "STARTER", currency: "EUR" })] }
          : { data: { history: [] } }
      ) as never;
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeInTheDocument());
    expect(
      screen.getByText(/ne sont pas encore facturés dans votre devise d'affichage/)
    ).toBeInTheDocument();
  });

  it("n'affiche aucun avertissement de devise quand le tarif reçu correspond à la devise d'affichage choisie", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeInTheDocument());
    expect(screen.queryByText(/pas encore facturés dans votre devise/)).not.toBeInTheDocument();
  });

  it("affiche les tarifs en franc CFA (XOF) d'une agence de l'UEMOA, sans avertissement de repli", async () => {
    // Le franc CFA fait partie des devises tarifées : le serveur répond donc en XOF, et le gestionnaire ne doit voir ni
    // un prix en euros ni le message de repli.
    localStorage.removeItem("app_currency");
    seedUser(authUser({ currency: "XOF" }));
    mockedApi.get.mockImplementation((url: string) => {
      if (String(url).startsWith("/payments/methods")) {
        return Promise.resolve({ data: { currency: "XOF", methods: ["STRIPE"] } }) as never;
      }
      return Promise.resolve(
        String(url).startsWith("/subscription/plans")
          ? { data: [plan({ id: "PRO", name: "Pro", monthlyPrice: 15000, annualPrice: 144000, currency: "XOF" })] }
          : { data: { history: [] } }
      ) as never;
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Professionnel")).toBeInTheDocument());

    // La devise voyage jusqu'à la requête, et le prix revient en francs CFA.
    const urls = mockedApi.get.mock.calls.map((appel) => String(appel[0]));
    expect(urls.some((url) => url.includes("/subscription/plans") && url.includes("currency=XOF"))).toBe(true);
    expect(screen.getAllByText((texte) => texte.includes("FCFA")).length).toBeGreaterThan(0);
    expect(screen.queryByText((texte) => texte.includes("€"))).not.toBeInTheDocument();
    expect(screen.queryByText(/pas encore facturés dans votre devise/)).not.toBeInTheDocument();
  });

  it("avertit le gestionnaire quand il dépasse le plafond de biens de sa formule", async () => {
    // Le plafond n'est vérifié qu'à la création d'un bien : un gestionnaire
    // redescendu de PRO à STARTER garde ses 25 biens et continue de les
    // exploiter. On ne lui retire rien — ses locataires sont réels — mais il
    // doit le savoir, et depuis l'écran où il peut corriger.
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [], propertyUsage: { count: 25, max: 5, exceeded: true } } });

    renderPage();

    await waitFor(() => expect(screen.getByText(/Vous gérez 25 biens/)).toBeInTheDocument());
  });

  it("n'affiche aucun avertissement de plafond quand la formule couvre les biens gérés", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [], propertyUsage: { count: 3, max: 5, exceeded: false } } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Starter")).toBeInTheDocument());
    expect(screen.queryByText(/Vous gérez/)).not.toBeInTheDocument();
  });

  it("annonce la fin de l'essai avec la date ET l'heure", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });

    renderPage();

    // « Votre période d'essai se termine le 20 septembre 2026 à 02:00. » (l'heure suit le fuseau de l'appareil)
    expect(await screen.findByText(/Votre période d'essai se termine le .*\d{4} à \d{2}:\d{2}\./)).toBeInTheDocument();
  });

  it("affiche le statut d'essai et les formules disponibles", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro", monthlyPrice: 39 })] });
    queueGet({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Essai : 7 j restants")).toBeInTheDocument());
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Professionnel")).toBeInTheDocument();
    expect(screen.getByText("19 €")).toBeInTheDocument();
    expect(screen.getByText("39 €")).toBeInTheDocument();
  });

  describe("lignes des formules traduites", () => {
    const formulesAvecCles = () => [
      plan({ id: "STARTER", features: ["Jusqu'à 5 biens immobiliers"], featureKeys: ["maxProperties5"] }),
      plan({
        id: "PRO",
        name: "Professionnel",
        features: ["Tout ce qui est inclus dans Starter", "Jusqu'à 25 biens immobiliers"],
        featureKeys: ["includesStarter", "maxProperties25"],
      }),
    ];

    it("affiche les lignes en français, la formule reprise portant son nom", async () => {
      seedUser(authUser());
      queueGet({ data: formulesAvecCles() });
      queueGet({ data: { history: [] } });

      renderPage();

      await waitFor(() => expect(screen.getByText("Tout ce qui est inclus dans Starter")).toBeInTheDocument());
      expect(screen.getByText("Jusqu'à 25 biens immobiliers")).toBeInTheDocument();
    });

    it("affiche les lignes dans la langue de l'interface plutôt qu'en français pour tout le monde", async () => {
      await changerLangue("en");
      try {
        seedUser(authUser());
        queueGet({ data: formulesAvecCles() });
        queueGet({ data: { history: [] } });

        renderPage();

        await waitFor(() => expect(screen.getByText("Everything included in Starter")).toBeInTheDocument());
        expect(screen.getByText("Up to 25 properties")).toBeInTheDocument();
        expect(screen.getByText("Professional")).toBeInTheDocument();
        expect(screen.queryByText("Jusqu'à 25 biens immobiliers")).not.toBeInTheDocument();
      } finally {
        await changerLangue("fr");
      }
    });

    it("garde le texte du serveur pour une ligne sans clé (serveur plus ancien)", async () => {
      seedUser(authUser());
      queueGet({ data: [plan({ id: "STARTER", features: ["Ligne sans clé"] })] });
      queueGet({ data: { history: [] } });

      renderPage();

      await waitFor(() => expect(screen.getByText("Ligne sans clé")).toBeInTheDocument());
    });
  });

  it("désactive le bouton de la formule déjà active", async () => {
    seedUser(authUser({ subscription: subscription({ status: "ACTIVE", plan: "PRO", isTrialActive: false, isSubscriptionActive: true, subscriptionEndsAt: "2026-10-01T00:00:00.000Z" }) }));
    queueGet({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro", monthlyPrice: 39 })] });
    queueGet({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Formule Professionnel Active")).toBeInTheDocument());
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
    expect(screen.getByRole("radio", { name: /Carte bancaire/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Virement/ })).not.toBeInTheDocument();
  });

  it("souscription : envoie la requête, affiche la confirmation et recharge", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, message: "Texte du serveur, ignoré." } });
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
      })
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Votre abonnement à la formule Starter a été activé avec succès !"));
    expect(screen.queryByRole("button", { name: "Confirmer et Activer l'Abonnement" })).not.toBeInTheDocument();
  });

  it("souscription : affiche l'erreur du serveur et réactive le bouton si la requête échoue", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: "Moyen de paiement indisponible pour le moment." } },
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));
    await user.click(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" }));

    await waitFor(() =>
      expect(screen.getByText("Moyen de paiement indisponible pour le moment.")).toBeInTheDocument()
    );
    // Le bouton doit rester disponible pour une nouvelle tentative.
    expect(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" })).not.toBeDisabled();
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
            currency: "EUR",
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
    // Le statut et le moyen de paiement s'affichent traduits, pas en codes techniques.
    expect(within(table).getByText("Réglé")).toBeInTheDocument();
    expect(within(table).getByText("Démo")).toBeInTheDocument();
    expect(within(table).queryByText("PAID")).not.toBeInTheDocument();
  });

  /**
   * Régression (vue sur l'écran) : cinq virements déclarés, tous « en attente », s'affichaient « 5 paiements, 105 000 FCFA
   * réglés, dernier paiement aujourd'hui ». Rien n'avait été reçu : seuls les paiements validés comptent.
   */
  it("ne compte pas comme réglés les virements en attente de validation", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    const virement = (id: string) => ({
      id,
      plan: "STARTER",
      amount: 25000,
      currency: "XOF",
      billingCycle: "MONTHLY",
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentRef: `ref-${id}`,
      startDate: "2026-11-12T00:00:00.000Z",
      endDate: "2026-12-12T00:00:00.000Z",
      createdAt: "2026-11-12T00:00:00.000Z",
    });
    queueGet({ data: { history: [virement("h1"), virement("h2"), virement("h3")] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Historique de vos factures d'abonnement")).toBeInTheDocument());
    const synthese = screen.getByLabelText("Synthèse des paiements");
    const valeurDe = (libelle: string) => within(synthese).getByText(libelle).parentElement!.querySelector("dd")!.textContent;
    expect(valeurDe("Paiements")).toBe("0");
    expect(valeurDe("Total réglé")).toMatch(/^0\s?F/);
    expect(valeurDe("Dernier paiement")).toBe("—");
    expect(valeurDe("En attente")).toBe("3");
    expect(within(screen.getByRole("table")).getAllByText("En attente de validation")).toHaveLength(3);
    expect(within(screen.getByRole("table")).getAllByText("Virement")).toHaveLength(3);
  });

  it("affiche chaque ligne d'historique dans SA PROPRE devise, jamais en euros par défaut", async () => {
    // Régression : cette ligne réglée en FCFA (paiement PayDunya typique d'un
    // gestionnaire en zone UEMOA) ne doit jamais s'afficher "15000 €" — même
    // bug que celui déjà corrigé sur AdminSubscriptionsPage (voir le
    // commentaire sur platformSubscriptions.currency côté schéma backend).
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({
      data: {
        history: [
          {
            id: "h-xof",
            plan: "STARTER",
            amount: 15000,
            currency: "XOF",
            billingCycle: "MONTHLY",
            status: "PAID",
            paymentMethod: "PAYDUNYA",
            paymentRef: "ref-xof",
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
    expect(within(table).getByText(/FCFA/)).toBeInTheDocument();
    expect(within(table).queryByText(/€/)).not.toBeInTheDocument();
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

  /**
   * Renouvellement automatique réel (Stripe Subscriptions) : réservé au
   * paiement par carte via Stripe (CGU §4) — la case à cocher ne doit donc
   * apparaître que pour ce moyen de paiement, et sa valeur doit voyager dans
   * la requête de souscription.
   */
  it("propose le renouvellement automatique uniquement pour le paiement par carte (Stripe)", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    installerGet(["STRIPE", "DEMO"]);
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    // Stripe est le premier moyen renvoyé par le serveur, donc présélectionné :
    // la case est déjà visible sans clic supplémentaire.
    await waitFor(() => expect(screen.getByLabelText(/Activer le renouvellement automatique/)).toBeInTheDocument());

    await user.click(screen.getByRole("radio", { name: /Mode démo/ }));
    expect(screen.queryByLabelText(/renouvellement automatique/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Carte bancaire/ }));
    expect(screen.getByLabelText(/Activer le renouvellement automatique/)).toBeInTheDocument();
  });

  it("envoie autoRenew: true quand la case est cochée pour un paiement Stripe", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    installerGet(["STRIPE"]);
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [] } });
    mockedApi.post.mockResolvedValueOnce({
      data: { payment: { method: "STRIPE", status: "REQUIRES_ACTION", redirectUrl: "https://checkout.stripe.test/abc" } },
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));
    await waitFor(() => expect(screen.getByLabelText(/Activer le renouvellement automatique/)).toBeInTheDocument());

    await user.click(screen.getByLabelText(/Activer le renouvellement automatique/));
    await user.click(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/subscription/subscribe", {
        plan: "STARTER",
        billingCycle: "MONTHLY",
        paymentMethod: "STRIPE",
        autoRenew: true,
      })
    );
  });

  /**
   * Régression : le backend expose bien POST /subscription/cancel depuis la
   * migration multi-utilisateurs, mais aucun bouton ne l'appelait nulle part
   * dans l'interface — un gestionnaire ne pouvait résilier qu'en appelant
   * l'API directement, alors que les CGU (§7) promettent une résiliation
   * "à tout moment depuis son espace de gestion".
   */
  describe("résiliation de l'abonnement", () => {
    it("propose la résiliation pour un abonnement payant actif, et affiche la confirmation renvoyée par le serveur", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      seedUser(
        authUser({
          subscription: subscription({
            status: "ACTIVE",
            plan: "PRO",
            isTrialActive: false,
            isSubscriptionActive: true,
            subscriptionEndsAt: "2026-10-01T00:00:00.000Z",
          }),
        })
      );
      queueGet({ data: [plan({ id: "STARTER" })] });
      queueGet({ data: { history: [] } });
      mockedApi.post.mockResolvedValueOnce({
        data: {
          success: true,
          message: "Texte du serveur, ignoré.",
          autoRenewCancelled: true,
          subscription: subscription({ status: "CANCELLED" }),
        },
      });
      queueGet({ data: [plan({ id: "STARTER" })] });
      queueGet({ data: { history: [] } });

      renderPage();
      await waitFor(() => expect(screen.getByText("Formule Professionnel Active")).toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Résilier mon abonnement" }));

      expect(mockedApi.post).toHaveBeenCalledWith("/subscription/cancel");
      await waitFor(() =>
        expect(screen.getByText("Le renouvellement automatique de votre abonnement a été annulé. Votre accès reste actif jusqu'au terme de la période déjà payée.")).toBeInTheDocument()
      );
    });

    it("sans renouvellement automatique : annonce que l'abonnement ne sera pas reconduit, dans la langue de l'interface", async () => {
      const user = userEvent.setup();
      await changerLangue("en");
      try {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        seedUser(
          authUser({
            subscription: subscription({
              status: "ACTIVE",
              plan: "PRO",
              isTrialActive: false,
              isSubscriptionActive: true,
              subscriptionEndsAt: "2026-10-01T00:00:00.000Z",
            }),
          })
        );
        queueGet({ data: [plan({ id: "STARTER" })] });
        queueGet({ data: { history: [] } });
        mockedApi.post.mockResolvedValueOnce({
          data: { success: true, message: "Texte du serveur en français, ignoré.", autoRenewCancelled: false, subscription: subscription({ status: "CANCELLED" }) },
        });
        queueGet({ data: [plan({ id: "STARTER" })] });
        queueGet({ data: { history: [] } });

        renderPage();
        await user.click(await screen.findByRole("button", { name: /Cancel my subscription/i }));

        await waitFor(() =>
          expect(screen.getByText("Your subscription will not be renewed. Your access stays active until the end of the period already paid.")).toBeInTheDocument()
        );
      } finally {
        await changerLangue("fr");
      }
    });

    it("pour un accès illimité : l'annonce, sans proposer de résilier ni de choisir une formule", async () => {
      seedUser(
        authUser({
          subscription: subscription({
            status: "ACTIVE",
            plan: "ENTERPRISE",
            isTrialActive: false,
            isSubscriptionActive: true,
            subscriptionEndsAt: null,
          }),
        })
      );
      queueGet({ data: [plan({ id: "STARTER" })] });
      queueGet({ data: { history: [] } });

      renderPage();

      expect(await screen.findByText("Accès illimité")).toBeInTheDocument();
      expect(screen.getByText(/aucune échéance/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Résilier mon abonnement" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Choisissez une formule ci-dessous/)).not.toBeInTheDocument();
    });

    it("affiche l'erreur du serveur et réactive le bouton si la résiliation échoue", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      seedUser(
        authUser({
          subscription: subscription({
            status: "ACTIVE",
            plan: "PRO",
            isTrialActive: false,
            isSubscriptionActive: true,
            subscriptionEndsAt: "2026-10-01T00:00:00.000Z",
          }),
        })
      );
      queueGet({ data: [plan({ id: "STARTER" })] });
      queueGet({ data: { history: [] } });
      mockedApi.post.mockRejectedValueOnce({
        isAxiosError: true,
        response: { data: { error: "Impossible de contacter Stripe pour le moment." } },
      });

      renderPage();
      await waitFor(() => expect(screen.getByText("Formule Professionnel Active")).toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Résilier mon abonnement" }));

      await waitFor(() =>
        expect(screen.getByText("Impossible de contacter Stripe pour le moment.")).toBeInTheDocument()
      );
      expect(screen.getByRole("button", { name: "Résilier mon abonnement" })).not.toBeDisabled();
    });

    it("ne résilie rien si le gestionnaire annule la confirmation", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(false);
      seedUser(
        authUser({
          subscription: subscription({ status: "ACTIVE", plan: "PRO", isTrialActive: false, isSubscriptionActive: true, subscriptionEndsAt: "2026-10-01T00:00:00.000Z" }),
        })
      );
      queueGet({ data: [plan({ id: "STARTER" })] });
      queueGet({ data: { history: [] } });

      renderPage();
      await waitFor(() => expect(screen.getByText("Formule Professionnel Active")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Résilier mon abonnement" }));

      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("ne propose pas de résiliation pendant l'essai gratuit ou un abonnement déjà expiré", async () => {
      seedUser(authUser()); // TRIAL par défaut
      queueGet({ data: [plan({ id: "STARTER" })] });
      queueGet({ data: { history: [] } });

      renderPage();
      await waitFor(() => expect(screen.getByText("Essai : 7 j restants")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Résilier mon abonnement" })).not.toBeInTheDocument();
    });
  });
});

describe("SubscriptionPage — historique, économie annuelle et formule suivante", () => {
  const paiement = (o: Record<string, unknown> = {}) => ({
    id: "h1", plan: "STARTER", amount: 19, currency: "EUR", billingCycle: "MONTHLY", status: "PAID", paymentMethod: "DEMO", paymentRef: "ref-1",
    startDate: "2026-08-01T00:00:00.000Z", endDate: "2026-09-01T00:00:00.000Z", createdAt: "2026-08-01T00:00:00.000Z", ...o,
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    fileGet.length = 0;
    mockedApi.get.mockReset();
    installerGet();
    mockedApi.post.mockReset();
  });

  it("résume les paiements : nombre, total par devise, dernier paiement", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [paiement(), paiement({ id: "h2", amount: 38, createdAt: "2026-09-01T00:00:00.000Z" })] } });
    renderPage();

    const synthese = await screen.findByLabelText("Synthèse des paiements");
    const valeur = (libelle: string) => within(synthese).getByText(libelle).nextElementSibling;
    expect(valeur("Paiements")).toHaveTextContent("2");
    expect(valeur("Total réglé")).toHaveTextContent("57 €");
    expect(valeur("Dernier paiement")).toHaveTextContent(new Date("2026-09-01T00:00:00.000Z").toLocaleDateString("fr"));
  });

  it("ne mélange pas deux devises dans le total", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [paiement(), paiement({ id: "h2", amount: 12000, currency: "XOF" })] } });
    renderPage();

    const synthese = await screen.findByLabelText("Synthèse des paiements");
    expect(within(synthese).getByText("Total réglé (EUR)")).toBeInTheDocument();
    expect(within(synthese).getByText("Total réglé (XOF)")).toBeInTheDocument();
  });

  it("exporte l'historique en CSV", async () => {
    const user = userEvent.setup();
    let blob: Blob | undefined;
    let nom = "";
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn((b: Blob) => { blob = b; return "blob:x"; }), configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { nom = this.download; });
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER" })] });
    queueGet({ data: { history: [paiement()] } });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Exporter l'historique (CSV)" }));
    const texte = await new Promise<string>((resolve) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(String(lecteur.result));
      lecteur.readAsText(blob as Blob);
    });
    clic.mockRestore();
    expect(nom).toMatch(/^abonnement-historique-\d{4}-\d{2}-\d{2}\.csv$/);
    const lignes = texte.replace("﻿", "").split("\n");
    expect(lignes[0]).toContain('"Montant"');
    expect(lignes[1]).toContain('"19,00";"EUR";"DEMO";"ref-1";"PAID"');
  });

  it("annonce ce que l'annuel fait économiser", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER", monthlyPrice: 19, annualPrice: 182 })] });
    queueGet({ data: { history: [] } });
    renderPage();

    await screen.findByRole("button", { name: /^Choisir/ });
    expect(screen.queryByText(/Vous économisez/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Facturation Annuelle/ }));
    expect(screen.getByText("Vous économisez 46 € par an")).toBeInTheDocument();
  });

  it("propose la formule suivante quand le parc approche du plafond, et l'ouvre en un clic", async () => {
    const user = userEvent.setup();
    seedUser(authUser({ subscription: subscription({ status: "ACTIVE", plan: "STARTER", isTrialActive: false, isSubscriptionActive: true, subscriptionEndsAt: "2027-01-01T00:00:00.000Z" }) }));
    queueGet({ data: [plan({ id: "STARTER", monthlyPrice: 19, maxProperties: 5 }), plan({ id: "PRO", name: "Professionnel", monthlyPrice: 49, annualPrice: 470, maxProperties: 25 })] });
    queueGet({ data: { history: [], propertyUsage: { count: 5, max: 5, exceeded: false } } });
    renderPage();

    expect(await screen.findByText(/Vous utilisez 5 biens sur 5/)).toBeInTheDocument();
    // Le bouton de la proposition précède le tableau des formules, qui a le même libellé sur la carte de la formule.
    const boutons = screen.getAllByRole("button", { name: /^Choisir Professionnel/ });
    expect(boutons).toHaveLength(2);
    await user.click(boutons[0]);
    expect(await screen.findByRole("radiogroup")).toBeInTheDocument();
  });

  it("ne propose rien quand le parc est loin du plafond", async () => {
    seedUser(authUser());
    queueGet({ data: [plan({ id: "STARTER", maxProperties: 5 }), plan({ id: "PRO", name: "Professionnel", monthlyPrice: 49, maxProperties: 25 })] });
    queueGet({ data: { history: [], propertyUsage: { count: 1, max: 5, exceeded: false } } });
    renderPage();

    await screen.findByText("1 / 5");
    expect(screen.queryByText(/vous laisse de la marge/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Choisir Professionnel/ })).toHaveLength(1);
  });
});
