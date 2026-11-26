import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serialiserMentions } from "../utils/mentionsLogement";
import { TEXTES_CRG } from "./document.crg.textes";
import {
  type CrgExportData,
  type FormalNoticeData,
  generateCrgHtml,
  generateFormalNoticeHtml,
  generateFormalNoticePdfBuffer,
  generateInspectionHtml,
  generateLeaseHtml,
  generateReceiptHtml,
  generateRentRevisionHtml,
  generateSettlementHtml,
  generateSettlementPdfBuffer,
  type InspectionExportData,
  type LeaseExportData,
  type ReceiptData,
  type RentRevisionExportData,
  type SettlementData,
  texteMiseEnDemeure,
  texteSolde,
} from "./pdf.service";

/**
 * Contenu des documents à portée juridique (bail, avenant, état des lieux, relevé de gestion, quittance, mise en demeure, solde de
 * tout compte) : ce qui s'imprime selon les champs renseignés ou non. Le fichier principal vérifie l'échappement et la structure ;
 * ici, chaque mention facultative, chaque pluriel, chaque repli — un document qui omet ou invente une ligne engage l'agence.
 */

afterEach(() => vi.restoreAllMocks());

const ESPACES = /[\s  ]/g;
const sansEspaces = (s: string) => s.replace(ESPACES, "");
/** Le PDF écrit des espaces insécables (U+00A0) à la place des espaces fines (U+202F) : on compare à texte égal. */
const lu = (s: string) => s.replace(/[  ]/g, " ");

/* ───────────────────────────── Quittance : période couverte ───────────────────────────── */

const quittance = (invoice: Partial<ReceiptData["invoice"]> = {}): ReceiptData => ({
  receiptNumber: "QUITT-2026-06-A1B2C3",
  agency: { name: "Agence Teranga" },
  tenant: { fullName: "Aminata Ba", email: "a@test.local", phone: "+221770000000" },
  property: { title: "Villa Ngor", address: "3 rue des Almadies", surface: 120 },
  invoice: { periodMonth: 6, periodYear: 2026, amount: 250000, currency: "XOF", paidAt: new Date(2026, 5, 3), paymentMethod: "CASH", paymentRef: null, ...invoice },
});

describe("quittance : période annoncée", () => {
  it("un mois entier (du 1er au dernier jour) annonce le mois seul", () => {
    expect(generateReceiptHtml(quittance({ periodStartDay: 1, periodEndDay: 30 }))).not.toContain("(du ");
    expect(generateReceiptHtml(quittance({ periodStartDay: 1, periodEndDay: 31 }))).not.toContain("(du "); // au-delà du dernier jour : toujours le mois
  });

  it("sans bornes de période (ou une seule), le mois seul", () => {
    expect(generateReceiptHtml(quittance())).not.toContain("(du ");
    expect(generateReceiptHtml(quittance({ periodStartDay: null, periodEndDay: null }))).not.toContain("(du ");
    expect(generateReceiptHtml(quittance({ periodStartDay: 10, periodEndDay: null }))).not.toContain("(du ");
    expect(generateReceiptHtml(quittance({ periodStartDay: null, periodEndDay: 30 }))).not.toContain("(du ");
  });

  it("une période partielle (entrée ou sortie en cours de mois) annonce les jours réellement couverts", () => {
    expect(generateReceiptHtml(quittance({ periodStartDay: 11, periodEndDay: 30 }))).toContain("(du 11 au 30)");
    expect(generateReceiptHtml(quittance({ periodStartDay: 1, periodEndDay: 15 }))).toContain("(du 1 au 15)");
    expect(generateReceiptHtml(quittance({ periodStartDay: 5, periodEndDay: 20 }))).toContain("(du 5 au 20)");
  });

  it("février d'une année bissextile : le 29 est le dernier jour du mois", () => {
    const fev = (fin: number) => generateReceiptHtml(quittance({ periodMonth: 2, periodYear: 2028, periodStartDay: 1, periodEndDay: fin }));

    expect(fev(29)).not.toContain("(du ");
    expect(fev(28)).toContain("(du 1 au 28)");
  });
});

/* ───────────────────────────── Bail ───────────────────────────── */

const bail = (extra: Partial<LeaseExportData> = {}): LeaseExportData => ({
  startDate: "2026-03-01T00:00:00.000Z",
  endDate: "2028-02-28T00:00:00.000Z",
  rent: 250000,
  currency: "XOF",
  deposit: 500000,
  signedByManagerAt: null,
  managerSignatureUrl: null,
  signedByTenantAt: null,
  tenantSignatureUrl: null,
  property: { title: "Villa Ngor", address: "3 rue des Almadies", surface: 120 },
  tenant: { firstName: "Aminata", lastName: "Ba", email: "a@test.local", phone: "+221770000000" },
  ...extra,
});
const agence = { agencyName: "Agence Teranga" };

