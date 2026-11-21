# Guide de déploiement : Antigravity → Supabase → Vercel

Ce guide suit exactement le chemin demandé : relire le projet dans **Google Antigravity** pour le contextualiser avant de le modifier, stocker les données sur **Supabase** (base Postgres + fichiers), puis héberger l'application sur **Vercel**.

L'application a déjà été adaptée pour cette cible : base de données Postgres (Drizzle ORM), fichiers uploadés sur Supabase Storage, et rappels automatiques via un Vercel Cron Job plutôt qu'un processus en continu (Vercel ne fait tourner que des fonctions à la demande, sans serveur permanent).

---

## Étape 1 — Ouvrir le projet dans Antigravity

Antigravity est une application de bureau (Windows/macOS/Linux) : ce travail se fait sur votre ordinateur.

1. Installez Antigravity depuis [antigravity.google](https://antigravity.google) si ce n'est pas déjà fait.
2. Récupérez le projet : clonez le dépôt GitHub `Apllication-Gestion-immobili-re-` (`git clone`), ou téléchargez-le en ZIP depuis GitHub (*Code → Download ZIP*) puis décompressez-le.
3. Dans Antigravity : cliquez sur l'icône dossier **+** dans la barre latérale → **New Project** → **Add Folder** → sélectionnez le dossier du projet (celui qui contient `backend/` et `frontend/`) → **Create**.
4. Laissez l'agent indexer le projet, puis posez-lui des questions pour vous approprier le code avant de le modifier ou de le déployer, par exemple :
   - *"Explique-moi l'architecture du backend et comment les rôles gestionnaire/locataire sont séparés."*
   - *"Où est gérée la génération automatique des factures de loyer ?"*
   - *"Montre-moi le flux complet d'un paiement de loyer, du frontend jusqu'à la base de données."*
   - *"Vérifie qu'aucun secret n'est en dur dans le code avant de déployer."*

Une fois à l'aise avec le code (ou après d'éventuels ajustements faits dans Antigravity), passez à Supabase.

---

## Étape 2 — Créer le projet Supabase

### 2.1 Créer le projet

1. Allez sur [supabase.com](https://supabase.com) → **New Project**.
2. Choisissez une organisation, un nom (ex: `gestion-immo`), un mot de passe de base de données (notez-le précieusement), et une région proche de vos utilisateurs.
3. Attendez la fin du provisioning (~2 minutes).

### 2.2 Récupérer la chaîne de connexion à la base de données

1. **Project Settings → Database → Connection string**.
2. Sélectionnez l'onglet **Transaction pooler** (port **6543**) — c'est le mode recommandé pour un environnement serverless comme Vercel (connexions courtes et nombreuses ; le mode direct/port 5432 est réservé aux serveurs permanents).
3. Copiez l'URL, remplacez `[YOUR-PASSWORD]` par le mot de passe choisi à l'étape précédente. Cette valeur ira dans `DATABASE_URL`.

### 2.3 Récupérer les clés API

**Project Settings → API** :
- `Project URL` → variable `SUPABASE_URL`
- `service_role` (⚠️ secret, ne jamais exposer côté frontend) → variable `SUPABASE_SERVICE_ROLE_KEY`

### 2.4 Créer les deux buckets de stockage

**Storage → New bucket**, à créer deux fois :

| Nom du bucket | Public ? | Contenu |
|---|---|---|
| `public-uploads` | ✅ Oui (cochez "Public bucket") | Photos des biens, photos d'incidents |
| `private-uploads` | ❌ Non (laissez privé) | Pièces d'identité des locataires |

Aucune policy RLS supplémentaire n'est nécessaire : le backend utilise exclusivement la clé `service_role`, qui contourne les policies. Les fichiers du bucket privé ne sont jamais accessibles directement — le backend génère une URL signée à durée limitée à la demande (voir `GET /api/tenants/:id/id-document-url`).

### 2.5 Appliquer le schéma et les données de démonstration

Dans `backend/.env` (copié depuis `.env.example`), renseignez `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, puis :

```bash
cd backend
npm install
npm run db:push   # crée les tables dans votre base Supabase
```

> ⚠️ **Ne lancez pas `npm run seed` sur cette base.** Le seed crée des comptes de
> démonstration destinés au développement local. Lancé sur la base Supabase, il y
> crée des comptes accessibles depuis l'application déployée — c'est exactement ce
> qui s'est produit, et deux comptes de démonstration se sont retrouvés en
> production avec un mot de passe alors écrit en clair dans le dépôt.
>
> Le script refuse désormais toute base non locale, et génère un mot de passe
> aléatoire affiché une seule fois (voir `refusDeSeed` dans `backend/src/seed.ts`).
> Pour peupler une base **locale** : pointez `DATABASE_URL` sur `localhost`, puis
> `npm run seed`.

---

## Étape 3 — Déployer sur Vercel

Ce projet est un monorepo avec deux applications (`backend/` et `frontend/`) : créez **deux projets Vercel séparés** pointant vers le même dépôt GitHub, chacun avec un "Root Directory" différent.

> **Économie de constructions** : chaque dossier porte, dans son `vercel.json`, une `ignoreCommand` (`git cat-file -e ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}^{commit} 2>/dev/null || exit 1; git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- .`). Vercel l'exécute dans le Root Directory du projet avant de construire : si rien n'a changé dans ce dossier depuis le dernier déploiement réussi de la branche, la construction est ignorée (code de sortie 0). Un commit qui ne touche que `frontend/` ne reconstruit donc pas le backend, et inversement ; un commit de réalignement sans changement de contenu ne reconstruit rien. Si le commit de comparaison est introuvable dans le clone (cas d'un réalignement de branche après une fusion en squash : l'ancien commit n'existe plus), la première partie sort avec le code 1 et la construction a lieu. Il faut y veiller : `git diff` seul sortirait avec le code 128, que Vercel traite comme une erreur et non comme « construire » (déploiement marqué en erreur sans construction). On construit de trop plutôt que pas assez.

> **Changer une variable d'environnement du backend ne suffit pas** : Vercel ne la lit qu'au démarrage d'un nouveau déploiement, et un « Redeploy » d'un commit déjà construit est annulé par l'`ignoreCommand` ci-dessus (« Ignored Build Step »). Pour qu'une variable prenne effet, fusionnez un commit qui touche `backend/`, puis vérifiez que le déploiement de production est READY.

### 3.1 Déployer le backend

1. Sur [vercel.com](https://vercel.com) → **Add New → Project** → importez le dépôt GitHub `Apllication-Gestion-immobili-re-`.
2. **Root Directory** : `backend`.
3. Vercel détecte automatiquement Express (zero-config).
4. Renseignez les variables d'environnement (Project Settings → Environment Variables) — reprenez tout `backend/.env.example`, notamment :
   - `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLIC_BUCKET`, `SUPABASE_PRIVATE_BUCKET`
   - `JWT_SECRET` (générez une vraie valeur aléatoire, différente de celle de dev : `openssl rand -base64 48`). Une valeur de moins de 32 caractères, ou le texte d'exemple de `.env.example`, est signalée dans les journaux et dans Sentry (« JWT_SECRET est faible ») à chaque démarrage, sans empêcher l'application de tourner : quiconque connaît le secret peut fabriquer un jeton de connexion, y compris administrateur. Pour le changer, mettez la nouvelle valeur dans Vercel et redéployez ; tous les utilisateurs devront se reconnecter.
   - `PAYMENTS_DEMO_MODE` : **ne le définissez pas** (ou mettez `false`). Sur un déploiement (Vercel, `NODE_ENV=production`) le mode démo n'existe pas : `PAYMENTS_DEMO_MODE=true` y est **ignoré** et signalé au démarrage (journal et Sentry : « PAYMENTS_DEMO_MODE=true a été IGNORÉ »), car l'activer rendrait tout paiement « réussi » sans qu'un centime ne soit encaissé — un abonnement s'activerait gratuitement. Si ce message apparaît, supprimez la variable de Vercel (Production et Preview). C'est pourquoi `backend/.env.example` le livre en commentaire.
   - `RENT_ONLINE_PAYMENTS` : laissez `false` (voir le `README`, section Paiements).
   - `PAYMENT_KEYS_ENCRYPTION_KEY` : clé qui chiffre les identifiants PayDunya de chaque agence (loyers payés en ligne sur le compte de l'agence). Générez-la une fois (`openssl rand -hex 32`) et **ne la changez plus** : les identifiants déjà enregistrés deviendraient illisibles. Tant qu'elle est absente, l'agence ne peut pas enregistrer de compte et le paiement du loyer en ligne reste fermé.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `EMAIL_FROM`, `CONTRACT_REMINDER_DAYS`
   - `CRON_SECRET` : générez une valeur aléatoire (16+ caractères) — Vercel l'enverra automatiquement en en-tête `Authorization` lors de l'appel du Cron Job
   - `ENABLE_INTERNAL_CRON=false` (important : sur Vercel, le scheduler interne node-cron ne doit pas tourner — ce sont les Vercel Cron Jobs déclarés dans `backend/vercel.json` qui appellent `/api/cron/daily` chaque jour et `/api/cron/rent-due-reminders` le 1er du mois)
   - `CRON_BUDGET_SECONDS` (facultatif, 240 par défaut) : temps qu'une route cron s'autorise avant de s'arrêter d'elle-même. Vercel tue une fonction au-delà de sa durée maximale (300 s par défaut) ; en s'arrêtant avant, la tâche laisse le reliquat non réclamé, et l'exécution du lendemain le reprend. À augmenter seulement de pair avec `maxDuration`.
   - `FRONTEND_URL` : à renseigner une fois le frontend déployé (étape suivante), pour l'autorisation CORS
5. Déployez. Notez l'URL générée (ex: `https://gestion-immo-api.vercel.app`).
6. Une fois déployé, vérifiez dans **Project Settings → Cron Jobs** que les deux tâches de `backend/vercel.json` apparaissent, planifiées : `/api/cron/daily` (`0 8 * * *`, chaque jour à 08 h UTC) et `/api/cron/rent-due-reminders` (`0 8 1 * *`, le 1er du mois). La route `/api/cron/contract-reminders` existe encore, mais Vercel ne l'appelle pas : la tâche quotidienne couvre le rappel de fin de bail.

