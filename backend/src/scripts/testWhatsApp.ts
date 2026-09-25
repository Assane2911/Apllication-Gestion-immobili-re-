/**
 * Envoie un rappel de loyer WhatsApp de test (données factices) vers un
 * numéro donné, via les templates Meta déjà approuvés — pour vérifier que
 * META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID sont valides
 * sans attendre le prochain cron ni créer de vraie facture. N'écrit rien en
 * base.
 *
 *   npm run test-whatsapp -- +221771234567
 *   npm run test-whatsapp -- +221771234567 rent-due-soon
 */
import { env } from "../config/env";
import { rentDueSoonTemplateParams, rentDueTemplateParams, sendWhatsAppTemplate } from "../services/whatsapp.service";

async function main() {
  const [, , to, kind = "rent-due"] = process.argv;

  if (!to) {
    console.error("Usage : npm run test-whatsapp -- <numero_E.164> [rent-due|rent-due-soon]");
    process.exit(1);
  }
  if (kind !== "rent-due" && kind !== "rent-due-soon") {
    console.error('Le second argument doit être "rent-due" ou "rent-due-soon".');
    process.exit(1);
  }

  const sampleData = {
    tenantName: "Test Locataire",
    propertyTitle: "Appartement Test",
    amount: 35000,
    currency: "XOF",
    periodMonth: new Date().getMonth() + 1,
    periodYear: new Date().getFullYear(),
    paymentUrl: `${env.frontendUrl}/portail/paiements`,
  };

  const templateName = kind === "rent-due-soon" ? env.whatsapp.templateRentDueSoon : env.whatsapp.templateRentDue;
  const parameters =
    kind === "rent-due-soon"
      ? rentDueSoonTemplateParams({ ...sampleData, daysLeft: 3 })
      : rentDueTemplateParams(sampleData);

  console.log(`Envoi du template "${templateName}" (langue: ${env.whatsapp.templateLanguage}) vers ${to}...`);
  console.log("Paramètres:", parameters);

  const result = await sendWhatsAppTemplate(to, templateName, parameters);

  if (result.simulated) {
    console.warn(
      "⚠️  Envoi SIMULÉ (pas de vraie requête) — META_WHATSAPP_ACCESS_TOKEN et/ou META_WHATSAPP_PHONE_NUMBER_ID " +
        "sont absents de l'environnement courant. Lancez `vercel env pull backend/.env` puis relancez ce script."
    );
    process.exit(0);
  }
  if (result.error) {
    console.error("❌ Échec de l'envoi — voir le détail de l'erreur ci-dessus.");
    process.exit(1);
  }

  console.log(`✅ Message envoyé (id Meta: ${result.messageId}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erreur inattendue :", err);
  process.exit(1);
});