describe("bail : mentions facultatives", () => {
  it("frais d'agence à la charge du locataire : imprimés seulement s'ils sont strictement positifs", () => {
    expect(generateLeaseHtml(bail({ agencyFee: 50000 }), agence)).toContain("Frais d'agence à la charge du locataire");
    for (const frais of [0, null, undefined, -5]) {
      expect(generateLeaseHtml(bail({ agencyFee: frais as number | null | undefined }), agence)).not.toContain("Frais d'agence");
    }
  });

  it("le montant des frais d'agence est mis en forme dans la devise du bail", () => {
    const html = generateLeaseHtml(bail({ agencyFee: 50000 }), agence);

    expect(sansEspaces(html)).toContain("Fraisd'agenceàlachargedulocataire:</strong>50000FCFA");
  });

  it("mentions du logement : seules celles qui sont renseignées s'impriment, jamais de ligne vide", () => {
    const mentions = serialiserMentions({ dpe: "C", identifiantFiscal: "12345678901", loyerReference: 20, dernierLoyer: 240000 });

    const html = generateLeaseHtml(bail({ housingMentions: mentions }), agence);

    expect(html).toContain("Classe du diagnostic de performance énergétique (DPE) :</strong> C");
    expect(html).toContain("Identifiant fiscal du logement :</strong> 12345678901");
    expect(sansEspaces(html)).toContain("Loyerderéférence(parm²):</strong>20");
    expect(html).toContain("Montant du dernier loyer acquitté par le précédent locataire");
    expect(html).not.toContain("Période de construction");
    expect(html).not.toContain("Chauffage et eau chaude");
    expect(html).not.toContain("Loyer de référence majoré");
  });

  it("chauffage, période de construction et loyer de référence majoré s'impriment aussi quand ils sont renseignés", () => {
    const html = generateLeaseHtml(bail({ housingMentions: serialiserMentions({ chauffage: "Gaz individuel", periodeConstruction: "1990-2005", loyerReferenceMajore: 18 }) }), agence);

    expect(html).toContain("Chauffage et eau chaude :</strong> Gaz individuel");
    expect(html).toContain("Période de construction :</strong> 1990-2005");
    expect(sansEspaces(html)).toContain("Loyerderéférencemajoré(parm²):</strong>18");
  });

  it("un montant à 0 (dernier loyer nul) est imprimé : 0 n'est pas « non renseigné »", () => {
    const html = generateLeaseHtml(bail({ housingMentions: serialiserMentions({ dernierLoyer: 0, dpe: "A" }) }), agence);

    expect(sansEspaces(html)).toContain("précédentlocataire:</strong>0FCFA");
  });

  it("sans mentions, ou avec un JSON illisible ou vide, aucune ligne de mention n'est imprimée", () => {
    for (const housingMentions of [null, undefined, "", "pas du json", "{}"]) {
      const html = generateLeaseHtml(bail({ housingMentions }), agence);
      expect(html).not.toContain("diagnostic de performance énergétique");
      expect(html).not.toContain("Identifiant fiscal");
    }
  });

  it("le montant des loyers de référence est dans la devise du bail", () => {
    const html = generateLeaseHtml(bail({ housingMentions: serialiserMentions({ loyerReference: 1500, loyerReferenceMajore: 1800 }) }), agence);

    expect(sansEspaces(html)).toContain("Loyerderéférence(parm²):</strong>1500FCFA");
    expect(sansEspaces(html)).toContain("Loyerderéférencemajoré(parm²):</strong>1800FCFA");
  });
});

describe("bail : garants", () => {
  const garant = (extra: Partial<NonNullable<LeaseExportData["guarantors"]>[number]> = {}) => ({
    civility: null,
    firstName: "Ousmane",
    lastName: "Fall",
    phone: "+221771111111",
    email: "o.fall@test.local" as string | null,
    address: "8 rue Carnot" as string | null,
    maxAmount: 600000 as number | null,
    ...extra,
  });

  it("un garant complet : nom, adresse, téléphone, e-mail et plafond garanti", () => {
    const html = generateLeaseHtml(bail({ guarantors: [garant()] }), agence);

    expect(html).toContain("<strong>Garant :</strong> Ousmane Fall (8 rue Carnot) — +221771111111, o.fall@test.local");
    expect(sansEspaces(html)).toContain("Montantmaximalgaranti:600000FCFA");
  });

  it("sans adresse ni e-mail : pas de parenthèses vides, pas de virgule pendante", () => {
    const html = generateLeaseHtml(bail({ guarantors: [garant({ address: null, email: null })] }), agence);

    expect(html).toContain("<strong>Garant :</strong> Ousmane Fall — +221771111111 —");
    expect(html).not.toContain("()");
  });

  it("sans aucun contact (ni téléphone ni e-mail) : aucun tiret de contact", () => {
    const html = generateLeaseHtml(bail({ guarantors: [garant({ phone: "", email: null, address: null })] }), agence);

    expect(html).toContain("<strong>Garant :</strong> Ousmane Fall — Montant maximal garanti : ");
    expect(html).not.toContain("Fall — ,");
    expect(html).not.toContain("Fall (");
  });

  it("le téléphone et l'e-mail d'un garant sont échappés", () => {
    const html = generateLeaseHtml(bail({ guarantors: [garant({ phone: "<b>06</b>", email: "x@<i>y</i>.fr" })] }), agence);

    expect(html).toContain("&lt;b&gt;06&lt;/b&gt;, x@&lt;i&gt;y&lt;/i&gt;.fr");
    expect(html).not.toContain("<b>06</b>");
  });

  it("un plafond absent est écrit « non précisé » (le silence ne dit pas « sans plafond »)", () => {
    const html = generateLeaseHtml(bail({ guarantors: [garant({ maxAmount: null })] }), agence);

    expect(html).toContain("Montant maximal garanti : non précisé");
  });

  it("un plafond à 0 est imprimé comme 0 (ce n'est pas « non précisé »)", () => {
    const html = generateLeaseHtml(bail({ guarantors: [garant({ maxAmount: 0 })] }), agence);

    expect(sansEspaces(html)).toContain("Montantmaximalgaranti:0FCFA");
    expect(html).not.toContain("non précisé");
  });

  it("chaque colocataire et chaque garant a sa ligne et son cadre de signature manuscrite", () => {
    const html = generateLeaseHtml(
      bail({
        cotenants: [{ civility: "M", firstName: "Moussa", lastName: "Diop", email: "m@test.local", phone: "+221772222222" }],
        guarantors: [garant(), garant({ firstName: "Awa", lastName: "Sow" })],
      }),
      agence
    );

    expect(html).toContain("<strong>Colocataire :</strong> Monsieur Moussa Diop (Email : m@test.local, Tél : +221772222222)");
    expect(html.match(/Le Colocataire :<\/strong>/g)).toHaveLength(1);
    expect(html.match(/Le Garant :<\/strong>/g)).toHaveLength(2);
    expect(html).toContain("Signature précédée de « lu et approuvé »");
  });

  it("sans colocataire ni garant, aucun cadre de signature supplémentaire", () => {
    const html = generateLeaseHtml(bail(), agence);

    expect(html).not.toContain("Le Colocataire :</strong>");
    expect(html).not.toContain("Le Garant :</strong>");
    expect(html).not.toContain("flex-wrap: wrap; gap: 16px"); // pas de cadre de signature vide non plus
  });
});

