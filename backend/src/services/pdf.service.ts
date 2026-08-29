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
  <title>Quittance de Loyer - N° ${data.receiptNumber}</title>
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
      <h1 class="agency-title">${data.agency.name}</h1>
      <div class="agency-info">
        ${data.agency.address ? `<p style="margin:2px 0;">${data.agency.address}</p>` : ""}
        ${data.agency.phone ? `<p style="margin:2px 0;">Tél : ${data.agency.phone}</p>` : ""}
        ${data.agency.email ? `<p style="margin:2px 0;">Email : ${data.agency.email}</p>` : ""}
        ${data.agency.siretOrId ? `<p style="margin:2px 0;">N° SIRET / NIF : ${data.agency.siretOrId}</p>` : ""}
      </div>
    </div>
    <div class="doc-badge">
      <h2 class="doc-title">QUITTANCE DE LOYER</h2>
      <div class="doc-ref">RÉF : ${data.receiptNumber}</div>
      <div style="font-size:12px; margin-top:4px; color:#475569;">Période : <strong>${periodLabel}</strong></div>
    </div>
  </div>

  <div class="tenant-box">
    <div>
      <div style="font-size:11px; text-transform:uppercase; color:#64748b; font-weight:600;">Locataire</div>
      <div style="font-size:15px; font-weight:700; color:#0f172a; margin-top:2px;">${data.tenant.fullName}</div>
      <div class="tenant-info" style="margin-top:4px;">
        <div>${data.tenant.email}</div>
        <div>${data.tenant.phone}</div>
      </div>
    </div>
    <div>
      <div style="font-size:11px; text-transform:uppercase; color:#64748b; font-weight:600;">Logement Loué</div>
      <div style="font-size:14px; font-weight:600; color:#0f172a; margin-top:2px;">${data.property.title}</div>
      <div class="tenant-info" style="margin-top:2px;">${data.property.address}</div>
      <div class="tenant-info">Surface : ${data.property.surface} m²</div>
    </div>
  </div>

  <div class="main-statement">
    Je soussigné, gestionnaire pour le compte du bailleur, certifie avoir reçu de <strong>${data.tenant.fullName}</strong>
    la somme de <strong>${data.invoice.amount} ${data.invoice.currency}</strong> au titre du paiement du loyer et des charges pour la période du mois de <strong>${periodLabel}</strong>, et lui en donne quittance sous réserve de tous droits.
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
        <td>${data.invoice.paymentMethod}</td>
        <td style="text-align:right; font-weight:600;">${data.invoice.amount} ${data.invoice.currency}</td>
      </tr>
      <tr class="total-row">
        <td colspan="3" style="text-align:right;">TOTAL REÇU :</td>
        <td style="text-align:right;">${data.invoice.amount} ${data.invoice.currency}</td>
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
    ${data.agency.legalNotice || "Document émis et certifié conforme par le système de gestion locative immobilière."}
    <br>Cette quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme.
  </div>
</body>
</html>
  `.trim();
}

export function generateLeaseHtml(contract: any, agency: any): string {
  const startDate = new Date(contract.startDate).toLocaleDateString("fr-FR");
  const endDate = new Date(contract.endDate).toLocaleDateString("fr-FR");

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Contrat de Bail - ${contract.property?.title}</title>
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
      <strong>Le Bailleur / Mandataire :</strong> ${agency.agencyName || "L'Agence"} (${agency.address || ""})<br>
      <strong>Le Locataire :</strong> ${contract.tenant?.firstName} ${contract.tenant?.lastName} (Email : ${contract.tenant?.email}, Tél : ${contract.tenant?.phone})
    </div>
  </div>

  <div class="section">
    <div class="section-title">2. Objet du Contrat & Désignation des Lieux</div>
    <div class="box">
      <strong>Bien loué :</strong> ${contract.property?.title}<br>
      <strong>Adresse :</strong> ${contract.property?.address}<br>
      <strong>Surface habitable :</strong> ${contract.property?.surface} m²
    </div>
  </div>

  <div class="section">
    <div class="section-title">3. Durée & Conditions Financières</div>
    <div class="box">
      <strong>Date de prise d'effet :</strong> ${startDate} | <strong>Date de fin :</strong> ${endDate}<br>
      <strong>Loyer mensuel :</strong> ${contract.rent} ${contract.currency || "EUR"} (payable mensuellement avant le 5)<br>
      <strong>Dépôt de garantie :</strong> ${contract.deposit} ${contract.currency || "EUR"}
    </div>
  </div>

  <div class="signatures">
    <div class="sig-block">
      <strong>Pour le Bailleur / Gestionnaire :</strong>
      ${contract.signedByManagerAt ? `
        <div style="color:#059669; font-size:11px; margin-top:4px;">Signé électroniquement le ${new Date(contract.signedByManagerAt).toLocaleDateString("fr-FR")}</div>
        ${contract.managerSignatureUrl ? `<img src="${contract.managerSignatureUrl}" class="sig-img" alt="Signature Gestionnaire" />` : ""}
      ` : `<div style="color:#94a3b8; margin-top:20px;">En attente de signature</div>`}
    </div>

    <div class="sig-block">
      <strong>Le Locataire :</strong>
      ${contract.signedByTenantAt ? `
        <div style="color:#059669; font-size:11px; margin-top:4px;">Signé électroniquement le ${new Date(contract.signedByTenantAt).toLocaleDateString("fr-FR")}</div>
        ${contract.tenantSignatureUrl ? `<img src="${contract.tenantSignatureUrl}" class="sig-img" alt="Signature Locataire" />` : ""}
      ` : `<div style="color:#94a3b8; margin-top:20px;">En attente de signature</div>`}
    </div>
  </div>
</body>
</html>
  `.trim();
}
