# Gestion Immobilière

Application complète de gestion immobilière (**ImmoPlatform Pro**) : tableau de bord, biens, locataires, contrats, paiements de loyer, rappels automatiques, espace propriétaire, et un portail locataire (signalement d'incidents avec photo, messagerie, quittances). Interface et e-mails en français, anglais, espagnol et portugais (fr, en, es, pt).

## Stack technique

- **Backend** : Node.js, Express, TypeScript, [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL (Supabase), JWT, Multer + Supabase Storage (fichiers), Nodemailer (e-mails), WhatsApp (API Meta Cloud), Sentry (suivi d'erreurs), node-cron en local / Vercel Cron Jobs en production, Vitest (tests, sur une base PostgreSQL en mémoire).
- **Frontend** : React + Vite (TypeScript), React Router, Tailwind CSS, Recharts, Axios, i18next, Sentry, Vitest.
- **Déploiement** : Vercel (frontend + backend), Supabase (base de données Postgres + stockage de fichiers), UptimeRobot et Sentry (surveillance). Voir [`DEPLOYMENT.md`](./DEPLOYMENT.md) pour le guide complet, y compris comment relire le projet dans Google Antigravity avant de le déployer.

## Fonctionnalités

### Espace gestionnaire

- **Tableau de bord** : nombre de biens, disponibilité, locataires, revenus mensuels, taux d'occupation, factures en retard, incidents ouverts, graphique des revenus sur 6 mois.
- **Biens immobiliers** : ajout / modification / suppression avec image, surface, loyer, statut (disponible, occupé, maintenance).
- **Locataires** : gestion des contacts (nom, téléphone, email, pièce d'identité) + création de l'accès au portail locataire.
- **Contrats** : liaison bien ↔ locataire avec loyer, dépôt de garantie, dates, statut. Génère automatiquement les échéances de loyer mensuelles.
- **Paiements de loyer** : suivi des mensualités par locataire, marquage manuel "réglée", historique par moyen de paiement.
- **Tâche quotidienne** (08 h UTC sur Vercel) : passage en retard des factures échues, relances graduées des impayés, rappels « avant échéance » aux locataires, avis d'échéance et facturation du mois, fins de bail (14 jours avant par défaut, `CONTRACT_REMINDER_DAYS`), dépenses récurrentes, assurances, documents arrivant à échéance, e-mails de fin d'essai ou d'abonnement. Chaque envoi est protégé contre les doublons, et la tâche s'arrête d'elle-même avant la limite de durée de Vercel pour reprendre le lendemain (`CRON_BUDGET_SECONDS`).
- **Incidents** : consultation de tous les signalements des locataires avec photo, changement de statut (ouvert / en cours / résolu / rejeté), note interne.

### Aussi dans l'espace gestionnaire

- **Propriétaires** : fiche, espace dédié, **compte-rendu de gestion** (CRG) mensuel dans la langue du propriétaire, reversements enregistrés et annoncés par e-mail, bilan fiscal.
- **Impayés** : relances graduées par e-mail et WhatsApp, mise en demeure, garants et colocataires prévenus, paiements partiels, quittances et reçus.
- **Baux** : colocation, garants, révision de loyer, avenants, état des lieux d'entrée et de sortie (avec **comparaison entrée/sortie** rappelée à la restitution du dépôt), congé et solde de tout compte, assurances, dépenses (dont récurrentes), prestataires.
- **Agenda** : une seule vue des échéances à traiter (loyers, fins de bail, sorties, révisions, assurances, documents), le retard en tête. Un lien d'abonnement secret et révocable (iCal) les affiche aussi dans Google Agenda, Outlook ou l'iPhone ; seule son empreinte est gardée, et le flux répond 404 à tout lien inconnu, révoqué, d'une agence suspendue ou d'un abonnement échu.
- **Documents** : diagnostics, attestations, pièces d'identité et justificatifs rangés par bien et par locataire (stockage privé, lien temporaire), avec date d'expiration signalée dans l'agenda et par un e-mail récapitulatif 30 jours avant (`DOCUMENT_REMINDER_DAYS`) ; effacés avec le bien, le locataire (anonymisation comprise) ou le compte.
- **Vitrine** : annonces publiques et demandes de visite reçues dans un CRM.
- **Compte et sécurité** : double authentification (TOTP), connexion avec Google, collaborateurs avec rôles, journal d'activité, export et suppression de ses données (RGPD), abonnement (Stripe, PayDunya), notifications dans la langue de l'interface.
- **Prise en main** : guide de démarrage dans l'espace gestionnaire, import de données, et **parrainage** (jours d'abonnement offerts au parrain quand son filleul confirme son adresse, dans la limite de 10 filleuls).
- **Administration de la plateforme** : rôle `ADMIN` (double authentification obligatoire) : gestionnaires, abonnements, annonces, suggestions, paramètres dont la **maintenance** programmée, et journal d'audit.

- **Espace propriétaire** : un agenda en lecture seule des échéances de ses seuls biens (fins de bail, départs annoncés, assurances), sans aucune donnée des locataires.

### Site public

- Page d'accueil, **vitrine** des annonces (avec leur plan de site pour les moteurs de recherche), inscription, connexion, mot de passe oublié, **pages légales** ; en français, anglais, espagnol et portugais.

### Portail locataire

- Consultation du logement loué et du contrat en cours.
- **Paiement des loyers en ligne** avec choix du moyen de paiement : carte bancaire (Stripe), PayDunya (Orange Money, Wave, Free Money, MTN...), virement bancaire déclaré (validé ensuite par le gestionnaire), ou mode démo (paiement simulé, pratique pour tester).
- **Signalement d'un problème** avec photo (prise directement depuis l'appareil sur mobile) et description ; le gestionnaire voit le signalement avec la photo dans son espace.

## Démarrage rapide (développement local)

Prérequis : Node.js 22 (la version testée par la CI), et un projet [Supabase](https://supabase.com) (gratuit) déjà créé — voir [`DEPLOYMENT.md`](./DEPLOYMENT.md#étape-2--créer-le-projet-supabase) pour la création du projet, la récupération de `DATABASE_URL` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, et la création des deux buckets de stockage.

### 1. Backend

```bash
cd backend
cp .env.example .env   # puis renseignez DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm install
npm run db:push     # crée les tables dans votre base Supabase à partir du schéma
npm run seed         # (optionnel) données de démonstration — voir ci-dessous
npm run dev           # démarre l'API sur http://localhost:4000
npm test              # la suite de tests (base en mémoire : ne touche à aucune vraie base)
```

**Données de démonstration (`npm run seed`).** Le seed ne tourne jamais en production, et **refuse toute base qui n'est pas locale** — donc un projet Supabase — tant que `SEED_ALLOW_REMOTE=true` n'est pas donné. Avec un projet Supabase **de développement** (jamais celui de production) :

```bash
SEED_ALLOW_REMOTE=true npm run seed
```

Le mot de passe des comptes de démonstration est **généré au hasard et affiché une seule fois** à la fin du seed (ou fixé par `SEED_PASSWORD` pour un usage local répétable). Comptes créés :

- Gestionnaire : `gestionnaire@demo.com`
- Locataire (portail) : `amine.silva@demo.com`

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev   # démarre l'app sur http://localhost:5173
```

Ouvrez http://localhost:5173 et connectez-vous avec l'un des comptes ci-dessus (mot de passe affiché par le seed). `npm test` lance les tests du frontend, `npm run lint` l'analyse du code (oxlint) et `npm run build` produit la version de production.

## Configuration

La liste complète des variables d'environnement, rangées par thème, est dans [`DEPLOYMENT.md`](./DEPLOYMENT.md#référence-des-variables-denvironnement-par-thème) ; `backend/.env.example` et `frontend/.env.example` en sont la référence commentée (un test vérifie qu'elle suit le code).

### E-mails (SMTP)

L'exemple ci-dessous utilise Gmail, pratique en local. **En production, avec un expéditeur en `@votre-domaine`, utilisez le SMTP de la messagerie de ce domaine** (par exemple Zoho), sans quoi SPF et DKIM ne correspondent pas et les messages risquent le courrier indésirable : voir [`DEPLOYMENT.md`](./DEPLOYMENT.md), « Délivrabilité des e-mails ».

#### Exemple avec Gmail

Dans `backend/.env` :

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=votre-adresse@gmail.com
SMTP_APP_PASSWORD=xxxxxxxxxxxxxxxx
EMAIL_FROM="Gestion Immobilière <votre-adresse@gmail.com>"
CONTRACT_REMINDER_DAYS=14
REMINDER_CRON="0 8 * * *"
```

Pour générer un mot de passe d'application Gmail :
1. Activez la validation en 2 étapes sur le compte Google : https://myaccount.google.com/security
2. Générez un mot de passe d'application : https://myaccount.google.com/apppasswords
3. Collez-le dans `SMTP_APP_PASSWORD` (sans espaces).

Tant que `SMTP_USER`/`SMTP_APP_PASSWORD` ne sont pas renseignés, les emails sont simplement journalisés dans la console (mode simulation) — l'application reste utilisable sans configuration email.

### Paiements

Le module de paiement (`backend/src/services/payment.service.ts`) est conçu pour être branché facilement sur de vrais prestataires :

- **Stripe** : renseignez `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET`. La session de paiement (Checkout) est créée par l'API REST de Stripe, sans SDK ; la confirmation revient sur `POST /api/payments/stripe/webhook`, dont la signature est vérifiée et l'horodatage limité dans le temps (contre le rejeu). `STRIPE_CURRENCIES` liste les devises acceptées par carte (EUR par défaut).
- **PayDunya** (Orange Money, Wave, Free Money, MTN, carte bancaire — agrégateur ouest-africain, https://paydunya.com) : créez un compte gratuit, récupérez vos clés dans **Compte → Clés API**, renseignez `PAYDUNYA_MASTER_KEY` / `PAYDUNYA_PRIVATE_KEY` / `PAYDUNYA_PUBLIC_KEY` / `PAYDUNYA_TOKEN`, et passez `PAYDUNYA_MODE=live` une fois prêt (par défaut `test` = bac à sable, aucun vrai paiement). Le locataire ou le gestionnaire est redirigé vers une page de paiement hébergée par PayDunya ; la confirmation revient ensuite via le webhook `POST /api/payments/paydunya/ipn` (`backend/src/controllers/paydunya.controller.ts`), authentifié par un hash SHA-512 de la master key, puis **reconfirmé directement auprès de PayDunya** (jamais sur la seule foi du corps reçu) — assurez-vous que `PUBLIC_BACKEND_URL` (ou `VERCEL_PROJECT_PRODUCTION_URL` sur Vercel) pointe bien vers une URL publique joignable par PayDunya.
- **Les comptes Stripe et PayDunya de la plateforme ne servent qu'aux abonnements** des agences. Un loyer ne passe jamais par eux : il arriverait sur le compte de la plateforme avant d'être reversé à l'agence.
- **Loyers payés en ligne, sur le compte de l'agence (PayDunya)** : chaque agence enregistre ses propres identifiants PayDunya dans *Paramètres de l'agence → Paiement du loyer en ligne* (réservé au propriétaire de l'agence). Le locataire paie alors par Mobile Money ou carte et l'argent arrive directement chez l'agence ; la confirmation revient sur `POST /api/payments/paydunya/ipn/agence/:managerId`, vérifiée avec les clés de cette agence et limitée à ses factures. Les identifiants sont chiffrés (AES-256-GCM) avec `PAYMENT_KEYS_ENCRYPTION_KEY` (32 octets en hexadécimal : `openssl rand -hex 32`) : **sans cette variable, la fonction reste fermée** et rien ne change pour les agences. Ne changez pas cette clé une fois des comptes enregistrés : les identifiants deviendraient illisibles et chaque agence devrait les ressaisir.
- **`RENT_ONLINE_PAYMENTS`** ne concerne plus que Stripe (compte de la plateforme) : laissez `false`. PayDunya n'est jamais ouvert aux loyers via les clés de la plateforme.
- **Virement bancaire** : le locataire déclare une référence de virement ; le gestionnaire valide manuellement dans l'onglet "Paiements" ("Marquer réglée").
- **Mode démo** (`PAYMENTS_DEMO_MODE`) : les paiements sont simulés et confirmés instantanément, sans aucune vraie transaction — pratique pour tester tout le flux en local. Il est **actif par défaut en local** et **n'existe pas en production** (`NODE_ENV=production` ou Vercel) : `PAYMENTS_DEMO_MODE=true` y est ignoré et signalé au démarrage, car un abonnement s'activerait sans qu'un centime ne soit encaissé. Il court-circuite aussi Stripe et PayDunya, même si leurs clés sont configurées.

### WhatsApp, connexion Google et suivi des erreurs

- **WhatsApp** : les rappels de loyer partent aussi par WhatsApp (API Meta Cloud) quand `META_WHATSAPP_ACCESS_TOKEN` et `META_WHATSAPP_PHONE_NUMBER_ID` sont renseignés, avec des modèles de message approuvés par Meta ; sans eux, l'envoi est simulé et rien ne part.
- **Connexion avec Google** (gestionnaires) : `GOOGLE_CLIENT_ID` (backend) et `VITE_GOOGLE_CLIENT_ID` (frontend), identiques ; vides, la route et le bouton sont désactivés.
- **Sentry** : `SENTRY_DSN` (backend) et `VITE_SENTRY_DSN` (frontend) ; vides, rien n'est envoyé.

### Base de données et fichiers (Supabase)

- **Base de données** : PostgreSQL hébergé par Supabase. Utilisez la chaîne de connexion **Transaction pooler** (port 6543) — recommandée pour les environnements serverless comme Vercel (voir [`DEPLOYMENT.md`](./DEPLOYMENT.md)).
- **Fichiers uploadés** (images de biens, photos d'incidents, pièces d'identité) : stockés sur Supabase Storage (`backend/src/services/storage.service.ts`), pas sur disque local — nécessaire car Vercel n'offre pas de disque persistant. Les pièces d'identité (sensibles) vivent dans un bucket privé et ne sont accessibles que via une URL signée à durée limitée, générée à la demande.

## Déploiement en production

Guide complet, y compris la relecture du projet dans Google Antigravity, la création du projet Supabase, et le déploiement sur Vercel (frontend + backend, tâche planifiée incluse) : voir **[`DEPLOYMENT.md`](./DEPLOYMENT.md)**.

En résumé :
- Backend et frontend sont déployés comme **deux projets Vercel séparés** pointant vers le même dépôt (Root Directory `backend` et `frontend`).
- Les tâches planifiées passent par **deux Vercel Cron Jobs** (`backend/vercel.json`) plutôt qu'un processus continu, puisque Vercel ne fait tourner que des fonctions à la demande : `/api/cron/daily` chaque jour à 08 h UTC, et `/api/cron/rent-due-reminders` le 1er du mois. Un signal de « battement de cœur » (`CRON_HEARTBEAT_URL`, vers un monitor Sentry ou UptimeRobot) prévient si la tâche quotidienne s'arrête.
- Pensez à définir `FRONTEND_URL` (backend) et `VITE_API_URL` (frontend) vers les URLs publiques réelles une fois les deux projets déployés.
- **Sauvegarde** : le plan gratuit de Supabase ne sauvegarde rien. Un workflow GitHub copie la base chaque nuit (copie chiffrée, restaurée à blanc pour vérification) ; mise en place et restauration : `DEPLOYMENT.md`, « Sauvegarde et restauration ».
- **Surveillance** : `/api/health` (la fonction démarre) et `/api/health/ready` (la base répond) pour les sondes UptimeRobot ; erreurs dans Sentry ; mise en place : `DEPLOYMENT.md`, « Surveillance de la disponibilité ».
- **CI** (`.github/workflows/ci.yml`) : à chaque push et pull request, types du backend (variables et imports inutilisés interdits), tests du backend en trois tranches parallèles, démarrage réel du backend sous Node 24, puis types, tests, construction et analyse (oxlint) du frontend. `avis-securite.yml` contrôle chaque semaine les dépendances de production, `dependabot.yml` propose chaque lundi une pull request de mises à jour mineures et correctifs (jamais de version majeure), et `sauvegarde.yml` copie la base chaque nuit.

## Sécurité

- Les mots de passe sont hashés avec bcrypt.
- Les routes sont protégées par JWT et un contrôle de rôle (`MANAGER`, `TENANT`, `OWNER`, `ADMIN`), avec double authentification (TOTP) pour les gestionnaires qui l'activent, et **obligatoire** pour l'administration (récupération en cas de perte du téléphone : voir [`DEPLOYMENT.md`](./DEPLOYMENT.md#administrateur--retrouver-laccès-après-la-perte-du-téléphone)).
- Un locataire ne peut voir/payer que ses propres factures et signaler des incidents que sur ses propres contrats.
- Des limiteurs de débit protègent la connexion, la double authentification, les webhooks de paiement et le point de collecte des violations de la politique de sécurité ; le frontend envoie une politique de sécurité de contenu (`frontend/vercel.json`).
- Les secrets de double authentification et les identifiants de paiement des agences sont **chiffrés en base** (AES-256-GCM).
- Les dépendances de production sont contrôlées chaque semaine (`npm audit`, ticket ouvert automatiquement en cas d'avis ; `.github/workflows/avis-securite.yml`). L'avis qui visait `esbuild` (via `drizzle-kit`, un outil de développement) est réglé : sa version est figée par `overrides` dans `backend/package.json`.

## Performances

Les écrans relus en boucle (menu, tableau de bord, agenda, cloche de notifications) ne ramènent que les colonnes dont ils se servent : les lignes entières de contrats, de biens ou de locataires portent des textes libres (clauses de bail, mentions, signatures) et pèsent des mégaoctets sur un grand portefeuille. Mesuré en local sur 500 biens et 12 000 factures : tableau de bord 350 → 80 ms, décompte de l'agenda 64 → 24 ms, avec des chiffres identiques. Deux tests de garde (`agenda.colonnes.test.ts`, `dashboard.colonnes.test.ts`) échouent dès qu'une de ces requêtes sélectionne de nouveau une ligne entière ; pour ajouter un champ à un de ces écrans, ajoutez-le à la sélection.

## Structure du projet

```
.
├── README.md, DEPLOYMENT.md  # ce guide, et le guide de déploiement (Supabase, Vercel, surveillance, sauvegarde, reprise après sinistre)
├── .github/workflows/      # ci.yml (types, tests, construction), avis-securite.yml (hebdomadaire), sauvegarde.yml (nocturne)
├── .github/dependabot.yml  # mises à jour mineures et correctifs, chaque lundi (jamais de version majeure)
├── backend/
│   ├── scripts/            # sauvegarde/ (sauvegarde chiffrée et restauration de la base), verifier-demarrage.js (démarrage réel pour la CI)
│   ├── vercel.json         # deux Cron Jobs (/api/cron/daily, /api/cron/rent-due-reminders), région d'exécution, ignoreCommand
│   └── src/
│       ├── config/         # variables d'environnement, client Supabase (stockage), mode démo des paiements, clés de chiffrement
│       ├── db/             # schéma et client Drizzle (Postgres/Supabase)
│       ├── middleware/     # auth JWT, limiteurs de débit, upload de fichiers (mémoire), maintenance, gestion d'erreurs
│       ├── controllers/    # logique métier par ressource
│       ├── routes/         # routes Express
│       ├── services/       # e-mails, WhatsApp, paiements, factures, PDF, stockage, rappels et tâches planifiées
│       ├── utils/          # fonctions partagées (cookies d'authentification, budget de temps, battement de cœur…)
│       ├── scripts/        # create-admin, reset-admin-2fa, contrôle du schéma
│       ├── test/           # aides des tests : base en mémoire, comptes et jetons de test
│       ├── instrument.ts   # Sentry
│       └── seed.ts         # données de démonstration
└── frontend/
    ├── vercel.json         # réécriture SPA pour React Router, plan de site des annonces, politique de sécurité, cache des fichiers
    ├── scripts/            # génération du plan de site (sitemap.xml)
    └── src/
        ├── pages/          # manager/ (espace gestionnaire), owner/ (propriétaire), tenant/ (portail locataire), admin/, legal/, pages publiques
        ├── components/     # mise en page, éléments réutilisables
        ├── context/        # authentification, devise et autres états partagés
        ├── hooks/          # fils de discussion, boîtes de dialogue, enregistreur vocal…
        ├── api/            # client HTTP
        ├── i18n/           # traductions fr, en, es, pt
        ├── utils/          # fonctions partagées (agenda, consentement aux cookies, pays…)
        ├── data/           # tables de référence (pays, règles par pays, clauses)
        ├── legal/          # informations légales de l'éditeur
        ├── types/          # types partagés
        ├── test/           # aides des tests
        └── accessibilite/, deploiement/, rgpd/   # tests de garde (titres et tableaux accessibles, déploiement, polices et RGPD)
```
