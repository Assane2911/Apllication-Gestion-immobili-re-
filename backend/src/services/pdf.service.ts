import PDFDocument from "pdfkit";

/**
 * Échappe les caractères HTML spéciaux avant interpolation dans les templates
 * de documents (quittance, bail) ci-dessous. Ces templates sont servis tels
 * quels en `text/html` (voir document.controller.ts) : sans échappement, un
 * champ contrôlé par le locataire ou le gestionnaire (nom, adresse, mention
 * légale, signature...) peut casser hors de son attribut/balise et injecter
 * du script exécuté dans le navigateur de l'autre partie (XSS stockée).
 */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ReceiptData {
  receiptNumber: string;
  agency: {
    name: string;
    logoUrl?: string | null;
    siretOrId?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    legalNotice?: string | null;
    stampUrl?: string | null;
  };
  tenant: {
    fullName: string;
    email: string;
    phone: string;
  };
  property: {
    title: string;
    address: string;
    surface: number;
  };
  invoice: {
    periodMonth: number;
    periodYear: number;
    amount: number;
    currency: string;
    paidAt: Date;
    paymentMethod: string;
    paymentRef?: string | null;
  };
}

const monthNames = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export function generateReceiptHtml(data: ReceiptData): string {
  const periodLabel = `${monthNames[data.invoice.periodMonth - 1]} ${data.invoice.periodYear}`;
  const paidDateFormatted = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(
    new Date(data.invoice.paidAt)
  );

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Quittance de Loyer - N° ${escapeHtml(data.receiptNumber)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      margin: 0;
      padding: 24px;
      background: #ffffff;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .agency-title {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px 0;
    }
    .agency-info, .tenant-info {
      font-size: 12px;
      color: #475569;
    }
    .doc-badge {
      text-align: right;
    }
    .doc-title {
      font-size: 18px;
      font-weight: 800;
      color: #2563eb;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0;
    }
    .doc-ref {
      font-size: 11px;
      color: #64748b;
      font-family: monospace;
      margin-top: 4px;
    }
    .tenant-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
    }
    .main-statement {
      font-size: 14px;
      margin-bottom: 20px;
      padding: 12px 16px;
      background: #eff6ff;
      border-left: 4px solid #2563eb;
      border-radius: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      font-size: 13px;
    }
    th {
      background: #0f172a;
      color: #ffffff;
      font-weight: 600;
      text-align: left;
      padding: 10px 14px;
    }
    td {
      padding: 12px 14px;
      border-bottom: 1px solid #e2e8f0;
    }
    .total-row td {
      font-weight: 700;
      font-size: 15px;
      color: #0f172a;
      background: #f8fafc;
      border-top: 2px solid #0f172a;
    }
    .stamp-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 40px;
    }
    .stamp-box {
      width: 200px;
      height: 100px;
      border: 1px dashed #94a3b8;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: #64748b;
      background: #fafafa;
    }
    .stamp-certified {
      color: #059669;
      font-weight: 700;
      border-color: #059669;
      background: #ecfdf5;
    }
    .footer-legal {
      margin-top: 48px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      font-size: 10px;
      color: #94a3b8;
      text-align: center;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="agency-title">${escapeHtml(data.agency.name)}</h1>
      <div class="agency-info">
        ${data.agency.address ? `<p style="margin:2px 0;">${escapeHtml(data.agency.address)}</p>` : ""}
        ${data.agency.phone ? `<p style="margin:2px 0;">Tél : ${escapeHtml(data.agency.phone)}</p>` : ""}
        ${data.agency.email ? `<p style="margin:2px 0;">Email : ${escapeHtml(data.agency.email)}</p>` : ""}
        ${data.agency.siretOrId ? `<p style="margin:2px 0;">N° SIRET / NIF : ${escapeHtml(data.agency.siretOrId)}</p>` : ""}
      </div>
    </div>
    <div class="doc-badge">
      <h2 class="doc-title">QUITTANCE DE LOYER</h2>
      <div class="doc-ref">RÉF : ${escapeHtml(data.receiptNumber)}</div>
      <div style="font-size:12px; margin-top:4px; color:#475569;">Période : <strong>${periodLabel}</strong></div>
    </div>
  </div>

  <div class="tenant-box">
    <div>
      <div style="font-size:11px; text-transform:uppercase; color:#64748b; font-weight:600;">Locataire</div>
      <div style="font-size:15px; font-weight:700; color:#0f172a; margin-top:2px;">${escapeHtml(data.tenant.fullName)}</div>
      <div class="tenant-info" style="margin-top:4px;">
        <div>${escapeHtml(data.tenant.email)}</div>
        <div>${escapeHtml(data.tenant.phone)}</div>
      </div>
    </div>
    <div>
      <div style="font-size:11px; text-transform:uppercase; color:#64748b; font-weight:600;">Logement Loué</div>
      <div style="font-size:14px; font-weight:600; color:#0f172a; margin-top:2px;">${escapeHtml(data.property.title)}</div>
      <div class="tenant-info" style="margin-top:2px;">${escapeHtml(data.property.address)}</div>
      <div class="tenant-info">Surface : ${data.property.surface} m²</div>
    </div>
  </div>

  <div class="main-statement">
    Je soussigné, gestionnaire pour le compte du bailleur, certifie avoir reçu de <strong>${escapeHtml(data.tenant.fullName)}</strong>
    la somme de <strong>${data.invoice.amount} ${escapeHtml(data.invoice.currency)}</strong> au titre du paiement du loyer et des charges pour la période du mois de <strong>${periodLabel}</strong>, et lui en donne quittance sous réserve de tous droits.
  </div>

  <table>
    <thead>
      <tr>
        <th>Désignation</th>
        <th>Période</th>
        <th>Moyen de paiement</th>
        <th style="text-align:right;">Montant</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Loyer mensuel & charges locatives</td>
        <td>${periodLabel}</td>
        <td>${escapeHtml(data.invoice.paymentMethod)}</td>
        <td style="text-align:right; font-weight:600;">${data.invoice.amount} ${escapeHtml(data.invoice.currency)}</td>
      </tr>
      <tr class="total-row">
        <td colspan="3" style="text-align:right;">TOTAL REÇU :</td>
        <td style="text-align:right;">${data.invoice.amount} ${escapeHtml(data.invoice.currency)}</td>
      </tr>
    </tbody>
  </table>

  <div class="stamp-section">
    <div>
      <p style="font-size:12px; color:#475569; margin:0 0 4px 0;">
        Fait le <strong>${paidDateFormatted}</strong>
      </p>
      <p style="font-size:11px; color:#64748b; margin:0;">
        Règlement validé et enregistré électroniquement.
      </p>
    </div>
    <div class="stamp-box stamp-certified">
      <span style="font-size:18px;">✅</span>
      <span style="margin-top:4px;">QUITTANCE VALIDÉE</span>
      <span style="font-size:9px; color:#047857;">LE ${paidDateFormatted}</span>
    </div>
  </div>

  <div class="footer-legal">
    ${escapeHtml(data.agency.legalNotice) || "Document émis et certifié conforme par le système de gestion locative immobilière."}
    <br>Cette quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme.
  </div>
</body>
</html>
  `.trim();
}

/**
 * Génère un vrai fichier PDF (buffer binaire) de la quittance de loyer, via
 * pdfkit — un rendu pur Node.js, sans navigateur headless, donc compatible
 * avec un environnement serverless comme Vercel. Utilisé pour la pièce
 * jointe de l'email envoyé automatiquement au locataire dès qu'un paiement
 * est validé (voir services/receipt.service.ts).
 */
export function generateReceiptPdfBuffer(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const periodLabel = `${monthNames[data.invoice.periodMonth - 1]} ${data.invoice.periodYear}`;
      const paidDateFormatted = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(
        new Date(data.invoice.paidAt)
      );

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const brand = "#2563eb";
      const dark = "#0f172a";
      const gray = "#64748b";

      // --- En-tête : identité de l'agence + titre du document ---
      doc.fillColor(dark).font("Helvetica-Bold").fontSize(16).text(data.agency.name, { width: pageWidth * 0.6 });
      doc.font("Helvetica").fontSize(9).fillColor(gray);
      if (data.agency.address) doc.text(data.agency.address, { width: pageWidth * 0.6 });
      if (data.agency.phone) doc.text(`Tél : ${data.agency.phone}`, { width: pageWidth * 0.6 });
      if (data.agency.email) doc.text(`Email : ${data.agency.email}`, { width: pageWidth * 0.6 });
      if (data.agency.siretOrId) doc.text(`N° SIRET / NIF : ${data.agency.siretOrId}`, { width: pageWidth * 0.6 });
      const leftColumnBottomY = doc.y;

      doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .fillColor(brand)
        .text("QUITTANCE DE LOYER", doc.page.margins.left, doc.page.margins.top, {
          width: pageWidth,
          align: "right",
        });
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(gray)
        .text(`Réf : ${data.receiptNumber}`, { width: pageWidth, align: "right" })
        .text(`Période : ${periodLabel}`, { width: pageWidth, align: "right" });

      // Le bloc de droite (titre + réf) est souvent plus court que la colonne
      // agence de gauche : on repart du point le plus bas des deux colonnes
      // pour ne pas faire chevaucher le séparateur sur le texte de gauche.
      doc.y = Math.max(leftColumnBottomY, doc.y);
      doc.moveDown(1.5);
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.margins.left + pageWidth, doc.y)
        .lineWidth(1.5)
        .strokeColor(dark)
        .stroke();
      doc.moveDown(1);

      // --- Locataire / logement ---
      const boxTop = doc.y;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(gray).text("LOCATAIRE", doc.page.margins.left, boxTop, {
        width: pageWidth / 2 - 10,
      });
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(dark)
        .text(data.tenant.fullName, { width: pageWidth / 2 - 10 });
      doc.font("Helvetica").fontSize(9).fillColor(gray).text(data.tenant.email).text(data.tenant.phone);

      const rightColX = doc.page.margins.left + pageWidth / 2 + 10;
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(gray)
        .text("LOGEMENT LOUÉ", rightColX, boxTop, { width: pageWidth / 2 - 10 });
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor(dark)
        .text(data.property.title, rightColX, doc.y, { width: pageWidth / 2 - 10 });
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(gray)
        .text(data.property.address, rightColX, doc.y, { width: pageWidth / 2 - 10 })
        .text(`Surface : ${data.property.surface} m²`, rightColX, doc.y, { width: pageWidth / 2 - 10 });

      doc.y = Math.max(doc.y, boxTop + 70);
      doc.moveDown(1.2);

      // --- Attestation ---
      const statementY = doc.y;
      doc.rect(doc.page.margins.left, statementY, pageWidth, 60).fill("#eff6ff");
      doc
        .fillColor(dark)
        .font("Helvetica")
        .fontSize(10)
        .text(
          `Je soussigné, gestionnaire pour le compte du bailleur, certifie avoir reçu de ${data.tenant.fullName} la somme de ${data.invoice.amount} ${data.invoice.currency} au titre du paiement du loyer et des charges pour la période de ${periodLabel}, et lui en donne quittance sous réserve de tous droits.`,
          doc.page.margins.left + 12,
          statementY + 10,
          { width: pageWidth - 24 }
        );
      doc.y = statementY + 70;
      doc.moveDown(1);

      // --- Tableau récapitulatif ---
      const tableTop = doc.y;
      const col1 = doc.page.margins.left;
      const col2 = col1 + pageWidth * 0.4;
      const col3 = col1 + pageWidth * 0.65;
      const col4w = pageWidth * 0.35 - 10;

      doc.rect(col1, tableTop, pageWidth, 24).fill(dark);
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("Désignation", col1 + 10, tableTop + 7)
        .text("Période", col2, tableTop + 7)
        .text("Moyen de paiement", col3, tableTop + 7)
        .text("Montant", col1, tableTop + 7, { width: pageWidth - 10, align: "right" });

      const rowTop = tableTop + 24;
      doc
        .fillColor(dark)
        .font("Helvetica")
        .fontSize(9)
        .text("Loyer mensuel & charges locatives", col1 + 10, rowTop + 8, { width: col2 - col1 - 20 })
        .text(periodLabel, col2, rowTop + 8, { width: col3 - col2 - 10 })
        .text(data.invoice.paymentMethod, col3, rowTop + 8, { width: col4w })
        .font("Helvetica-Bold")
        .text(`${data.invoice.amount} ${data.invoice.currency}`, col1, rowTop + 8, {
          width: pageWidth - 10,
          align: "right",
        });

      const totalTop = rowTop + 32;
      doc
        .moveTo(col1, totalTop)
        .lineTo(col1 + pageWidth, totalTop)
        .lineWidth(1.5)
        .strokeColor(dark)
        .stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor(dark)
        .text("TOTAL REÇU :", col1, totalTop + 8, { width: pageWidth - 130, align: "right" })
        .text(`${data.invoice.amount} ${data.invoice.currency}`, col1, totalTop + 8, {
          width: pageWidth,
          align: "right",
        });

      doc.y = totalTop + 40;
      doc.moveDown(2);

      // --- Cachet ---
      const stampTop = doc.y;
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(gray)
        .text(`Fait le ${paidDateFormatted}`, col1, stampTop, { width: pageWidth * 0.55 })
        .text("Règlement validé et enregistré électroniquement.", col1, doc.y, { width: pageWidth * 0.55 });

      const stampX = col1 + pageWidth - 170;
      doc
        .roundedRect(stampX, stampTop, 170, 60, 6)
        .lineWidth(1)
        .dash(3, { space: 2 })
        .strokeColor("#059669")
        .stroke();
      doc.undash();
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#059669")
        .text("QUITTANCE VALIDÉE", stampX, stampTop + 16, { width: 170, align: "center" });
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#047857")
        .text(`LE ${paidDateFormatted}`, stampX, stampTop + 34, { width: 170, align: "center" });

      // --- Pied de page légal ---
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#94a3b8")
        .text(
          data.agency.legalNotice ||
            "Document émis et certifié conforme par le système de gestion locative immobilière.",
          doc.page.margins.left,
          doc.page.height - doc.page.margins.bottom - 40,
          { width: pageWidth, align: "center" }
        )
        .text(
          "Cette quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme.",
          doc.page.margins.left,
          doc.y,
          { width: pageWidth, align: "center" }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function generateLeaseHtml(contract: any, agency: any): string {
  const startDate = new Date(contract.startDate).toLocaleDateString("fr-FR");
  const endDate = new Date(contract.endDate).toLocaleDateString("fr-FR");

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Contrat de Bail - ${escapeHtml(contract.property?.title)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; line-height: 1.6; padding: 24px; }
    h1 { color: #0f172a; font-size: 20px; text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
    .section { margin-top: 20px; }
    .section-title { font-weight: bold; font-size: 14px; text-transform: uppercase; color: #2563eb; margin-bottom: 6px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 13px; }
    .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
    .sig-block { width: 45%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; font-size: 12px; }
    .sig-img { max-height: 60px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>CONTRAT DE BAIL D'HABITATION</h1>
  <p style="text-align:center; font-size:12px; color:#64748b;">Conforme à la législation en vigueur relative aux baux d'habitation</p>

  <div class="section">
    <div class="section-title">1. Les Parties</div>
    <div class="box">
      <strong>Le Bailleur / Mandataire :</strong> ${escapeHtml(agency.agencyName) || "L'Agence"} (${escapeHtml(agency.address)})<br>
      <strong>Le Locataire :</strong> ${escapeHtml(contract.tenant?.firstName)} ${escapeHtml(contract.tenant?.lastName)} (Email : ${escapeHtml(contract.tenant?.email)}, Tél : ${escapeHtml(contract.tenant?.phone)})
    </div>
  </div>

  <div class="section">
    <div class="section-title">2. Objet du Contrat & Désignation des Lieux</div>
    <div class="box">
      <strong>Bien loué :</strong> ${escapeHtml(contract.property?.title)}<br>
      <strong>Adresse :</strong> ${escapeHtml(contract.property?.address)}<br>
      <strong>Surface habitable :</strong> ${contract.property?.surface} m²
    </div>
  </div>

  <div class="section">
    <div class="section-title">3. Durée & Conditions Financières</div>
    <div class="box">
      <strong>Date de prise d'effet :</strong> ${startDate} | <strong>Date de fin :</strong> ${endDate}<br>
      <strong>Loyer mensuel :</strong> ${contract.rent} ${escapeHtml(contract.currency) || "EUR"} (payable mensuellement avant le 5)<br>
      <strong>Dépôt de garantie :</strong> ${contract.deposit} ${escapeHtml(contract.currency) || "EUR"}
    </div>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <strong>Pour le Bailleur / Gestionnaire :</strong>
      ${contract.signedByManagerAt ? `
        <div style="color:#059669; font-size:11px; margin-top:4px;">Signé électroniquement le ${new Date(contract.signedByManagerAt).toLocaleDateString("fr-FR")}</div>
        ${contract.managerSignatureUrl ? `<img src="${escapeHtml(contract.managerSignatureUrl)}" class="sig-img" alt="Signature Gestionnaire" />` : ""}
      ` : `<div style="color:#94a3b8; margin-top:20px;">En attente de signature</div>`}
    </div>

    <div class="sig-block">
      <strong>Le Locataire :</strong>
      ${contract.signedByTenantAt ? `
        <div style="color:#059669; font-size:11px; margin-top:4px;">Signé électroniquement le ${new Date(contract.signedByTenantAt).toLocaleDateString("fr-FR")}</div>
        ${contract.tenantSignatureUrl ? `<img src="${escapeHtml(contract.tenantSignatureUrl)}" class="sig-img" alt="Signature Locataire" />` : ""}
      ` : `<div style="color:#94a3b8; margin-top:20px;">En attente de signature</div>`}
    </div>
  </div>
</body>
</html>
  `.trim();
}

