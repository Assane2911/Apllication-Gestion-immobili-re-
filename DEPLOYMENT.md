# Guide de déploiement : Antigravity → Supabase → Vercel

Ce guide suit exactement le chemin demandé : relire le projet dans **Google Antigravity** pour le contextualiser avant de le modifier, stocker les données sur **Supabase** (base Postgres + fichiers), puis héberger l'application sur **Vercel**.

L'application a déjà été adaptée pour cette cible : base de données Postgres (Drizzle ORM), fichiers uploadés sur Supabase Storage, et rappels automatiques via un Vercel Cron Job plutôt qu'un processus en continu (Vercel ne fait tourner que des fonctions à la demande, sans serveur permanent).

---

## Étape 1 — Ouvrir le projet dans Antigravity

Antigravity est une application de bureau (Windows/macOS/Linux) : ce travail se fait sur votre ordinateur.

1. Installez Antigravity depuis [antigravity.google](https://antigravity.google) si ce n'est pas déjà fait.
2. Décompressez le projet que je vous ai fourni (`gestion-immo-source.zip` ou via le dépôt GitHub une fois poussé).
3. Dans Antigravity : cliquez sur l'icône dossier **+** dans la barre latérale → **New Project** → **Add Folder** → sélectionnez le dossier `gestion-immo` → **Create**.
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

### 3.1 Déployer le backend

1. Sur [vercel.com](https://vercel.com) → **Add New → Project** → importez le dépôt GitHub `Apllication-Gestion-immobili-re-`.
2. **Root Directory** : `backend`.
3. Vercel détecte automatiquement Express (zero-config).
4. Renseignez les variables d'environnement (Project Settings → Environment Variables) — reprenez tout `backend/.env.example`, notamment :
   - `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLIC_BUCKET`, `SUPABASE_PRIVATE_BUCKET`
   - `JWT_SECRET` (générez une vraie valeur aléatoire, différente de celle de dev : `openssl rand -base64 48`). Une valeur de moins de 32 caractères, ou le texte d'exemple de `.env.example`, est signalée dans les journaux et dans Sentry (« JWT_SECRET est faible ») à chaque démarrage, sans empêcher l'application de tourner : quiconque connaît le secret peut fabriquer un jeton de connexion, y compris administrateur. Pour le changer, mettez la nouvelle valeur dans Vercel et redéployez ; tous les utilisateurs devront se reconnecter.
   - `PAYMENTS_DEMO_MODE` : **ne le définissez pas** (ou mettez `false`). Sur un déploiement (Vercel, `NODE_ENV=production`) le mode démo n'existe pas : `PAYMENTS_DEMO_MODE=true` y est **ignoré** et signalé au démarrage (journal et Sentry : « PAYMENTS_DEMO_MODE=true a été IGNORÉ »), car l'activer rendrait tout paiement « réussi » sans qu'un centime ne soit encaissé — un abonnement s'activerait gratuitement. Si ce message apparaît, supprimez la variable de Vercel (Production et Preview). C'est pourquoi `backend/.env.example` le livre en commentaire.
   - `RENT_ONLINE_PAYMENTS` : laissez `false` (voir le `README`, section Paiements).
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `EMAIL_FROM`, `CONTRACT_REMINDER_DAYS`
   - `CRON_SECRET` : générez une valeur aléatoire (16+ caractères) — Vercel l'enverra automatiquement en en-tête `Authorization` lors de l'appel du Cron Job
   - `ENABLE_INTERNAL_CRON=false` (important : sur Vercel, le scheduler interne node-cron ne doit pas tourner — ce sont les Vercel Cron Jobs déclarés dans `backend/vercel.json` qui appellent `/api/cron/daily` chaque jour et `/api/cron/rent-due-reminders` le 1er du mois)
   - `CRON_BUDGET_SECONDS` (facultatif, 240 par défaut) : temps qu'une route cron s'autorise avant de s'arrêter d'elle-même. Vercel tue une fonction au-delà de sa durée maximale (300 s par défaut) ; en s'arrêtant avant, la tâche laisse le reliquat non réclamé, et l'exécution du lendemain le reprend. À augmenter seulement de pair avec `maxDuration`.
   - `FRONTEND_URL` : à renseigner une fois le frontend déployé (étape suivante), pour l'autorisation CORS
5. Déployez. Notez l'URL générée (ex: `https://gestion-immo-api.vercel.app`).
6. Une fois déployé, vérifiez dans **Project Settings → Cron Jobs** que `contract-reminders` apparaît bien planifié.

> **Région d'exécution** : `backend/vercel.json` fixe `"regions": ["cdg1"]` (Paris), la même région que la base Supabase (`eu-west-3`, Paris). Sans ce réglage, Vercel exécute les fonctions dans sa région par défaut (`iad1`, côte Est des États-Unis) : chaque requête SQL traverse l'Atlantique, et une page qui en enchaîne plusieurs attend cet aller-retour à chaque fois. **Si vous créez ou déplacez le projet Supabase dans une autre région, changez `regions` en conséquence** (Paris `cdg1`, Francfort `fra1`, Londres `lhr1`, Dublin `dub1`, Virginie `iad1`, San Francisco `sfo1`…) : la fonction doit rester à côté de la base. Une seule région est voulue ici, car la base n'est qu'à Paris : une fonction ailleurs ne ferait qu'ajouter de la distance. Le plan gratuit (Hobby) n'en accepte d'ailleurs qu'une seule ; le plan Pro, celui du projet de production, en accepte plusieurs. Le frontend (fichiers statiques) est servi depuis tous les points de présence et n'est pas concerné.

> **Tâches planifiées (Cron Jobs)** : sur le plan gratuit (Hobby), elles sont limitées à une exécution par jour, avec une précision "dans l'heure" (ex: `0 8 * * *` peut se déclencher entre 8h00 et 8h59). Le plan Pro, celui du projet de production, n'a pas cette limite ; les tâches de `vercel.json` (une par jour, une par mois) tiennent de toute façon dans les deux plans.

### 3.2 Déployer le frontend

1. **Add New → Project** → même dépôt GitHub, mais **Root Directory** : `frontend`.
2. Vercel détecte automatiquement Vite (zero-config).
3. Variable d'environnement : `VITE_API_URL` = l'URL du backend déployé à l'étape 3.1 (ex: `https://gestion-immo-api.vercel.app`).
4. Déployez. Notez l'URL générée (ex: `https://gestion-immo.vercel.app`).

### 3.3 Boucler la boucle CORS

Retournez dans les variables d'environnement du **projet backend** sur Vercel et mettez à jour `FRONTEND_URL` avec l'URL du frontend déployé, puis redéployez le backend (Vercel → Deployments → Redeploy) pour que le changement prenne effet.

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

## Chiffrement du secret de double authentification

Le secret TOTP de chaque compte (`users.totp_secret`) est chiffré en base (AES-256-GCM) avec la clé `TOTP_ENCRYPTION_KEY`. Sans cela, quiconque lit la base pourrait calculer les codes à 6 chiffres du compte, dont celui de l'administrateur.

1. Générez la clé : `openssl rand -base64 32`.
2. Ajoutez-la dans Vercel (Settings → Environment Variables), nom `TOTP_ENCRYPTION_KEY`, **type « sensitive »**, pour Production, puis redéployez.
3. **Conservez-la dans un gestionnaire de mots de passe, hors de GitHub.** Elle est distincte de `JWT_SECRET` : changer l'un ne rend pas l'autre illisible. Sans la clé, un secret chiffré est irrécupérable : il faut alors remettre à zéro la double authentification du compte dans la base (`totp_secret`, `totp_enabled_at` et `totp_backup_codes_hash` à `NULL`), puis la reconfigurer.

Tant que la clé est absente, les secrets restent en clair et le démarrage le signale en production (journal et Sentry : « TOTP_ENCRYPTION_KEY est absente »). Les secrets déjà en clair restent lisibles, et sont chiffrés à la première connexion réussie du compte après la pose de la clé. Ne changez pas la clé une fois posée : les secrets déjà chiffrés ne seraient plus lisibles.

## Sauvegarde et restauration

Le plan gratuit de Supabase **ne fait aucune sauvegarde automatique** : après une fausse manipulation (un `DROP`, un `UPDATE` sans `WHERE`) ou une panne, il n'y aurait aucun moyen de revenir en arrière. Le workflow `.github/workflows/sauvegarde.yml` y supplée : chaque nuit (02 h 43 UTC), il copie la base (schéma `public`, celui de l'application), **chiffre** la copie, **prouve qu'elle se restaure** (dans un PostgreSQL jetable, avec le nombre de lignes de chaque table dans le résumé du run), puis la dépose comme artefact du run, conservé 30 jours. Un échec ouvre un ticket.

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
- **Jusqu'à 24 h de données** peuvent être perdues (une copie par nuit).
- La copie est dans **le même compte GitHub** que le code : elle protège d'une erreur sur la base, pas de la perte du compte. Téléchargez-en une de temps en temps, ailleurs.
- Le quota d'artefacts de GitHub est limité (500 Mo en plan gratuit) : à quelques Mo par copie, 30 jours tiennent largement ; à surveiller si la base grossit (sinon, réduire `retention-days`).
- Le workflow rejoue chaque nuit une restauration à blanc, mais un **essai complet dans un projet Supabase neuf**, une fois par trimestre, reste la seule preuve de bout en bout (adresse du backend comprise).

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

## Application Android — la reconstruire

L'application Android (Capacitor, projet dans `frontend/android/`) embarque une COPIE du site : elle ne se met pas à jour toute seule quand le site est déployé. À chaque nouvelle version à publier :

1. Compiler le site **avec l'adresse de l'API de production** (sans elle, l'application viserait `http://localhost:4000` et ne pourrait rien charger) :
   ```bash
   cd frontend
   VITE_API_URL=https://apllication-gestion-immobili-re.vercel.app npm run build
   ```
2. Copier le site dans le projet Android (les fichiers copiés sont ignorés par git) :
   ```bash
   npx cap sync android
   ```
3. Ouvrir le projet dans Android Studio (`npx cap open android`) puis **Build → Generate Signed Bundle / APK**, avec la clé de signature de l'application. Le SDK Android et Android Studio sont nécessaires sur le poste qui compile.
4. **Augmenter `versionCode`** (et `versionName`) dans `frontend/android/app/build.gradle` avant chaque envoi : le Play Store refuse un `versionCode` déjà utilisé, et un appareil ne met pas à jour une version de numéro égal ou inférieur.

Permissions : l'application ne demande que la **caméra** (photographier un incident). Elle ne demande pas l'accès aux photos de l'appareil (`READ_MEDIA_IMAGES`) : le sélecteur de fichiers du système suffit, et cette permission restreinte de Google Play ferait refuser la publication. `src/androidPermissions.test.ts` tient cette règle.

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
- **Frontend** : `frontend/vercel.json` ajoute une règle de réécriture pour que le routage côté client (React Router) fonctionne aussi sur un rechargement de page ou un lien direct (ex: `/portail/paiements`).
