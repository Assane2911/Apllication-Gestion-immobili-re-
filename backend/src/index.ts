import { app } from "./app";
import { env } from "./config/env";
import { scheduleContractEndingReminders } from "./services/reminder.service";

// La mise à jour du schéma (initDb()) n'est plus appelée ici : elle est
// déclenchée par app.ts lui-même, à la première requête reçue (voir le
// commentaire à ce sujet dans app.ts). Ce fichier n'est de toute façon
// jamais exécuté en production (voir app.ts) — le seul y ajouter aurait
// recréé exactement l'écart entre local et prod qui a causé l'incident.
app.listen(env.port, () => {
  console.log(`✅ API gestion immobilière démarrée sur http://localhost:${env.port}`);

  if (env.enableInternalCron) {
    scheduleContractEndingReminders();
  }
});