describe("bail : loyer, révisions et signatures", () => {
  it("sans révision, une seule ligne de loyer ; avec révisions, le loyer SIGNÉ, chaque changement daté, puis le loyer en vigueur", () => {
    const sans = generateLeaseHtml(bail(), agence);
    expect(sans).toContain("Loyer mensuel :</strong>");
    expect(sans).not.toContain("Révision à compter du");

    const avec = generateLeaseHtml(
      bail({
        rent: 270000,
        revisions: [
          { effectiveDate: "2027-03-01T00:00:00.000Z", previousRent: 250000, newRent: 260000 },
          { effectiveDate: "2028-01-01T00:00:00.000Z", previousRent: 260000, newRent: 270000 },
        ],
      }),
      agence
    );
    expect(sansEspaces(avec)).toContain("Loyermensuelalasignature:</strong>250000FCFA".replace("alasignature", "àlasignature"));
    expect(avec.match(/Révision à compter du/g)).toHaveLength(2);
    expect(avec).toContain("Révision à compter du 01/03/2027");
    expect(avec).toContain("Révision à compter du 01/01/2028");
    expect(sansEspaces(avec)).toContain("(aulieude250000FCFA)");
    expect(sansEspaces(avec)).toContain("Loyermensuelenvigueur:</strong>270000FCFA");
  });

  it("locataire signé SANS image : la date est imprimée, aucune balise image ; avec image : la balise est présente et échappée", () => {
    const sansImage = generateLeaseHtml(bail({ signedByTenantAt: "2026-03-02T10:00:00.000Z", tenantSignatureUrl: null }), agence);
    expect(sansImage).toContain("Signé électroniquement le 02/03/2026");
    expect(sansImage).not.toContain("<img");

    const avecImage = generateLeaseHtml(bail({ signedByTenantAt: "2026-03-02T10:00:00.000Z", tenantSignatureUrl: 'https://x.test/s.png"onerror="alert(1)' }), agence);
    expect(avecImage).toContain('alt="Signature Locataire"');
    expect(avecImage).toContain("&quot;onerror=&quot;");
    expect(avecImage).not.toContain('"onerror="');
  });

  it("une signature (image) sans date de signature n'est jamais affichée : le bail reste « en attente »", () => {
    const html = generateLeaseHtml(bail({ signedByTenantAt: null, tenantSignatureUrl: "https://x.test/s.png", signedByManagerAt: null, managerSignatureUrl: "https://x.test/m.png" }), agence);

    expect(html).not.toContain("<img");
    expect(html.match(/En attente de signature/g)).toHaveLength(2);
  });
});

/* ───────────────────────────── État des lieux ───────────────────────────── */

const edl = (extra: Partial<InspectionExportData> = {}): InspectionExportData => ({
  reference: "EDL-2026-06-A1B2C3",
  type: "ENTRY",
  inspectionDate: new Date(2026, 5, 3),
  agencyName: "Agence Teranga",
  property: { title: "Villa Ngor", address: "3 rue des Almadies" },
  tenant: { fullName: "Aminata Ba" },
  rooms: [{ name: "Salon", condition: "BON", notes: "RAS" }],
  meters: { electricity: "12345", water: "678", gas: "90" },
  keys: [{ label: "Clé principale", quantity: 2 }],
  generalComments: null,
  managerSignatureUrl: null,
  signedByManagerAt: null,
  tenantSignatureUrl: null,
  signedByTenantAt: null,
  ...extra,
});

