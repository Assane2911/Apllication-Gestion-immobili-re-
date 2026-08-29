import { app } from "./app";
import { env } from "./config/env";
import { initDb } from "./db/init";
import { scheduleContractEndingReminders } from "./services/reminder.service";

async function bootstrap() {
  await initDb();

  app.listen(env.port, () => {
    console.log(`✅ API gestion immobilière démarrée sur http://localhost:${env.port}`);

    if (env.enableInternalCron) {
      scheduleContractEndingReminders();
    }
  });
}

bootstrap().catch((err) => {
  console.error("Erreur fatale au démarrage :", err);
});
