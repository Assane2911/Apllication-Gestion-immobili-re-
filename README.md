# Gestion Immobilière

Application complète de gestion immobilière : tableau de bord, biens, locataires, contrats, paiements de loyer, rappels automatiques, espace propriétaire, et un portail locataire (signalement d'incidents avec photo, messagerie, quittances). Interface et e-mails en français, anglais, espagnol et portugais (fr, en, es, pt).

## Stack technique

- **Backend** : Node.js, Express, TypeScript, [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL (Supabase), JWT, Multer + Supabase Storage (fichiers), Nodemailer (emails), node-cron en local / Vercel Cron Jobs en production.
- **Frontend** : React + Vite (TypeScript), React Router, Tailwind CSS, Recharts, Axios, i18next. Application Android via Capacitor (voir `DEPLOYMENT.md`).
- **Déploiement** : Vercel (frontend + backend), Supabase (base de données Postgres + stockage de fichiers). Voir [`DEPLOYMENT.md`](./DEPLOYMENT.md) pour le guide complet, y compris comment relire le projet dans Google Antigravity avant de le déployer.

## Fonctionnalités

### Espace gestionnaire

- **Tableau de bord** : nombre de biens, disponibilité, locataires, revenus mensuels, taux d'occupation, factures en retard, incidents ouverts, graphique des revenus sur 6 mois.
- **Biens immobiliers** : ajout / modification / suppression avec image, surface, loyer, statut (disponible, occupé, maintenance).
- **Locataires** : gestion des contacts (nom, téléphone, email, pièce d'identité) + création de l'accès au portail locataire.
- **Contrats** : liaison bien ↔ locataire avec loyer, dépôt de garantie, dates, statut. Génère automatiquement les échéances de loyer mensuelles.
- **Paiements de loyer** : suivi des mensualités par locataire, marquage manuel "réglée", historique par moyen de paiement.
- **Rappels automatiques par email** : un job planifié (par défaut tous les jours à 8h) détecte les contrats arrivant à échéance dans 14 jours (configurable) et envoie un email au gestionnaire, avec protection anti-doublon.
- **Incidents** : consultation de tous les signalements des locataires avec photo, changement de statut (ouvert / en cours / résolu / rejeté), note interne.

### Aussi dans l'espace gestionnaire

- **Propriétaires** : fiche, espace dédié, **compte-rendu de gestion** (CRG) mensuel dans la langue du propriétaire, reversements enregistrés et annoncés par e-mail, bilan fiscal.
- **Impayés** : relances graduées par e-mail et WhatsApp, mise en demeure, garants et colocataires prévenus, paiements partiels, quittances et reçus.
- **Baux** : colocation, garants, révision de loyer, avenants, état des lieux d'entrée et de sortie, assurances, dépenses (dont récurrentes), prestataires.
- **Vitrine** : annonces publiques et demandes de visite reçues dans un CRM.
- **Compte et sécurité** : double authentification (TOTP), collaborateurs avec rôles, journal d'activité, import de données, abonnement (Stripe, PayDunya), notifications dans la langue de l'interface.
- **Administration de la plateforme** : rôle `ADMIN`, avec journal d'audit.

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

Ouvrez http://localhost:5173 et connectez-vous avec l'un des comptes ci-dessus (mot de passe affiché par le seed). `npm test` lance les tests du frontend ; `npm run build` produit la version de production.

## Configuration

### Emails de rappel (SMTP Gmail)

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

- **Stripe** : renseignez `STRIPE_SECRET_KEY` (et `STRIPE_WEBHOOK_SECRET` pour les webhooks), puis complétez `initiateStripePayment` avec le SDK `stripe` (créer une Checkout Session).
- **PayDunya** (Orange Money, Wave, Free Money, MTN, carte bancaire — agrégateur ouest-africain, https://paydunya.com) : créez un compte gratuit, récupérez vos clés dans **Compte → Clés API**, renseignez `PAYDUNYA_MASTER_KEY` / `PAYDUNYA_PRIVATE_KEY` / `PAYDUNYA_PUBLIC_KEY` / `PAYDUNYA_TOKEN`, et passez `PAYDUNYA_MODE=live` une fois prêt (par défaut `test` = bac à sable, aucun vrai paiement). Le locataire ou le gestionnaire est redirigé vers une page de paiement hébergée par PayDunya ; la confirmation revient ensuite via le webhook `POST /api/payments/paydunya/ipn` (`backend/src/controllers/paydunya.controller.ts`), authentifié par un hash SHA-512 de la master key — assurez-vous que `PUBLIC_BACKEND_URL` (ou `VERCEL_PROJECT_PRODUCTION_URL` sur Vercel) pointe bien vers une URL publique joignable par PayDunya.
- **Stripe et PayDunya ne servent qu'aux abonnements** des agences (le compte est celui de la plateforme). Le loyer d'un locataire ne se règle pas par carte ni Mobile Money tant que `RENT_ONLINE_PAYMENTS` n'est pas `true` : un loyer payé là transiterait par le compte de la plateforme avant d'être reversé à l'agence. Ne l'activer qu'avec un montage dédié (compte par agence) validé juridiquement.
- **Virement bancaire** : le locataire déclare une référence de virement ; le gestionnaire valide manuellement dans l'onglet "Paiements" ("Marquer réglée").
- **Mode démo** (`PAYMENTS_DEMO_MODE`) : les paiements sont simulés et confirmés instantanément, sans aucune vraie transaction — pratique pour tester tout le flux en local. Il est **actif par défaut en local, et désactivé par défaut en production** (`NODE_ENV=production` ou Vercel). Ne le mettez **jamais** à `true` en production : un abonnement s'activerait sans qu'un centime ne soit encaissé. Il court-circuite aussi Stripe et PayDunya, même si leurs clés sont configurées.

### Base de données et fichiers (Supabase)

- **Base de données** : PostgreSQL hébergé par Supabase. Utilisez la chaîne de connexion **Transaction pooler** (port 6543) — recommandée pour les environnements serverless comme Vercel (voir [`DEPLOYMENT.md`](./DEPLOYMENT.md)).
- **Fichiers uploadés** (images de biens, photos d'incidents, pièces d'identité) : stockés sur Supabase Storage (`backend/src/services/storage.service.ts`), pas sur disque local — nécessaire car Vercel n'offre pas de disque persistant. Les pièces d'identité (sensibles) vivent dans un bucket privé et ne sont accessibles que via une URL signée à durée limitée, générée à la demande.

## Déploiement en production

Guide complet, y compris la relecture du projet dans Google Antigravity, la création du projet Supabase, et le déploiement sur Vercel (frontend + backend, tâche planifiée incluse) : voir **[`DEPLOYMENT.md`](./DEPLOYMENT.md)**.

En résumé :
- Backend et frontend sont déployés comme **deux projets Vercel séparés** pointant vers le même dépôt (Root Directory `backend` et `frontend`).
- Les rappels automatiques de fin de contrat passent par un **Vercel Cron Job** (`backend/vercel.json`) plutôt qu'un processus continu, puisque Vercel ne fait tourner que des fonctions à la demande.
- Pensez à définir `FRONTEND_URL` (backend) et `VITE_API_URL` (frontend) vers les URLs publiques réelles une fois les deux projets déployés.
- **Sauvegarde** : le plan gratuit de Supabase ne sauvegarde rien. Un workflow GitHub copie la base chaque nuit (copie chiffrée, restaurée à blanc pour vérification) ; mise en place et restauration : `DEPLOYMENT.md`, « Sauvegarde et restauration ».
- **CI** : chaque push et pull request lance les types et les tests des deux applications (`.github/workflows/ci.yml`).

## Sécurité

- Les mots de passe sont hashés avec bcrypt.
- Les routes sont protégées par JWT et un contrôle de rôle (`MANAGER`, `TENANT`, `OWNER`, `ADMIN`), avec double authentification (TOTP) pour les gestionnaires qui l'activent.
- Un locataire ne peut voir/payer que ses propres factures et signaler des incidents que sur ses propres contrats.
- Note de dépendance : `drizzle-kit` (outil CLI utilisé uniquement en développement local pour appliquer le schéma) dépend d'une version d'`esbuild` avec un avis de sécurité concernant son serveur de développement. Cet outil n'est jamais exécuté en production ni exposé publiquement — le risque ne s'applique donc pas à l'application déployée.

## Structure du projet

```
gestion-immo/
├── DEPLOYMENT.md           # guide Antigravity → Supabase → Vercel, sauvegarde et restauration
├── .github/workflows/      # CI, avis de sécurité hebdomadaire, sauvegarde nocturne de la base
├── backend/
│   ├── scripts/sauvegarde/ # sauvegarde chiffrée et restauration de la base
│   ├── vercel.json         # config Vercel Cron Job (rappels de fin de contrat)
│   ├── src/
│   │   ├── config/        # variables d'environnement, client Supabase (storage)
│   │   ├── db/            # schéma et client Drizzle (Postgres/Supabase)
│   │   ├── middleware/     # auth JWT, upload de fichiers (mémoire), gestion d'erreurs
│   │   ├── controllers/    # logique métier par ressource
│   │   ├── routes/         # routes Express
│   │   ├── services/       # emails, paiements, factures, stockage, rappels planifiés
│   │   └── seed.ts         # données de démonstration
└── frontend/
    ├── vercel.json         # réécriture SPA pour React Router
    └── src/
        ├── pages/manager/   # espace gestionnaire
        ├── pages/tenant/    # portail locataire
        ├── components/      # mise en page, éléments réutilisables
        └── context/         # authentification
```