describe("état des lieux : type, états et compteurs", () => {
  it("le type annonce ENTRÉE ou SORTIE, dans le titre de la page comme dans le badge", () => {
    const entree = generateInspectionHtml(edl({ type: "ENTRY" }));
    const sortie = generateInspectionHtml(edl({ type: "EXIT" }));

    expect(entree).toContain("<title>État des Lieux ENTRÉE");
    expect(entree).toContain('<span class="badge">ENTRÉE</span>');
    expect(sortie).toContain("<title>État des Lieux SORTIE");
    expect(sortie).toContain('<span class="badge">SORTIE</span>');
    expect(sortie).not.toContain("ENTRÉE</span>");
  });

  it("chaque état d'une pièce a son libellé et sa couleur ; un état inconnu garde son texte, en gris", () => {
    const html = generateInspectionHtml(
      edl({
        rooms: [
          { name: "Salon", condition: "BON", notes: "a" },
          { name: "Cuisine", condition: "MOYEN", notes: "b" },
          { name: "Chambre", condition: "MAUVAIS", notes: "c" },
          { name: "Cave", condition: "INCONNU" as never, notes: "d" },
        ],
      })
    );

    expect(html).toContain('color:#059669; font-weight:600;">Bon état');
    expect(html).toContain('color:#d97706; font-weight:600;">État moyen');
    expect(html).toContain('color:#dc2626; font-weight:600;">Mauvais état');
    expect(html).toContain('color:#475569; font-weight:600;">INCONNU');
  });

  it("une observation vide est remplacée par un tiret, une observation saisie est gardée", () => {
    const html = generateInspectionHtml(edl({ rooms: [{ name: "Salon", condition: "BON", notes: "" }, { name: "Cuisine", condition: "BON", notes: "Joint à refaire" }] }));

    expect(html).toContain("<td>—</td>");
    expect(html).toContain("<td>Joint à refaire</td>");
  });

  it("un compteur non relevé s'imprime « — », chacun indépendamment des autres", () => {
    const html = generateInspectionHtml(edl({ meters: { electricity: "", water: "678", gas: "" } }));

    expect(html).toContain('Électricité</div><div class="meter-value">—</div>');
    expect(html).toContain('Eau</div><div class="meter-value">678</div>');
    expect(html).toContain('Gaz</div><div class="meter-value">—</div>');

    const eau = generateInspectionHtml(edl({ meters: { electricity: "1", water: "", gas: "3" } }));
    expect(eau).toContain('Eau</div><div class="meter-value">—</div>');
    expect(eau).toContain('Électricité</div><div class="meter-value">1</div>');
    expect(eau).toContain('Gaz</div><div class="meter-value">3</div>');
  });

  it("signature d'une partie sans image : la date est imprimée sans balise image ; avec image, elle est échappée", () => {
    const html = generateInspectionHtml(
      edl({ signedByManagerAt: new Date(2026, 5, 3), managerSignatureUrl: null, signedByTenantAt: new Date(2026, 5, 3), tenantSignatureUrl: 'https://x.test/t.png"onerror="x' })
    );

    expect(html.match(/Signé électroniquement le/g)).toHaveLength(2);
    expect(html).not.toContain('alt="Signature Gestionnaire"');
    expect(html).toContain('alt="Signature Locataire"');
    expect(html).not.toContain('"onerror="');
  });

  it("locataire signé sans fichier de signature : la date est imprimée, aucune balise image (comme pour le gestionnaire)", () => {
    const html = generateInspectionHtml(edl({ signedByTenantAt: new Date(2026, 5, 3), tenantSignatureUrl: null, signedByManagerAt: new Date(2026, 5, 3), managerSignatureUrl: "https://x.test/m.png" }));

    expect(html.match(/Signé électroniquement le/g)).toHaveLength(2);
    expect(html).toContain('alt="Signature Gestionnaire"');
    expect(html).not.toContain('alt="Signature Locataire"');
    expect(html).not.toContain('src=""');
  });

  it("le tampon « signé contradictoirement » exige LES DEUX signatures", () => {
    const un = generateInspectionHtml(edl({ signedByManagerAt: new Date(2026, 5, 3) }));
    const deux = generateInspectionHtml(edl({ signedByManagerAt: new Date(2026, 5, 3), signedByTenantAt: new Date(2026, 5, 4) }));

    expect(un).not.toContain("SIGNÉ CONTRADICTOIREMENT");
    expect(deux).toContain("SIGNÉ CONTRADICTOIREMENT");
  });
});

/* ───────────────────────────── Compte rendu de gestion ───────────────────────────── */

const crg = (extra: Partial<CrgExportData> = {}): CrgExportData => ({
  agencyName: "Agence Teranga",
  ownerName: "Fatou Diop",
  managementFeeRate: 10,
  month: 6,
  year: 2026,
  properties: [{ propertyId: "p1", propertyTitle: "Villa Ngor", currency: "XOF", loyersEncaisses: 250000, chargesDeduites: 10000, commission: 25000, netAReverser: 215000 }],
  totalLoyersByCurrency: { XOF: 250000 },
  totalChargesByCurrency: { XOF: 10000 },
  totalCommissionByCurrency: { XOF: 25000 },
  totalNetByCurrency: { XOF: 215000 },
  ...extra,
});

describe("compte rendu de gestion : totaux, banque et reversements", () => {
  it("une devise qui n'apparaît que dans certains totaux imprime 0 pour les colonnes absentes", () => {
    const html = generateCrgHtml(crg({ totalLoyersByCurrency: {}, totalChargesByCurrency: {}, totalCommissionByCurrency: {}, totalNetByCurrency: { EUR: 1000 } }));

    const ligne = html.slice(html.indexOf('<tr class="total-row">'));
    const cellules = sansEspaces(ligne.slice(0, ligne.indexOf("</tr>")));
    expect(cellules.match(/>0€<\/td>/g)).toHaveLength(3); // loyers, charges, commission : 0, jamais « NaN »
    expect(cellules).toContain(">1000€</td>");
    expect(cellules).not.toContain("NaN");
  });

  it("le propriétaire société est nommé entre parenthèses, échappé", () => {
    const html = generateCrgHtml(crg({ ownerCompanyName: "SCI <Teranga>" }));

    expect(html).toContain("Fatou Diop (SCI &lt;Teranga&gt;)");
    expect(generateCrgHtml(crg())).not.toContain("Fatou Diop (");
  });

  it("aucune coordonnée bancaire n'est imprimée : ni IBAN, ni BIC, ni message « aucune coordonnée »", () => {
    const html = generateCrgHtml(crg());

    expect(html).not.toMatch(/IBAN|BIC/);
    expect(html).not.toContain("color:#94a3b8");
  });

  it("aucun reversement ni reste : la section n'existe pas", () => {
    expect(generateCrgHtml(crg())).not.toContain("<th>Date</th>");
    expect(generateCrgHtml(crg({ reversements: [], resteAReverserByCurrency: { XOF: 0 } }))).not.toContain("<th>Date</th>");
  });

  it("un reversement : date, moyen de paiement connu en clair (inconnu : tel quel), référence après un tiret, montant dans sa devise", () => {
    const html = generateCrgHtml(
      crg({
        reversements: [
          { currency: "XOF", amount: 100000, paidAt: new Date(Date.UTC(2026, 5, 10)), method: "BANK_TRANSFER", reference: "VIR-42" },
          { currency: "XOF", amount: 50000, paidAt: new Date(Date.UTC(2026, 5, 20)), method: "MOYEN_INCONNU", reference: null },
        ],
      })
    );

    expect(html).toContain("VIR-42");
    expect(html).toContain(`${TEXTES_CRG.fr.moyens.BANK_TRANSFER} — VIR-42`);
    expect(html).not.toContain("BANK_TRANSFER");
    expect(html).toContain("<td>MOYEN_INCONNU</td>");
    expect(sansEspaces(html)).toContain("100000FCFA");
    expect(sansEspaces(html)).toContain("50000FCFA");
    expect(html).not.toContain("MOYEN_INCONNU —"); // pas de tiret sans référence
  });

  it("des restes sans reversement : la ligne « aucun reversement » et un reste dans chaque devise, positif = à reverser, négatif = versé en trop", () => {
    const html = generateCrgHtml(crg({ reversements: [], resteAReverserByCurrency: { XOF: 215000, EUR: -30 } }));

    expect(html).toContain(TEXTES_CRG.fr.aucunReversement); // ligne « aucun reversement »
    expect(html).toContain(TEXTES_CRG.fr.resteAReverser("XOF"));
    expect(html).toContain(TEXTES_CRG.fr.verseEnTrop("EUR"));
    expect(html).not.toContain(TEXTES_CRG.fr.resteAReverser("EUR"));
    expect(sansEspaces(html)).toContain("215000FCFA");
    expect(sansEspaces(html)).toContain("30€"); // le versé en trop est affiché en valeur absolue
    expect(html).not.toContain("-30");
  });

  it("le tableau est vide mais lisible quand le propriétaire n'a aucun bien", () => {
    const html = generateCrgHtml(crg({ properties: [], totalLoyersByCurrency: {}, totalChargesByCurrency: {}, totalCommissionByCurrency: {}, totalNetByCurrency: {} }));

    expect(html).toContain('colspan="5"');
    expect(html).not.toContain('class="total-row"');
  });
});