export interface InspectionExportData {
  reference: string;
  type: "ENTRY" | "EXIT";
  inspectionDate: Date | string;
  agencyName: string;
  property: { title: string; address: string };
  tenant: { fullName: string };
  rooms: Array<{ name: string; condition: "BON" | "MOYEN" | "MAUVAIS"; notes: string }>;
  meters: { electricity: string; water: string; gas: string };
  keys: Array<{ label: string; quantity: number }>;
  generalComments: string | null;
  managerSignatureUrl: string | null;
  signedByManagerAt: Date | string | null;
  tenantSignatureUrl: string | null;
  signedByTenantAt: Date | string | null;
}

const conditionLabel: Record<string, string> = { BON: "Bon état", MOYEN: "État moyen", MAUVAIS: "Mauvais état" };
const conditionColor: Record<string, string> = { BON: "#059669", MOYEN: "#d97706", MAUVAIS: "#dc2626" };

/**
 * Export HTML "certifié" de l'état des lieux (contradictoire, une fois
 * finalisé) — même principe que generateLeaseHtml : un document HTML
 * autonome, servi tel quel par document.controller.ts, imprimable/exportable
 * en PDF depuis le navigateur (voir DocumentModal.tsx côté frontend).
 */
export function generateInspectionHtml(data: InspectionExportData): string {
  const dateFormatted = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(data.inspectionDate));
  const typeLabel = data.type === "ENTRY" ? "ENTRÉE" : "SORTIE";

  const roomsRows = data.rooms.length
    ? data.rooms
        .map(
          (room) => `
      <tr>
        <td>${escapeHtml(room.name)}</td>
        <td><span style="color:${conditionColor[room.condition] || "#475569"}; font-weight:600;">${escapeHtml(conditionLabel[room.condition] || room.condition)}</span></td>
        <td>${escapeHtml(room.notes) || "—"}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="3" style="text-align:center; color:#94a3b8;">Aucune pièce renseignée</td></tr>`;

  const keysRows = data.keys.length
    ? data.keys.map((k) => `<li>${escapeHtml(k.label)} — <strong>${k.quantity}</strong></li>`).join("")
    : `<li style="color:#94a3b8;">Aucune clé renseignée</li>`;

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>État des Lieux ${escapeHtml(typeLabel)} - ${escapeHtml(data.property.title)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; line-height: 1.6; padding: 24px; }
    h1 { color: #0f172a; font-size: 20px; text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
    .subtitle { text-align:center; font-size:12px; color:#64748b; margin-top: 4px; }
    .badge { display:inline-block; background:#2563eb; color:#fff; font-weight:700; font-size:11px; letter-spacing:0.05em; padding: 3px 10px; border-radius: 999px; margin-top: 8px; }
    .section { margin-top: 20px; }
    .section-title { font-weight: bold; font-size: 14px; text-transform: uppercase; color: #2563eb; margin-bottom: 6px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th { background: #0f172a; color: #fff; text-align: left; padding: 8px 10px; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    ul { margin: 4px 0; padding-left: 18px; font-size: 13px; }
    .meters-grid { display: flex; gap: 16px; }
    .meter-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; text-align: center; }
    .meter-label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600; }
    .meter-value { font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    .signatures { display: flex; justify-content: space-between; margin-top: 32px; }
    .sig-block { width: 45%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; font-size: 12px; }
    .sig-img { max-height: 60px; margin-top: 8px; }
    .stamp-certified { display:inline-block; margin-top: 16px; color: #059669; font-weight: 700; border: 1px dashed #059669; background: #ecfdf5; border-radius: 8px; padding: 8px 16px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>ÉTAT DES LIEUX</h1>
  <p class="subtitle">Constat contradictoire établi entre le bailleur (ou son mandataire) et le locataire</p>
  <p style="text-align:center;"><span class="badge">${escapeHtml(typeLabel)}</span></p>

  <div class="section">
    <div class="section-title">1. Les Parties & le Bien</div>
    <div class="box">
      <strong>Agence / Mandataire :</strong> ${escapeHtml(data.agencyName)}<br>
      <strong>Locataire :</strong> ${escapeHtml(data.tenant.fullName)}<br>
      <strong>Bien :</strong> ${escapeHtml(data.property.title)} — ${escapeHtml(data.property.address)}<br>
      <strong>Date du constat :</strong> ${dateFormatted}<br>
      <strong>Référence :</strong> ${escapeHtml(data.reference)}
    </div>
  </div>

  <div class="section">
    <div class="section-title">2. Relevé des Compteurs</div>
    <div class="meters-grid">
      <div class="meter-box"><div class="meter-label">Électricité</div><div class="meter-value">${escapeHtml(data.meters.electricity) || "—"}</div></div>
      <div class="meter-box"><div class="meter-label">Eau</div><div class="meter-value">${escapeHtml(data.meters.water) || "—"}</div></div>
      <div class="meter-box"><div class="meter-label">Gaz</div><div class="meter-value">${escapeHtml(data.meters.gas) || "—"}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">3. Constat Pièce par Pièce</div>
    <table>
      <thead><tr><th>Pièce</th><th>État</th><th>Observations</th></tr></thead>
      <tbody>${roomsRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">4. Clés & Accès Remis</div>
    <ul>${keysRows}</ul>
  </div>

  ${
    data.generalComments
      ? `<div class="section">
    <div class="section-title">5. Observations Générales</div>
    <div class="box">${escapeHtml(data.generalComments)}</div>
  </div>`
      : ""
  }

  <div class="signatures">
    <div class="sig-block">
      <strong>Pour le Bailleur / Gestionnaire :</strong>
      ${data.signedByManagerAt ? `
        <div style="color:#059669; font-size:11px; margin-top:4px;">Signé électroniquement le ${new Date(data.signedByManagerAt).toLocaleDateString("fr-FR")}</div>
        ${data.managerSignatureUrl ? `<img src="${escapeHtml(data.managerSignatureUrl)}" class="sig-img" alt="Signature Gestionnaire" />` : ""}
      ` : `<div style="color:#94a3b8; margin-top:20px;">En attente de signature</div>`}
    </div>

    <div class="sig-block">
      <strong>Le Locataire :</strong>
      ${data.signedByTenantAt ? `
        <div style="color:#059669; font-size:11px; margin-top:4px;">Signé électroniquement le ${new Date(data.signedByTenantAt).toLocaleDateString("fr-FR")}</div>
        ${data.tenantSignatureUrl ? `<img src="${escapeHtml(data.tenantSignatureUrl)}" class="sig-img" alt="Signature Locataire" />` : ""}
      ` : `<div style="color:#94a3b8; margin-top:20px;">En attente de signature</div>`}
    </div>
  </div>

  ${
    data.signedByManagerAt && data.signedByTenantAt
      ? `<p style="text-align:center;"><span class="stamp-certified">✅ ÉTAT DES LIEUX SIGNÉ CONTRADICTOIREMENT</span></p>`
      : ""
  }
</body>
</html>
  `.trim();
}

export interface CrgPropertyLine {
  propertyId: string;
  propertyTitle: string;
  currency: string;
  loyersEncaisses: number;
  chargesDeduites: number;
  commission: number;
  netAReverser: number;
}

export interface CrgExportData {
  agencyName: string;
  ownerName: string;
  ownerCompanyName?: string | null;
  iban?: string | null;
  bic?: string | null;
  managementFeeRate: number;
  month: number;
  year: number;
  properties: CrgPropertyLine[];
  totalLoyersByCurrency: Record<string, number>;
  totalChargesByCurrency: Record<string, number>;
  totalCommissionByCurrency: Record<string, number>;
  totalNetByCurrency: Record<string, number>;
}

/**
 * Export HTML du Compte-Rendu de Gestion (CRG) mensuel d'un propriétaire —
 * même principe que generateInspectionHtml/generateReceiptHtml : un document
 * HTML autonome, servi tel quel par crg.controller.ts, imprimable/exportable
 * en PDF depuis le navigateur. Contrairement au Bilan Fiscal (point de vue du
 * gestionnaire, revenus moins charges), le CRG ajoute la commission d'agence
 * et le net à reverser au propriétaire, et ne couvre qu'un seul propriétaire
 * à la fois (pas toute l'agence).
 *
 * Une ligne par bien du propriétaire est toujours affichée, y compris un bien
 * sans aucune activité ce mois-ci (loyers/charges à 0) — le propriétaire doit
 * pouvoir constater l'absence d'encaissement, pas seulement l'ignorer.
 */
export function generateCrgHtml(data: CrgExportData): string {
  const periodLabel = `${monthNames[data.month - 1]} ${data.year}`;
  const generatedDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date());

  const propertyRows = data.properties.length
    ? data.properties
        .map(
          (p) => `
      <tr>
        <td>${escapeHtml(p.propertyTitle)}</td>
        <td style="text-align:right;">${p.loyersEncaisses} ${escapeHtml(p.currency)}</td>
        <td style="text-align:right;">${p.chargesDeduites} ${escapeHtml(p.currency)}</td>
        <td style="text-align:right;">${p.commission} ${escapeHtml(p.currency)}</td>
        <td style="text-align:right; font-weight:700;">${p.netAReverser} ${escapeHtml(p.currency)}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" style="text-align:center; color:#94a3b8;">Aucun bien rattaché à ce propriétaire</td></tr>`;

  const currencies = Array.from(
    new Set([
      ...Object.keys(data.totalLoyersByCurrency),
      ...Object.keys(data.totalChargesByCurrency),
      ...Object.keys(data.totalCommissionByCurrency),
      ...Object.keys(data.totalNetByCurrency),
    ])
  ).sort();

  const totalRows = currencies.length
    ? currencies
        .map(
          (currency) => `
      <tr class="total-row">
        <td>Total ${escapeHtml(currency)}</td>
        <td style="text-align:right;">${data.totalLoyersByCurrency[currency] ?? 0} ${escapeHtml(currency)}</td>
        <td style="text-align:right;">${data.totalChargesByCurrency[currency] ?? 0} ${escapeHtml(currency)}</td>
        <td style="text-align:right;">${data.totalCommissionByCurrency[currency] ?? 0} ${escapeHtml(currency)}</td>
        <td style="text-align:right;">${data.totalNetByCurrency[currency] ?? 0} ${escapeHtml(currency)}</td>
      </tr>`
        )
        .join("")
    : "";

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Compte-Rendu de Gestion - ${escapeHtml(periodLabel)} - ${escapeHtml(data.ownerName)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; line-height: 1.6; padding: 24px; }
    h1 { color: #0f172a; font-size: 20px; text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
    .subtitle { text-align:center; font-size:12px; color:#64748b; margin-top: 4px; }
    .section { margin-top: 20px; }
    .section-title { font-weight: bold; font-size: 14px; text-transform: uppercase; color: #2563eb; margin-bottom: 6px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th { background: #0f172a; color: #fff; text-align: left; padding: 8px 10px; }
    th.num, td.num { text-align: right; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .total-row td { font-weight: 700; background: #f1f5f9; border-top: 2px solid #0f172a; }
    .footer-legal { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <h1>COMPTE-RENDU DE GESTION</h1>
  <p class="subtitle">Période : ${escapeHtml(periodLabel)}</p>

  <div class="section">
    <div class="section-title">Propriétaire</div>
    <div class="box">
      <strong>Agence / Mandataire :</strong> ${escapeHtml(data.agencyName)}<br>
      <strong>Propriétaire :</strong> ${escapeHtml(data.ownerName)}${data.ownerCompanyName ? ` (${escapeHtml(data.ownerCompanyName)})` : ""}<br>
      <strong>Taux de commission :</strong> ${data.managementFeeRate}%
    </div>
  </div>

  <div class="section">
    <div class="section-title">Détail par bien</div>
    <table>
      <thead>
        <tr>
          <th>Bien</th>
          <th class="num">Loyers encaissés</th>
          <th class="num">Charges déduites</th>
          <th class="num">Commission</th>
          <th class="num">Net à reverser</th>
        </tr>
      </thead>
      <tbody>${propertyRows}${totalRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Coordonnées bancaires du propriétaire</div>
    <div class="box">
      ${
        data.iban
          ? `<strong>IBAN :</strong> ${escapeHtml(data.iban)}<br>${data.bic ? `<strong>BIC :</strong> ${escapeHtml(data.bic)}` : ""}`
          : `<span style="color:#94a3b8;">Aucune coordonnée bancaire renseignée pour ce propriétaire.</span>`
      }
    </div>
  </div>

  <div class="footer-legal">Document généré le ${escapeHtml(generatedDate)} — Compte-rendu de gestion à valeur informative, établi pour le compte du propriétaire.</div>
</body>
</html>
  `.trim();
}