> **Région d'exécution** : `backend/vercel.json` fixe `"regions": ["cdg1"]` (Paris), la même région que la base Supabase (`eu-west-3`, Paris). Sans ce réglage, Vercel exécute les fonctions dans sa région par défaut (`iad1`, côte Est des États-Unis) : chaque requête SQL traverse l'Atlantique, et une page qui en enchaîne plusieurs attend cet aller-retour à chaque fois. **Si vous créez ou déplacez le projet Supabase dans une autre région, changez `regions` en conséquence** (Paris `cdg1`, Francfort `fra1`, Londres `lhr1`, Dublin `dub1`, Virginie `iad1`, San Francisco `sfo1`…) : la fonction doit rester à côté de la base. Une seule région est voulue ici, car la base n'est qu'à Paris : une fonction ailleurs ne ferait qu'ajouter de la distance. Le plan gratuit (Hobby) n'en accepte d'ailleurs qu'une seule ; le plan Pro, celui du projet de production, en accepte plusieurs. Le frontend (fichiers statiques) est servi depuis tous les points de présence et n'est pas concerné.

> **Tâches planifiées (Cron Jobs)** : sur le plan gratuit (Hobby), elles sont limitées à une exécution par jour, avec une précision "dans l'heure" (ex: `0 8 * * *` peut se déclencher entre 8h00 et 8h59). Le plan Pro, celui du projet de production, n'a pas cette limite ; les tâches de `vercel.json` (une par jour, une par mois) tiennent de toute façon dans les deux plans.

### 3.2 Déployer le frontend

1. **Add New → Project** → même dépôt GitHub, mais **Root Directory** : `frontend`.
2. Vercel détecte automatiquement Vite (zero-config).
3. Variable d'environnement : `VITE_API_URL` = l'URL du backend déployé à l'étape 3.1 (ex: `https://gestion-immo-api.vercel.app`).
   **Production : mettez le backend sur un sous-domaine du site** (ex. `https://api.immoplatformpro.com`, à ajouter au projet backend dans *Settings → Domains*), et non sur son adresse `*.vercel.app`. La session voyage dans un cookie ; sur un autre domaine que le site, ce cookie est un cookie « tiers » que la navigation privée, Safari (donc tous les iPhone), Firefox en protection stricte et Brave refusent : la connexion semble réussir puis renvoie à la page de connexion. Sur un sous-domaine du même site, le cookie est accepté partout. Gardez l'adresse `*.vercel.app` pour les aperçus (variable `VITE_API_URL` limitée à *Preview*).
4. Déployez. Notez l'URL générée (ex: `https://gestion-immo.vercel.app`).

### 3.3 Boucler la boucle CORS