/* ───────────────────────────── Avenant de révision ───────────────────────────── */

const avenant = (extra: Partial<RentRevisionExportData> = {}): RentRevisionExportData => ({
  numero: 2,
  status: "APPLIED",
  previousRent: 200000,
  newRent: 210000,
  currency: "XOF",
  effectiveDate: "2026-07-01T00:00:00.000Z",
  motif: null,
  note: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  contract: { startDate: "2025-01-01T00:00:00.000Z", endDate: "2028-01-01T00:00:00.000Z" },
  property: { title: "Villa Ngor", address: "3 rue des Almadies" },
  tenant: { firstName: "Aminata", lastName: "Ba" },
  ...extra,
});

describe("avenant de révision de loyer", () => {
  it("une révision programmée le dit à côté de la date d'effet ; une révision appliquée ne le dit pas", () => {
    expect(generateRentRevisionHtml(avenant({ status: "PENDING" }), agence)).toContain("01/07/2026 (révision programmée)");
    expect(generateRentRevisionHtml(avenant({ status: "APPLIED" }), agence)).not.toContain("révision programmée");
  });

  it("la base de calcul et les observations ne s'impriment que si elles sont saisies, observations échappées avec leurs retours à la ligne", () => {
    const sans = generateRentRevisionHtml(avenant(), agence);
    expect(sans).not.toContain("Base de calcul");
    expect(sans).not.toContain("Observations");

    const avec = generateRentRevisionHtml(avenant({ motif: "IRL : 142,06 → 144", note: "Ligne 1\r\n<b>Ligne 2</b>" }), agence);
    expect(avec).toContain("Base de calcul :</strong> IRL : 142,06 → 144");
    expect(avec).toContain("Observations :</strong> Ligne 1<br>&lt;b&gt;Ligne 2&lt;/b&gt;");
  });

  it("le droit applicable du bail est cité quand il est saisi", () => {
    expect(generateRentRevisionHtml(avenant({ contract: { ...avenant().contract, applicableLaw: "  Droit sénégalais " } }), agence)).toContain("Droit applicable : Droit sénégalais");
    expect(generateRentRevisionHtml(avenant({ contract: { ...avenant().contract, applicableLaw: "   " } }), agence)).not.toContain("Droit applicable");
  });

  it("avec un garant : la section « Engagement des garants » et « autant d'exemplaires que de signataires » ; sans : deux exemplaires", () => {
    const garant = { civility: null, firstName: "Ousmane", lastName: "Fall", phone: "+221771111111", email: null, address: null, maxAmount: null };

    const avec = generateRentRevisionHtml(avenant({ guarantors: [garant] }), agence);
    const colocSeul = generateRentRevisionHtml(avenant({ cotenants: [{ civility: null, firstName: "Moussa", lastName: "Diop", email: "m@test.local", phone: "+221772222222" }] }), agence);
    const sans = generateRentRevisionHtml(avenant(), agence);

    expect(avec).toContain("5. Engagement des garants");
    expect(avec).toContain("autant d'exemplaires que de signataires");
    expect(colocSeul).toContain("autant d'exemplaires que de signataires");
    expect(colocSeul).not.toContain("Engagement des garants"); // pas de garant : pas de section
    expect(sans).toContain("en deux exemplaires");
    expect(sans).not.toContain("Engagement des garants");
  });

  it("le nom de repli « L'Agence » est imprimé quand l'agence n'a pas de nom, son adresse entre parenthèses quand elle en a une", () => {
    expect(generateRentRevisionHtml(avenant(), { agencyName: null })).toContain("Le Bailleur / Mandataire :</strong> L'Agence");
    expect(generateRentRevisionHtml(avenant(), { agencyName: "Agence Teranga", address: "1 rue A" })).toContain("Agence Teranga (1 rue A)");
    expect(generateRentRevisionHtml(avenant(), { agencyName: "Agence Teranga" })).not.toContain("Agence Teranga (");
  });

  it("le titre reprend le type du bail (« AU BAIL … »)", () => {
    expect(generateRentRevisionHtml(avenant({ contract: { ...avenant().contract, leaseType: "COMMERCIAL" } }), agence)).toContain("AVENANT N°2 AU");
  });
});

/* ───────────────────────────── Mise en demeure ───────────────────────────── */

const miseEnDemeure = (extra: Partial<FormalNoticeData> = {}): FormalNoticeData => ({
  reference: "MED-2026-ABC123",
  createdAt: new Date(2026, 9, 12),
  deadlineDays: 8,
  currency: "XOF",
  totalDue: 250000,
  factures: [{ periodMonth: 9, periodYear: 2026, dueDate: "2026-09-05T00:00:00.000Z", amount: 250000, resteDu: 250000 }],
  destinataires: "Madame Aminata BA",
  adresse: "3 rue des Almadies, Dakar",
  propertyTitle: "Villa Ngor",
  contractStartDate: new Date(2025, 0, 1),
  applicableLaw: null,
  garants: [],
  agency: { name: "Agence Teranga", address: null, phone: null, email: null, siretOrId: null },
  ...extra,
});

describe("mise en demeure : texte", () => {
  it("un seul loyer : singulier partout ; plusieurs : pluriel partout", () => {
    const un = texteMiseEnDemeure(miseEnDemeure());
    const deux = texteMiseEnDemeure(
      miseEnDemeure({
        factures: [
          { periodMonth: 8, periodYear: 2026, dueDate: "2026-08-05T00:00:00.000Z", amount: 250000, resteDu: 100000 },
          { periodMonth: 9, periodYear: 2026, dueDate: "2026-09-05T00:00:00.000Z", amount: 250000, resteDu: 250000 },
        ],
      })
    );

    expect(un.objet).toContain("loyer impayé —");
    expect(un.constat).toContain("la somme suivante, due");
    expect(un.constat).toContain("reste impayée");
    expect(deux.objet).toContain("loyers impayés —");
    expect(deux.constat).toContain("les sommes suivantes, dues");
    expect(deux.constat).toContain("restent impayées");
    expect(deux.lignes).toHaveLength(2);
    expect(deux.lignes[0].periode).toBe("août 2026");
  });

  it("le délai : « 1 jour » au singulier, « 8 jours » au pluriel", () => {
    expect(texteMiseEnDemeure(miseEnDemeure({ deadlineDays: 1 })).demande).toContain("délai de 1 jour à compter");
    expect(texteMiseEnDemeure(miseEnDemeure({ deadlineDays: 8 })).demande).toContain("délai de 8 jours à compter");
  });

  it("garants : aucune mention sans garant, « du garant » pour un, « des garants » pour plusieurs, avec leurs noms", () => {
    expect(texteMiseEnDemeure(miseEnDemeure()).suites).not.toContain("garant");
    expect(texteMiseEnDemeure(miseEnDemeure({ garants: ["Ousmane Fall"] })).suites).toContain("l'engagement du garant (Ousmane Fall)");
    expect(texteMiseEnDemeure(miseEnDemeure({ garants: ["Ousmane Fall", "Awa Sow"] })).suites).toContain("l'engagement des garants (Ousmane Fall, Awa Sow)");
  });

  it("le droit applicable du bail est cité (espaces retirés) ; vide ou blanc : aucune mention", () => {
    expect(texteMiseEnDemeure(miseEnDemeure({ applicableLaw: "  Droit sénégalais " })).droit).toBe("Droit applicable au bail : Droit sénégalais");
    expect(texteMiseEnDemeure(miseEnDemeure({ applicableLaw: "   " })).droit).toBeNull();
    expect(texteMiseEnDemeure(miseEnDemeure({ applicableLaw: null })).droit).toBeNull();
  });

  it("l'adresse du logement n'est citée que si elle est connue ; le 1er du mois s'écrit « 1er »", () => {
    expect(texteMiseEnDemeure(miseEnDemeure()).constat).toContain("situé 3 rue des Almadies, Dakar");
    expect(texteMiseEnDemeure(miseEnDemeure({ adresse: "" })).constat).not.toContain("situé");
    expect(texteMiseEnDemeure(miseEnDemeure()).constat).toContain("bail du 1er janvier 2025");
  });

  it("un mois hors 1 à 12 s'écrit en chiffre plutôt que de planter", () => {
    const t = texteMiseEnDemeure(miseEnDemeure({ factures: [{ periodMonth: 13, periodYear: 2026, dueDate: "2026-09-05T00:00:00.000Z", amount: 1, resteDu: 1 }] }));

    expect(t.lignes[0].periode).toBe("13 2026");
  });

  it("la mention propre au pays n'apparaît que pour un pays qui en a une", () => {
    expect(texteMiseEnDemeure(miseEnDemeure({ pays: "FR" })).mentionPays).toContain("loi n° 89-462");
    expect(texteMiseEnDemeure(miseEnDemeure({ pays: null })).mentionPays).toBeNull();
  });
});

describe("mise en demeure : document", () => {
  it("l'en-tête de l'agence n'imprime que ses coordonnées renseignées", () => {
    const vide = generateFormalNoticeHtml(miseEnDemeure());
    const plein = generateFormalNoticeHtml(miseEnDemeure({ agency: { name: "Agence Teranga", address: "1 rue A", phone: "+221338000000", email: "c@teranga.test", siretOrId: "NINEA 1" } }));

    expect(vide).not.toContain("Tél :");
    expect(vide).not.toContain("Identifiants légaux");
    expect(plein).toContain("1 rue A<br>");
    expect(plein).toContain("Tél : +221338000000");
    expect(plein).toContain("c@teranga.test<br>");
    expect(plein).toContain("Identifiants légaux : NINEA 1");
  });

  it("le droit applicable et la mention du pays figurent dans le document quand ils existent", () => {
    const html = generateFormalNoticeHtml(miseEnDemeure({ applicableLaw: "Droit sénégalais", pays: "FR" }));

    expect(html).toContain("Droit applicable au bail : Droit sénégalais");
    expect(html).toContain("loi n° 89-462");
    const sans = generateFormalNoticeHtml(miseEnDemeure());
    expect(sans).not.toContain("Droit applicable");
    expect(sans).not.toContain("loi n° 89-462");
  });
});