Retournez dans les variables d'environnement du **projet backend** sur Vercel et mettez à jour `FRONTEND_URL` avec l'URL du frontend déployé, puis faites construire un **vrai** déploiement du backend pour que le changement prenne effet. Ne vous contentez pas de *Deployments → Redeploy* : Vercel l'annule (« Ignored Build Step », voir l'avertissement au début de l'étape 3) quand rien n'a changé dans `backend/` depuis le dernier déploiement, et l'ancienne valeur reste alors en service sans que rien ne le dise. Poussez un commit qui touche `backend/` (même un commentaire), fusionnez-le, puis vérifiez que le déploiement de production est **READY** (et non CANCELED) sur ce commit.

---

## Étape 4 — Vérifications post-déploiement

- `https://votre-backend.vercel.app/api/health` → doit répondre `{"status":"ok"}`.
- `https://votre-backend.vercel.app/api/health/ready` → doit répondre `{"status":"ok"}` (200) : celle-ci interroge aussi la base. Voir « Surveillance de la disponibilité ».
- Connectez-vous sur le frontend déployé avec un compte gestionnaire créé via `POST /api/auth/register` (le `seed` ne tourne jamais en production : il refuse l'environnement de production et toute base distante).
- **Vérifiez que le mode démo des paiements est bien désactivé** : connecté, `GET /api/payments/methods` ne doit **pas** lister `DEMO`. S'il y figure, le code n'est pas à jour (le mode démo est ignoré sur un déploiement) : redéployez. Une variable `PAYMENTS_DEMO_MODE=true` restée sur Vercel est sans effet mais signalée : supprimez-la. Pour essayer le flux de paiement de bout en bout, faites-le **en local** (le mode démo y est actif par défaut) ou avec les clés de test du prestataire (Stripe en mode test, `PAYDUNYA_MODE=test`), jamais en activant le mode démo sur le déploiement.
- Testez manuellement les tâches planifiées avant d'attendre le lendemain — `interrompu: true` dans la réponse signale que le budget de temps a été atteint et qu'un reliquat sera repris à l'exécution suivante :
  ```bash
  curl -H "Authorization: Bearer VOTRE_CRON_SECRET" https://votre-backend.vercel.app/api/cron/daily
  ```
- Vérifiez dans Supabase → Storage que les fichiers uploadés (image d'un bien, photo d'incident) apparaissent bien dans `public-uploads`.

---

## Référence des variables d'environnement, par thème

La liste de référence, avec tous les commentaires, reste `backend/.env.example` et `frontend/.env.example` (un test vérifie qu'elle suit le code, et que ce guide cite chaque variable). Voici la même liste rangée par thème. Sur Vercel, posez en **« sensible »** tout ce qui est un secret (mot de passe, clé, jeton), et pour *Production* seulement quand la valeur ne sert pas aux aperçus. Une variable ne s'applique qu'à un **nouveau** déploiement (voir l'avertissement de l'étape 3).

**Injectées par Vercel, à ne jamais définir à la main :** `VERCEL`, `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL`.

### Serveur et adresses (backend)

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `PORT` | port d'écoute en local | `4000` ; sans effet sur Vercel |
| `NODE_ENV` | environnement d'exécution | `development` en local ; `production` sur un déploiement |
| `FRONTEND_URL` | adresse du frontend, autorisée par CORS | **obligatoire** en production |
| `PUBLIC_BACKEND_URL` | adresse publique du backend, pour les retours des prestataires de paiement | vide sur Vercel (`VERCEL_PROJECT_PRODUCTION_URL` fait l'affaire) |

### Base de données

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `DATABASE_URL` | chaîne de connexion Supabase, **Transaction pooler** (port 6543) | **obligatoire**, sensible |
| `DB_DELAI_REQUETE_MS` | délai au-delà duquel une requête est tenue pour bloquée | `15000` ; ne changer qu'en cas de besoin constaté |
| `DB_DELAI_TRANSACTION_MS` | idem pour une transaction entière | `120000` |
| `PREVIEW_DB_MIGRATIONS` | un aperçu Vercel met-il le schéma à jour ? | `false` ; `true` seulement si l'aperçu a **sa propre** base, jamais sur celle de production |

### Données de démonstration (local uniquement)

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `SEED_ALLOW_REMOTE` | autorise `npm run seed` sur une base non locale | jamais sur la base de production (voir l'avertissement de l'étape 2.5) |
| `SEED_PASSWORD` | mot de passe des comptes de démonstration | sans elle, un mot de passe aléatoire est généré et affiché une seule fois |

### Stockage de fichiers (Supabase)

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `SUPABASE_URL` | adresse du projet Supabase | **obligatoire** |
| `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role`, utilisée par le backend seul | **obligatoire**, sensible, jamais côté frontend |
| `SUPABASE_PUBLIC_BUCKET` | bucket public (photos de biens, d'incidents) | `public-uploads` |
| `SUPABASE_PRIVATE_BUCKET` | bucket privé (pièces d'identité) | `private-uploads` |

### Authentification et sécurité

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `JWT_SECRET` | signe les jetons de connexion | **obligatoire**, sensible, 32 caractères au minimum |
| `JWT_EXPIRES_IN` | durée de validité d'un jeton de connexion | `7d` |
| `TOTP_ENCRYPTION_KEY` | chiffre les secrets de double authentification | recommandée, sensible ; voir « Chiffrement du secret de double authentification » |
| `GOOGLE_CLIENT_ID` | connexion avec Google (gestionnaires) | vide : route désactivée ; doit correspondre à `VITE_GOOGLE_CLIENT_ID` |

### E-mail (SMTP)

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | serveur d'envoi | voir « Délivrabilité des e-mails » ; le défaut du code (Gmail) ne convient qu'en local |
| `SMTP_USER` | boîte d'envoi | |
| `SMTP_APP_PASSWORD` | mot de passe **d'application** | sensible |
| `EMAIL_FROM` | expéditeur | même adresse que `SMTP_USER` |

### Rappels et tâches planifiées

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `CRON_SECRET` | authentifie les appels des tâches planifiées | **obligatoire**, sensible ; identique sur Vercel (que Vercel envoie en `Authorization`) |
| `ENABLE_INTERNAL_CRON` | planificateur interne `node-cron` | `false` sur Vercel (ce sont les Cron Jobs de `vercel.json` qui travaillent) |
| `REMINDER_CRON` | horaire du planificateur interne | `0 8 * * *` ; local seulement |
| `CRON_BUDGET_SECONDS` | temps qu'une tâche s'autorise avant de s'arrêter d'elle-même | `240` |
| `CRON_ENVOIS_PARALLELES` | envois (e-mail, WhatsApp) menés de front | `5` ; revenir à `1` si des envois échouent en rafale |
| `CRON_HEARTBEAT_URL` | signal envoyé quand la tâche quotidienne a tout réussi | vide : rien n'est envoyé ; voir « Alerte si la tâche quotidienne ne s'exécute plus » |
| `CONTRACT_REMINDER_DAYS` | jours avant la fin d'un bail pour prévenir le gestionnaire | `14` |
| `RENT_DUE_SOON_DAYS` | jours avant l'échéance pour le rappel « dernière minute » au locataire | `3` |
| `INSURANCE_REMINDER_DAYS` | jours avant l'échéance d'une assurance | `30` |
| `DOCUMENT_REMINDER_DAYS` | jours avant l'expiration d'un document rangé | `30` |

### Paiements

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | paiement par carte (abonnements des agences) | sensibles |
| `STRIPE_CURRENCIES` | devises que le paiement par carte accepte | `EUR` seul si absente ; n'ajouter que ce que votre compte Stripe accepte |
| `PAYDUNYA_MASTER_KEY`, `PAYDUNYA_PRIVATE_KEY`, `PAYDUNYA_PUBLIC_KEY`, `PAYDUNYA_TOKEN` | Orange Money, Wave, Free Money, MTN, carte (abonnements des agences) | sensibles |
| `PAYDUNYA_MODE` | `test` (bac à sable) ou `live` | `test` |
| `PAYDUNYA_STORE_NAME` | nom affiché sur la page PayDunya | `ImmoPlatform Pro` |
| `PAYDUNYA_CURRENCY` | devise du compte marchand PayDunya | `XOF` |
| `PAYMENTS_STORE_NAME` | nom affiché au payeur (Stripe **et** PayDunya) | prime sur `PAYDUNYA_STORE_NAME` |
| `PAYMENTS_DEMO_MODE` | paiements simulés, sans vraie transaction | **ne pas définir sur Vercel** : `true` y est ignoré et signalé |
| `RENT_ONLINE_PAYMENTS` | loyer payé en ligne par Stripe | laisser `false` |
| `PAYMENT_KEYS_ENCRYPTION_KEY` | chiffre les identifiants PayDunya de chaque agence | sensible, Production seulement ; **ne plus la changer** une fois des comptes enregistrés |

### WhatsApp (API Meta Cloud)

Sans `META_WHATSAPP_ACCESS_TOKEN` et `META_WHATSAPP_PHONE_NUMBER_ID`, l'envoi retombe sur une simulation : aucun message réel n'est envoyé.

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `META_WHATSAPP_ACCESS_TOKEN` | jeton permanent d'un « System User » (pas un jeton de test de 24 h) | sensible |
| `META_WHATSAPP_PHONE_NUMBER_ID` | identifiant du numéro expéditeur (pas le numéro lui-même) | |
| `META_WHATSAPP_TEMPLATE_RENT_DUE` | modèle approuvé de l'avis d'échéance (ancien, « le 5 » en dur) | obligatoire pour envoyer |
| `META_WHATSAPP_TEMPLATE_RENT_DUE_SOON` | modèle approuvé du rappel avant échéance | obligatoire pour envoyer |
| `META_WHATSAPP_TEMPLATE_RENT_DUE_DATED` | modèle de l'avis d'échéance avec la vraie date limite | remplace `META_WHATSAPP_TEMPLATE_RENT_DUE` quand il est renseigné |
| `META_WHATSAPP_TEMPLATE_OVERDUE` | modèle de relance d'un loyer impayé | vide : les relances partent par e-mail seulement |
| `META_WHATSAPP_TEMPLATE_LANGUAGE` | code langue déclaré chez Meta | `fr` |
| `META_WHATSAPP_COST_UTILITY_USD` | tarif d'un message « utility », pour estimer le coût affiché dans l'administration | `0.004` ; la facture de Meta fait foi |

### Suivi des erreurs (Sentry)

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `SENTRY_DSN` | projet Sentry du backend | vide : Sentry désactivé |
| `VITE_SENTRY_DSN` | projet Sentry du frontend | vide : Sentry désactivé |

### Frontend (projet Vercel `frontend`)

| Variable | Rôle | Défaut / remarque |
|---|---|---|
| `VITE_API_URL` | adresse du backend | **obligatoire** ; en production, un sous-domaine du site (voir l'étape 3.2) |
| `VITE_GOOGLE_CLIENT_ID` | bouton « Se connecter avec Google » | vide : bouton masqué ; doit correspondre à `GOOGLE_CLIENT_ID` |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics 4 (`G-XXXXXXXXXX`) | vide : désactivé ; chargé après consentement |
| `VITE_META_PIXEL_ID` | pixel Meta | vide : désactivé ; chargé après consentement |
| `VITE_LINKEDIN_PARTNER_ID` | LinkedIn Insight Tag | vide : désactivé ; chargé après consentement |

---

## Surveillance de la disponibilité

Deux routes publiques, sans authentification ni détail technique :

| Route | Ce qu'elle vérifie | Réponse |
|---|---|---|
| `/api/health` | la fonction démarre (elle ne touche pas la base) | `{"status":"ok"}` |
| `/api/health/ready` | la base répond à un `select 1` en moins de 3 s | `{"status":"ok"}` (200) ou `{"status":"degraded"}` (**503**) |

Une sonde posée sur `/api/health` seul resterait au vert avec une base injoignable (mot de passe changé, projet Supabase en
pause, connexions épuisées) alors qu'aucune page ne s'affiche : **surveillez `/api/health/ready`**. Le résultat y est gardé
10 s par instance, et des appels simultanés partagent une même vérification : une sonde, ou un curieux, ne peut pas
mitrailler la base. La cause exacte d'un 503 se lit dans les journaux Vercel (`[sante] La base ne répond pas : …`).

**Sonde UptimeRobot :** type **Keyword**, URL `https://votre-backend.vercel.app/api/health/ready`, mot-clé `"status":"ok"` (à signaler
s'il est **absent**, sensible à la casse : un simple « ok » se trouverait aussi dans un message d'erreur comme « Token »), intervalle 5 minutes. Contacts d'alerte : e-mail et notification Android ; activez aussi le contact
SMS / appel si vous voulez être réveillé. Les sondes d'UptimeRobot partent d'Amérique du Nord : leurs temps de réponse
sont plus longs que ceux d'un utilisateur à Dakar, c'est normal, seule la disponibilité compte ici.

### Alerte si la tâche quotidienne ne s'exécute plus (battement de cœur)

Une sonde posée sur `/api/health/ready` ne voit que ce qui **répond** : si le cron Vercel s'arrête (désactivé, secret absent, déploiement cassé) ou si une étape de la tâche échoue, le site reste au vert et personne n'est prévenu, alors que les avis d'échéance, les relances et le passage des factures en retard ne partent plus. Pour couvrir ce cas, la tâche quotidienne appelle, **seulement quand toutes ses étapes ont réussi**, l'adresse `CRON_HEARTBEAT_URL`.

Deux sondes conviennent. Elles reçoivent le même signal (une requête GET en https) : seule l'adresse change.

**Option A : UptimeRobot (offre payante).** Les monitors de type Heartbeat n'existent pas sur l'offre gratuite.

1. UptimeRobot → *Add new monitor* → type **Heartbeat**, intervalle **24 h** avec 2 à 3 h de marge (le cron part à 08 h UTC). Contacts d'alerte : e-mail et notification Android. UptimeRobot donne une adresse `https://heartbeat.uptimerobot.com/…`.
2. Vercel → projet backend → *Environment Variables* → `CRON_HEARTBEAT_URL` = cette adresse, en variable **sensible**, pour *Production* seulement.

**Option B : Sentry (déjà en place pour les erreurs).** Un « cron monitor » Sentry attend un signal à heure fixe et ouvre un incident s'il manque.

1. Sentry → *Monitors* → *Cron* → créer un monitor : slug `cron-daily`, projet du backend, planification `0 8 * * *` en **UTC**, marge (*check-in margin*) de **180 minutes**, un seul échec ou absence suffit pour ouvrir l'incident.
2. L'adresse du signal se compose à partir de la `SENTRY_DSN` du projet (`https://<clé>@<hôte>/<id du projet>`) : `https://<hôte>/api/<id du projet>/cron/cron-daily/<clé>/?status=ok`. Elle ne contient que la clé de collecte du projet, conçue pour ne servir qu'à envoyer des signaux, jamais à lire des données ; on la traite quand même comme sensible.
3. Vercel → projet backend → `CRON_HEARTBEAT_URL` = cette adresse, en variable **sensible**, pour *Production* seulement (sans quoi chaque aperçu signalerait à la place de la production).
4. Sentry ne détecte aucune absence **avant d'avoir reçu un premier signal** : le monitor reste en « Waiting for first Check-in » jusqu'au premier passage réussi de la tâche.

**Dans les deux cas, la variable ne s'applique qu'à un nouveau déploiement.** Redéployez le backend avec un vrai changement dans `backend/` : un « Redeploy » d'un commit inchangé est annulé par la commande d'« Ignored Build Step » du projet (voir « Changer une variable d'environnement du backend ne suffit pas »).

Contrôle : lancer à la main `/api/cron/daily` (voir plus haut) ; le monitor passe à « Up » (UptimeRobot) ou « OK » (Sentry) dans la minute.

Sans la variable, rien n'est envoyé et rien ne change. L'adresse n'apparaît jamais dans les journaux.

### Délai des appels au stockage de fichiers

Les appels à Supabase Storage (dépôt de photo, suppression, téléchargement) sont interrompus au bout de 30 s. Sans cela, un stockage dont la connexion se fige laissait la requête attendre jusqu'à ce que Vercel tue la fonction (300 s). L'échec est alors renvoyé comme n'importe quelle autre erreur de stockage.

## Chiffrement du secret de double authentification

Le secret TOTP de chaque compte (`users.totp_secret`) est chiffré en base (AES-256-GCM) avec la clé `TOTP_ENCRYPTION_KEY`. Sans cela, quiconque lit la base pourrait calculer les codes à 6 chiffres du compte, dont celui de l'administrateur.

1. Générez la clé : `openssl rand -base64 32`. Sous Windows PowerShell, où `openssl` n'existe pas : `$o = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($o); [Convert]::ToBase64String($o)` (une ligne de 44 caractères terminée par `=`).
2. Ajoutez-la dans Vercel (Settings → Environment Variables), nom `TOTP_ENCRYPTION_KEY`, **type « sensitive »**, pour Production, puis redéployez.
3. **Conservez-la dans un gestionnaire de mots de passe, hors de GitHub.** Elle est distincte de `JWT_SECRET` : changer l'un ne rend pas l'autre illisible. Sans la clé, un secret chiffré est irrécupérable : il faut alors remettre à zéro la double authentification du compte dans la base (`totp_secret`, `totp_enabled_at` et `totp_backup_codes_hash` à `NULL`), puis la reconfigurer.

### Remplacer la clé (clé perdue, ou soupçon de fuite)

À ne faire que dans ces deux cas : les secrets déjà chiffrés avec l'ancienne clé deviennent illisibles. Dans l'état actuel, un seul compte est concerné (l'administrateur) ; vérifiez avec `select role, count(*) filter (where totp_secret like 'v1:%') from users group by role`.

1. Rangez la nouvelle clé dans le gestionnaire de mots de passe, puis **remplacez la valeur** de `TOTP_ENCRYPTION_KEY` sur Vercel (Sensitive, Production).
2. **Faites construire un vrai déploiement du backend.** Une variable n'est lue qu'au démarrage d'un NOUVEAU déploiement. Un « Redeploy » sans changement de code est **annulé** par l'`ignoreCommand` (message « Ignored Build Step », constaté le 19/11/2026) : l'ancienne clé reste alors en service sans que rien ne le dise. Il faut un commit qui touche `backend/` (même un commentaire de `backend/.env.example`), fusionné normalement. Vérifiez que le déploiement de production est **READY** et sur ce commit.
3. **Alors seulement**, remettez à zéro la double authentification de l'administrateur : `npm run reset-admin-2fa` (voir plus bas), ou, depuis l'éditeur SQL de Supabase, la même requête qui efface `totp_secret`, `totp_enabled_at`, `totp_backup_codes_hash`, `totp_last_used_step` et ajoute 1 à `token_version` pour le compte `ADMIN`. Si vous la faites AVANT le déploiement, une connexion de l'administrateur entre-temps rechiffrerait son secret avec l'ancienne clé.
4. Connectez-vous : l'administration impose de réactiver la double authentification (secret chiffré avec la nouvelle clé, nouveaux codes de secours à ranger, un par ligne, dans le gestionnaire de mots de passe). Contrôle en lecture seule : le compte a `totp_secret like 'v1:%'`.

Tant que la clé est absente, les secrets restent en clair et le démarrage le signale en production (journal et Sentry : « TOTP_ENCRYPTION_KEY est absente »). Les secrets déjà en clair restent lisibles, et sont chiffrés à la première connexion réussie du compte après la pose de la clé. Ne changez pas la clé une fois posée : les secrets déjà chiffrés ne seraient plus lisibles.

## Administrateur : retrouver l'accès après la perte du téléphone

L'espace d'administration **exige la double authentification** : un compte administrateur qui ne l'a pas activée se connecte, mais voit un seul écran qui lui demande de l'activer. Sur le site, la désactiver exige un code ; un administrateur qui a perdu son téléphone **et** ses codes de secours ne peut donc pas se rattraper seul. Il n'existe volontairement **aucune route web** pour cela (elle deviendrait la porte dérobée d'une protection censée résister à un mot de passe volé) : la remise à zéro se fait en ligne de commande, avec l'accès à la base de production.

```
cd backend
DATABASE_URL="<chaîne de connexion de production>" npm run reset-admin-2fa -- admin@immoplatformpro.com
```

Elle efface le secret et les codes de secours du compte, **révoque ses sessions ouvertes**, et inscrit l'action au journal d'audit de l'administration (`admin.two_factor_reset`). Le mot de passe est conservé : à sa prochaine connexion, l'administrateur doit réactiver la double authentification, et reçoit de nouveaux codes de secours — à ranger, cette fois, dans un gestionnaire de mots de passe. La commande refuse un compte qui n'est pas administrateur (celle d'un gestionnaire se remet à zéro à la main, voir ci-dessus).

Si le mot de passe est lui aussi perdu, `npm run create-admin -- <email> "<nouveau mot de passe>"` le remplace, puis `reset-admin-2fa` remet la double authentification à zéro.

## Sauvegarde et restauration

Le plan gratuit de Supabase **ne fait aucune sauvegarde automatique** : après une fausse manipulation (un `DROP`, un `UPDATE` sans `WHERE`) ou une panne, il n'y aurait aucun moyen de revenir en arrière. Le workflow `.github/workflows/sauvegarde.yml` y supplée : chaque jour (programmé à 02 h 43 UTC, mais GitHub le lance en pratique entre 09 h et 11 h UTC : relevé du 14 au 21 novembre 2026, l'heure exacte varie avec la charge de GitHub), il copie la base (schéma `public`, celui de l'application), **chiffre** la copie, **prouve qu'elle se restaure** (dans un PostgreSQL jetable, avec le nombre de lignes de chaque table dans le résumé du run), puis la dépose comme artefact du run, conservé 30 jours. Un échec ouvre un ticket.

> Le vrai filet est le plan **Pro** de Supabase (sauvegardes quotidiennes conservées 7 jours, retour à un instant donné en option). À prévoir dès le premier client payant ; cette sauvegarde reste utile en complément, car elle vit hors de Supabase.

### Mise en place (une seule fois)

1. **Adresse de connexion.** Dans Supabase → *Connect*, choisissez **Session pooler** (port **5432** du serveur `…pooler.supabase.com`, utilisateur `postgres.<réf-du-projet>`), copiez l'adresse et remplacez `[YOUR-PASSWORD]` par le mot de passe de la base. Ni la connexion directe (`db.<réf>.supabase.co`, en IPv6 seulement : les machines de GitHub n'y accèdent pas), ni le **Transaction pooler** (port 6543, celui du backend sur Vercel : il ne convient pas à `pg_dump`) ne marchent ici.
   **Écrivez l'adresse sans crochets** (remplacez `[YOUR-PASSWORD]` tout entier) et avec **un seul `@`**, celui qui précède le nom du serveur : un `@` dans le mot de passe s'écrit `%40` (`#` → `%23`, `/` → `%2F`, `:` → `%3A`), ou choisissez un mot de passe en lettres et chiffres. Le script vérifie cette forme avant de lancer la copie et dit quoi corriger sans jamais citer un morceau de l'adresse : le journal d'un dépôt public est lisible par tous. Pour ne pas utiliser le mot de passe du projet, créez un rôle de lecture dédié (`create role sauvegarde … bypassrls`, puis `grant select`) : les tables ont la sécurité par ligne, d'où `bypassrls`.
2. **Deux secrets** dans GitHub → *Settings → Secrets and variables → Actions → New repository secret* :
   - `SUPABASE_DB_URL` : l'adresse de l'étape 1 ;
   - `BACKUP_PASSPHRASE` : une phrase de passe longue et aléatoire (`openssl rand -base64 32`). **Gardez-la aussi dans un gestionnaire de mots de passe, hors de GitHub** : GitHub ne la réaffiche jamais, et sans elle les copies sont illisibles.
3. **Premier essai.** *Actions → Sauvegarde de la base → Run workflow*. Le run doit être vert, avec l'artefact `sauvegarde-base` et, dans le résumé, la liste des tables et de leurs lignes.

### Restaurer (cas réel)

1. Téléchargez l'artefact du run voulu (*Actions →* le run *→ Artifacts*) et décompressez-le : un fichier `immoplatform-AAAAMMJJ-HHMMSS.dump.gpg` et son `.sha256`.
2. Créez un **projet Supabase neuf** (ou une base vide) ; installez les clients PostgreSQL 17 et `gpg`.
3. Lancez, depuis ce dépôt :
   ```bash
   RESTORE_DATABASE_URL="postgresql://…adresse de la base VIDE…" \
   BACKUP_PASSPHRASE="…" \
   backend/scripts/sauvegarde/verifier-sauvegarde.sh immoplatform-AAAAMMJJ-HHMMSS.dump.gpg
   ```
   Le script contrôle l'empreinte, refuse une base qui n'est pas vide (et la base sauvegardée, si vous ajoutez `DATABASE_URL`), restaure **tout ou rien**, puis affiche le nombre de lignes de chaque table.
4. Faites pointer `DATABASE_URL` du backend (Vercel) vers la nouvelle base, redéployez, puis vérifiez `/api/health` et une connexion.

Pour simplement lire une copie : `gpg --decrypt immoplatform-….dump.gpg > base.dump`, puis `pg_restore --list base.dump`.

### Ce que cette sauvegarde ne couvre pas

- **Les fichiers déposés** (photos d'incident, justificatifs, pièces : espaces de stockage `public-uploads` et `private-uploads`) ne sont pas dans une copie de base. Supabase ne les sauvegarde pas non plus sur le plan gratuit. Il n'y en a presque pas aujourd'hui ; c'est à traiter avant un usage réel.
- **Jusqu'à 24 h de données** peuvent être perdues (une copie par jour), et **jusqu'à environ 32 h au pire** : GitHub lance le workflow avec plusieurs heures de retard sur 02 h 43 UTC, donc deux copies successives peuvent être espacées de plus de 24 h.
- La copie est dans **le même compte GitHub** que le code : elle protège d'une erreur sur la base, pas de la perte du compte. Téléchargez-en une de temps en temps, ailleurs.
- Le quota d'artefacts de GitHub est limité (500 Mo en plan gratuit) : à quelques Mo par copie, 30 jours tiennent largement ; à surveiller si la base grossit (sinon, réduire `retention-days`).
- Le workflow rejoue à chaque copie une restauration à blanc, mais un **essai complet dans un projet Supabase neuf**, une fois par trimestre, reste la seule preuve de bout en bout (adresse du backend comprise).

---

## Délivrabilité des e-mails

L'application envoie ses e-mails (confirmation d'adresse, mot de passe oublié, invitations, avis d'échéance, quittances, relances) par SMTP, avec l'expéditeur `EMAIL_FROM`. Pour qu'ils arrivent en boîte de réception et non en courrier indésirable, **le serveur d'envoi doit correspondre au domaine de l'expéditeur** :

| Réglage | Valeur attendue (exemple Zoho Mail, domaine `immoplatformpro.com`) |
|---|---|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.zoho.com` (ou `smtp.zoho.eu`) / `465` / `true` |
| `SMTP_USER` | l'adresse de la boîte, par exemple `contact@immoplatformpro.com` |
| `SMTP_APP_PASSWORD` | un **mot de passe d'application** Zoho (pas celui du compte) |
| `EMAIL_FROM` | la **même adresse** que `SMTP_USER`, par exemple `ImmoPlatform Pro <contact@immoplatformpro.com>` |
| SPF (TXT sur le domaine) | `v=spf1 include:zohomail.com ~all` |
| DKIM (TXT `zmail._domainkey`) | la clé fournie par Zoho (Mail Admin → Domaines → DKIM) |
| DMARC (TXT `_dmarc`) | `v=DMARC1; p=none; rua=mailto:<votre adresse>` pour observer, puis `p=quarantine` quand tout passe |

Le défaut du code (`smtp.gmail.com`) ne convient **pas** à un expéditeur en `@votre-domaine` : Gmail signe au nom de `gmail.com`, donc SPF et DKIM ne correspondent pas au domaine de l'expéditeur.

**Vérifier, après tout changement de ces réglages :**
1. Déclenchez un vrai « mot de passe oublié » vers une adresse Gmail ou Outlook à vous.
2. Ouvrez le message → menu ⋮ → **Afficher l'original** (Gmail). Les trois lignes doivent être : `spf=pass`, `dkim=pass`, `dmarc=pass`.
3. Le message doit arriver en boîte de réception, pas en courrier indésirable.

**Si l'envoi échoue en production**, l'application ne s'arrête pas (un SMTP en panne ne doit pas bloquer un encaissement), mais elle **émet une alerte Sentry** « Échec d'envoi d'e-mail (SMTP) : <code> », au plus une par cause et par dix minutes, avec le code d'erreur, l'hôte SMTP et le domaine de l'expéditeur (jamais le destinataire ni le sujet). Causes fréquentes : `EAUTH` (identifiant ou mot de passe d'application refusé, ou hôte qui ne correspond pas aux identifiants), `ECONNECTION` / `ETIMEDOUT` (hôte ou port faux), `EENVELOPE` avec le code 553 (expéditeur non autorisé pour ce compte).

---

## Reprise après sinistre : quoi faire, dans quel ordre

### Selon la panne

| Ce qui arrive | Que faire |
|---|---|
| Un déploiement casse le site (500 partout) | Vercel → *Deployments* → le dernier déploiement sain → **Instant Rollback**, puis corriger (voir « Le site entier est en panne »). Quelques minutes. |
| La base est abîmée ou vidée par erreur | Restaurer la dernière copie chiffrée (section « Sauvegarde et restauration »). **Perte possible : jusqu'à 24 h**, plus le retard de lancement du workflow (GitHub le déclenche en pratique entre 09 h et 11 h UTC, soit jusqu'à environ 32 h au total). |
| Le projet Supabase est en pause ou supprimé | Plan gratuit : un projet sans activité pendant 7 jours est mis en pause. Dans Supabase, *Restore project* le réveille (possible plusieurs semaines après). Si le projet n'existe plus : nouveau projet + restauration d'une copie. |
| Le compte Vercel est perdu | Recréer les deux projets (racines `backend` et `frontend`), leurs variables, puis les domaines (voir plus bas). |
| Le compte GitHub est perdu | Le code **et** les copies de la base disparaissent avec lui : gardez ailleurs une copie du dépôt et, une fois par trimestre, une copie chiffrée téléchargée. |

### Les secrets qu'on ne peut PAS recréer

Perdus, ils rendent des données illisibles à jamais. Gardez-les dans un gestionnaire de mots de passe, **hors de GitHub et de Vercel** (Vercel ne réaffiche jamais une variable « sensible ») :

- `PAYMENT_KEYS_ENCRYPTION_KEY` : chiffre les identifiants de paiement de chaque agence. Sans elle, chaque agence doit ressaisir les siens.
- `TOTP_ENCRYPTION_KEY` : chiffre les secrets de double authentification. Sans elle, il faut remettre à zéro la double authentification de chaque compte (voir « Chiffrement du secret de double authentification »).
- `BACKUP_PASSPHRASE` : sans elle, **toutes les copies de la base sont illisibles**.
- Le mot de passe de la base Supabase et les clés du projet (`SUPABASE_SERVICE_ROLE_KEY`).

Se recréent sans perte de données : `JWT_SECRET` (tout le monde est simplement déconnecté), `CRON_SECRET`, les clés SMTP, le jeton WhatsApp, `SENTRY_DSN`.

### Reconstruire de zéro, dans l'ordre

1. **Base** : nouveau projet Supabase (région `eu-west-3`, PostgreSQL 17), puis restauration de la dernière copie (section « Sauvegarde et restauration »).
2. **Fichiers** : recréer les deux espaces de stockage `public-uploads` (public) et `private-uploads` (privé). Leur contenu n'est **pas** sauvegardé (voir « Ce que cette sauvegarde ne couvre pas ») : les pièces déposées sont à redemander.
3. **Backend (Vercel)** : toutes les variables de `backend/.env.example` (liste de référence, vérifiée par un test), puis `FRONTEND_URL` et `PUBLIC_BACKEND_URL`.
4. **Frontend (Vercel)** : les variables de `frontend/.env.example` (au minimum `VITE_API_URL`).
5. **Domaines et DNS** : `www.immoplatformpro.com` (frontend), `api.immoplatformpro.com` (backend), l'apex qui redirige vers `www`, et les enregistrements du courrier (SPF, DKIM, DMARC : voir « Délivrabilité des e-mails »). **Gardez une copie de la zone DNS** : sans elle, le courrier sort en courrier indésirable le temps de la reconstituer.
6. **Services à repointer vers la nouvelle adresse du backend** : notifications de paiement (PayDunya, Stripe), webhook WhatsApp (Meta), origines et redirections autorisées de la connexion Google, `SENTRY_DSN`, et les trois sondes UptimeRobot.
7. **Vérifier** : `/api/health` et `/api/health/ready` répondent 200, une connexion fonctionne (gestionnaire, locataire, administrateur), puis lancer à la main la tâche quotidienne (`/api/cron/daily`, avec `CRON_SECRET`) et lire son bilan.

---

## Le site entier est en panne (500, `FUNCTION_INVOCATION_FAILED`)

**Symptôme :** toutes les routes, même `/api/health`, répondent 500 avec l'en-tête `X-Vercel-Error: FUNCTION_INVOCATION_FAILED`. La fonction ne se charge pas du tout : ce n'est pas une erreur de base de données.

**Précédent (5 au 7 octobre 2026, 2 jours) :** la double authentification a ajouté `otplib`, qui tirait deux bibliothèques (`@scure/base`, `@noble/hashes`) passées à l'ESM pur ; sous Node 24 avec l'instrumentation Sentry, leur chargement échouait (`ERR_REQUIRE_ESM`) sur toutes les routes. La CI était verte : elle tourne sous Node 22, avec les dépendances de développement, par le chargeur de vitest. Le correctif fige ces versions (`overrides` de `backend/package.json`).

**Que faire :** ouvrir le journal du déploiement dans Vercel, lire l'erreur de chargement (nom du module et code), puis annuler le dernier déploiement (« Instant Rollback ») pendant qu'on corrige.

**Ce que la CI vérifie maintenant :** le job « Backend — démarrage réel (Node 24) » compile le backend, retire les dépendances de développement, le démarre sous Node 24 avec Sentry actif et exige `/api/health` = 200 (`backend/scripts/verifier-demarrage.js`). Il attrape ce qui ne manque qu'en production, par exemple une dépendance de développement utilisée par l'application. **Il ne reproduit pas tout :** l'incident d'octobre dépendait du chargeur de Vercel lui-même et ne se reproduit pas en local. Après une mise à jour de dépendances, ouvrez aussi `/api/health` sur le déploiement de préversion de la PR avant de fusionner.

## Dépannage : des requêtes qui ne reviennent jamais

**Symptôme :** une page affiche « Le serveur met trop de temps à répondre », les journaux Vercel montrent
`Vercel Runtime Timeout Error: Task timed out after 300 seconds`, et côté base une connexion de l'application
(`application_name = Supavisor`) reste `active` avec `wait_event = ClientRead` pendant des minutes :

```sql
select pid, state, wait_event, extract(epoch from now() - xact_start)::int as secondes, left(query, 80)
from pg_stat_activity
where application_name = 'Supavisor' and state = 'active' and wait_event = 'ClientRead';
```

**Cause :** `postgres-js` envoie en parallèle (« pipeline ») plusieurs requêtes sur une même connexion ; derrière
le pooler Supabase en mode transaction (port 6543), les octets des requêtes pipelinées au-delà de la première ne
sont jamais transmis, et toutes les requêtes en file sur cette connexion attendent à jamais. Voir
[porsager/postgres#970](https://github.com/porsager/postgres/issues/970) et la page de la documentation Supabase
« Troubleshooting CONNECT_TIMEOUT or hanging queries in Serverless Functions ».

**Ce que fait le code :** `backend/src/db/clientSerialise.ts` exécute les requêtes **une par une** (une transaction
garde la file pour toute sa durée) et, si une requête ne revient pas dans les 15 s, l'abandonne avec une erreur
claire et **recrée la connexion** ; la requête suivante repart sur une connexion neuve. Un `[db] Connexion
recréée : …` dans les journaux signale chaque recyclage.

**Réglages (facultatifs, variables d'environnement du backend) :**

| Variable | Défaut | Rôle |
|---|---|---|
| `DB_DELAI_REQUETE_MS` | `15000` | délai au-delà duquel une requête isolée est tenue pour bloquée |
| `DB_DELAI_TRANSACTION_MS` | `120000` | idem pour une transaction entière (import CSV, etc.) |

Ne pas régler `max_pipeline: 0` sur `postgres-js` à la place : cela casse `sql.begin`, donc toutes les transactions.

## Ce qui a changé dans le code pour cette cible de déploiement

- **Base de données** : `better-sqlite3` → `postgres-js` + Drizzle en dialecte `postgresql` (`backend/src/db/`).
- **Fichiers** : plus de disque local (`backend/uploads/` a été supprimé) — tout passe par `backend/src/services/storage.service.ts` vers Supabase Storage. Les pièces d'identité (bucket privé) sont servies via URL signée générée à la demande (`GET /api/tenants/:id/id-document-url`), jamais via un lien public permanent.
- **Rappels planifiés** : `node-cron` reste actif en développement local (`ENABLE_INTERNAL_CRON=true`) mais est désactivé en production ; `backend/vercel.json` déclare deux Vercel Cron Jobs, protégés par le header `Authorization: Bearer $CRON_SECRET` que Vercel envoie automatiquement :
  - `GET /api/cron/daily` (`0 8 * * *`) enchaîne les trois travaux quotidiens : rappel de fin de bail au gestionnaire, rappel « avant échéance » au locataire (avec passage en retard des factures dépassées), et génération des factures du mois suivie de l'avis d'échéance ;
  - `GET /api/cron/rent-due-reminders` (`0 8 1 * *`) refait ce dernier travail le 1er du mois. Ce n'est plus son unique déclencheur : la route quotidienne le couvre aussi, pour qu'un échec ponctuel ne coûte pas un mois entier de facturation. Les deux ne font jamais double emploi — une facture déjà traitée porte son `reminderSentAt`.
- **Frontend** : `frontend/vercel.json` porte quatre réglages : (1) une règle de réécriture pour que le routage côté client (React Router) fonctionne aussi sur un rechargement de page ou un lien direct (ex: `/portail/paiements`) ; (2) une réécriture de `/sitemap-annonces.xml` vers le plan de site des annonces publiques que sert le backend (`api.immoplatformpro.com/api/listings/public/sitemap.xml`) ; (3) des en-têtes de sécurité sur toutes les pages : `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, et la politique de sécurité de contenu, en deux versions : `Content-Security-Policy` est appliquée (scripts, objets, formulaires, cadres), `Content-Security-Policy-Report-Only` observe le reste et envoie les violations au backend (`/api/csp-report`) ; (4) un cache d'un an, `immutable`, sur les fichiers de `/assets/`, dont le nom change à chaque construction. Si le backend change d'adresse, mettez à jour celle de la réécriture du plan de site, ainsi que `report-uri` et `connect-src` dans la politique de sécurité.