/** Capture le texte écrit dans un PDF : les flux pdfkit sont compressés, mais chaque appel à `text` est observable. */
async function texteDuPdf(generer: () => Promise<Buffer>): Promise<{ lignes: string[]; pdf: Buffer }> {
  const espion = vi.spyOn(PDFDocument.prototype, "text");
  const pdf = await generer();
  const lignes = espion.mock.calls.map((a) => (typeof a[0] === "string" ? a[0] : String(a[0]))).map((s) => s.replace(/ /g, " ").replace(/ /g, " "));
  return { lignes, pdf };
}

describe("mise en demeure : PDF", () => {
  it("le PDF est un vrai PDF qui reprend le texte du courrier, droit et mention du pays compris", async () => {
    const d = miseEnDemeure({ applicableLaw: "Droit sénégalais", pays: "FR", agency: { name: "Agence Teranga", address: "1 rue A", phone: "+221338000000", email: "c@teranga.test", siretOrId: "NINEA 1" } });

    const { lignes, pdf } = await texteDuPdf(() => generateFormalNoticePdfBuffer(d));

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = texteMiseEnDemeure(d);
    for (const attendu of [t.titre, t.objet, t.constat, t.demande, t.suites, t.droit!, t.mentionPays!, "Tél : +221338000000", "Identifiants légaux : NINEA 1", "1 rue A", "c@teranga.test"]) {
      expect(lignes).toContain(lu(attendu));
    }
  });

  it("sans droit applicable ni mention du pays ni coordonnées, ces lignes ne sont pas écrites", async () => {
    const { lignes } = await texteDuPdf(() => generateFormalNoticePdfBuffer(miseEnDemeure()));

    expect(lignes.some((l) => l.startsWith("Droit applicable"))).toBe(false);
    expect(lignes.some((l) => l.includes("loi n°"))).toBe(false);
    expect(lignes.some((l) => l.startsWith("Tél :"))).toBe(false);
  });

  it("beaucoup de loyers impayés : le tableau passe à la page suivante au lieu d'en ouvrir une par cellule", async () => {
    const factures = Array.from({ length: 40 }, (_, i) => ({ periodMonth: (i % 12) + 1, periodYear: 2023 + Math.floor(i / 12), dueDate: "2026-01-05T00:00:00.000Z", amount: 1000, resteDu: 1000 }));
    const { pdf } = await texteDuPdf(() => generateFormalNoticePdfBuffer(miseEnDemeure({ factures, totalDue: 40000 })));

    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThan(10);
  });
});

/* ───────────────────────────── Solde de tout compte ───────────────────────────── */

const solde = (extra: Partial<SettlementData> = {}): SettlementData => ({
  reference: "SOLDE-2026-ABCDEF01",
  createdAt: new Date(Date.UTC(2026, 9, 12)),
  exitDate: new Date(Date.UTC(2026, 9, 31)),
  lastMonthMode: "FULL",
  currency: "XOF",
  depositAmount: 500000,
  deductions: [],
  deductionsTotal: 0,
  depositRefunded: 0,
  lignes: [],
  unpaidTotal: 0,
  creditTotal: 0,
  balance: 500000,
  destinataires: "Madame Aminata BA",
  adresse: "3 rue des Almadies, Dakar",
  propertyTitle: "Villa Ngor",
  contractStartDate: new Date(Date.UTC(2025, 0, 1)),
  agency: { name: "Agence Teranga", address: null, phone: null, email: null, siretOrId: null },
  ...extra,
});

describe("solde de tout compte : texte", () => {
  it("le récapitulatif ne liste que les lignes non nulles, dans l'ordre dépôt, retenues, loyers dus, trop-perçu, déjà restitué", () => {
    const rien = texteSolde(solde());
    const tout = texteSolde(solde({ deductionsTotal: 100000, unpaidTotal: 50000, creditTotal: 20000, depositRefunded: 400000, balance: -30000 }));

    expect(rien.recap.map((r) => r.libelle)).toEqual(["Dépôt de garantie"]);
    expect(tout.recap.map((r) => `${r.signe} ${r.libelle}`)).toEqual([
      "+ Dépôt de garantie",
      "− Retenues sur le dépôt",
      "− Loyers restant dus",
      "+ Trop-perçu de loyer",
      "− Dépôt déjà restitué",
    ]);
  });

  it("le sens du résultat : à restituer (positif), reste dû (négatif, en valeur absolue), compte soldé (nul)", () => {
    const restituer = texteSolde(solde({ balance: 1000 }));
    const devoir = texteSolde(solde({ balance: -1000 }));
    const solde0 = texteSolde(solde({ balance: 0 }));

    expect(restituer.resultat).toMatchObject({ libelle: "Somme à restituer au locataire", sens: "restituer" });
    expect(restituer.consigne).toBe("Cette somme vous est restituée par l'agence.");
    expect(devoir.resultat).toMatchObject({ libelle: "Reste dû par le locataire", sens: "devoir" });
    expect(sansEspaces(devoir.resultat.montant)).toBe("1000FCFA"); // jamais « -1000 »
    expect(devoir.consigne).toContain("reste à régler à l'agence");
    expect(solde0.resultat).toMatchObject({ libelle: "Compte soldé", sens: "solde" });
    expect(solde0.consigne).toBe("Aucune somme n'est due de part ni d'autre.");
  });

  it("la note du dernier mois dit s'il est dû en entier ou au prorata ; le dépôt déjà restitué n'est cité que s'il y en a un", () => {
    expect(texteSolde(solde({ lastMonthMode: "FULL" })).noteProrata).toContain("dû en entier");
    expect(texteSolde(solde({ lastMonthMode: "PRORATA" })).noteProrata).toContain("au prorata");
    expect(texteSolde(solde()).dejaRestitue).toBeNull();
    expect(sansEspaces(texteSolde(solde({ depositRefunded: 400000 })).dejaRestitue!)).toBe("Dépôtdéjàrestitué:400000FCFA");
  });

  it("l'objet cite l'adresse du logement seulement si elle est connue ; le 1er du mois s'écrit « 1er »", () => {
    expect(texteSolde(solde()).objet).toContain("« Villa Ngor », 3 rue des Almadies, Dakar —");
    expect(texteSolde(solde({ adresse: "" })).objet).toContain("« Villa Ngor » —");
    expect(texteSolde(solde()).objet).toContain("bail du 1er janvier 2025");
  });

  it("un mois hors 1 à 12 d'une ligne de loyer s'écrit en chiffre", () => {
    const t = texteSolde(solde({ lignes: [{ periodMonth: 14, periodYear: 2026, amount: 1, retenu: 1, paid: 0, due: 1, credit: 0 }] }));

    expect(t.lignes[0].periode).toBe("14 2026");
  });
});

describe("solde de tout compte : document HTML", () => {
  const ligne = { periodMonth: 9, periodYear: 2026, amount: 250000, retenu: 250000, paid: 100000, due: 150000, credit: 0 };

  it("sans loyer, le document le dit au lieu d'un tableau vide ; avec des loyers, le tableau et son total", () => {
    const sans = generateSettlementHtml(solde());
    const avec = generateSettlementHtml(solde({ lignes: [ligne], unpaidTotal: 150000, balance: 350000 }));

    expect(sans).toContain("Aucun loyer n'a été facturé jusqu'à la sortie.");
    expect(sans).not.toContain("<th>Période</th>");
    expect(avec).toContain("septembre 2026");
    expect(avec).toContain("Total restant dû");
  });

  it("sans retenue : « Aucune retenue enregistrée » ; avec retenues : chacune, précédée d'un moins", () => {
    const sans = generateSettlementHtml(solde());
    const avec = generateSettlementHtml(solde({ deductions: [{ label: "Peinture", amount: 100000 }], deductionsTotal: 100000, balance: 400000 }));

    expect(sans).toContain("Aucune retenue enregistrée sur le dépôt.");
    expect(avec).not.toContain("Aucune retenue enregistrée");
    expect(avec).toContain("<td>Peinture</td>");
    expect(sansEspaces(avec)).toContain("-100000FCFA");
  });

  it("le dépôt déjà restitué ajoute une phrase, une ligne du récapitulatif, et seulement quand il y en a un", () => {
    const sans = generateSettlementHtml(solde());
    const avec = generateSettlementHtml(solde({ depositRefunded: 400000, balance: 100000 }));

    expect(sans).not.toContain("Dépôt déjà restitué");
    expect(sans).not.toContain("<p></p>"); // pas de paragraphe vide à la place
    expect(avec.match(/Dépôt déjà restitué/g)).toHaveLength(2); // la phrase, et la ligne du récapitulatif
  });

  it("la couleur du résultat suit son sens : rouge (reste dû), vert (à restituer), neutre (soldé)", () => {
    expect(generateSettlementHtml(solde({ balance: -1 }))).toContain("border: 2px solid #7f1d1d");
    expect(generateSettlementHtml(solde({ balance: 1 }))).toContain("border: 2px solid #14532d");
    expect(generateSettlementHtml(solde({ balance: 0 }))).toContain("border: 2px solid #0f172a");
  });

  it("l'en-tête de l'agence n'imprime que ses coordonnées renseignées", () => {
    const vide = generateSettlementHtml(solde());
    const plein = generateSettlementHtml(solde({ agency: { name: "Agence Teranga", address: "1 rue A", phone: "+221338000000", email: "c@teranga.test", siretOrId: "NINEA 1" } }));

    expect(vide).not.toContain("Tél :");
    expect(vide).not.toContain("Identifiants légaux");
    expect(plein).toContain("Tél : +221338000000");
    expect(plein).toContain("c@teranga.test<br>");
    expect(plein).toContain("Identifiants légaux : NINEA 1");
  });
});

describe("solde de tout compte : PDF", () => {
  it("le PDF reprend loyers, retenues, dépôt déjà restitué, récapitulatif et résultat", async () => {
    const d = solde({
      lignes: [{ periodMonth: 9, periodYear: 2026, amount: 250000, retenu: 250000, paid: 100000, due: 150000, credit: 0 }],
      unpaidTotal: 150000,
      deductions: [{ label: "Peinture", amount: 100000 }],
      deductionsTotal: 100000,
      depositRefunded: 400000,
      balance: -150000,
      agency: { name: "Agence Teranga", address: "1 rue A", phone: "+221338000000", email: "c@teranga.test", siretOrId: "NINEA 1" },
    });

    const { lignes, pdf } = await texteDuPdf(() => generateSettlementPdfBuffer(d));

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = texteSolde(d);
    expect(lignes).toContain(lu(t.titre));
    expect(lignes).toContain(lu(t.dejaRestitue!));
    expect(lignes).toContain("Retenue : Peinture");
    expect(lignes).toContain("Total restant dû");
    expect(lignes).toContain(lu(t.consigne));
    expect(lignes.some((l) => l.startsWith("septembre 2026 — retenu"))).toBe(true);
    expect(lignes).toContain("Tél : +221338000000");
    expect(lignes).not.toContain(lu(t.aucunLoyer));
    expect(lignes).not.toContain(lu(t.aucuneRetenue));
  });

  it("sans loyer ni retenue ni dépôt déjà restitué : les phrases de repli sont écrites à la place", async () => {
    const d = solde();

    const { lignes } = await texteDuPdf(() => generateSettlementPdfBuffer(d));

    const t = texteSolde(d);
    expect(lignes).toContain(lu(t.aucunLoyer));
    expect(lignes).toContain(lu(t.aucuneRetenue));
    expect(lignes).not.toContain("Total restant dû");
    expect(lignes.some((l) => l.startsWith("Dépôt déjà restitué"))).toBe(false);
    expect(lignes).not.toContain("null"); // aucune ligne « null » à la place de la phrase absente
    expect(lignes.some((l) => l.startsWith("Tél :"))).toBe(false);
  });
});
