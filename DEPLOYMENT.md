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
npm run seed       # (optionnel) données de démonstration
```

---

## Étape 3 — Déployer sur Vercel

Ce projet est un monorepo avec deux applications (`backend/` et `frontend/`) : créez **deux projets Vercel séparés** pointant vers le même dépôt GitHub, chacun avec un "Root Directory" différent.

### 3.1 Déployer le backend

1. Sur [vercel.com](https://vercel.com) → **Add New → Project** → importez le dépôt GitHub `Apllication-Gestion-immobili-re-`.
2. **Root Directory** : `backend`.
3. Vercel détecte automatiquement Express (zero-config).
4. Renseignez les variables d'environnement (Project Settings → Environment Variables) — reprenez tout `backend/.env.example`, notamment :
   - `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLIC_BUCKET`, `SUPABASE_PRIVATE_BUCKET`
   - `JWT_SECRET` (générez une vraie valeur aléatoire, différente de celle de dev)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `EMAIL_FROM`, `CONTRACT_REMINDER_DAYS`
   - `CRON_SECRET` : générez une valeur aléatoire (16+ caractères) — Vercel l'enverra automatiquement en en-tête `Authorization` lors de l'appel du Cron Job
   - `ENABLE_INTERNAL_CRON=false` (important : sur Vercel, le scheduler interne node-cron ne doit pas tourner — c'est le Vercel Cron Job, défini dans `backend/vercel.json`, qui appelle `/api/cron/contract-reminders` une fois par jour)
   - `FRONTEND_URL` : à renseigner une fois le frontend déployé (étape suivante), pour l'autorisation CORS
5. Déployez. Notez l'URL générée (ex: `https://gestion-immo-api.vercel.app`).
6. Une fois déployé, vérifiez dans **Project Settings → Cron Jobs** que `contract-reminders` apparaît bien planifié.

> **Plan Hobby (gratuit)** : les Cron Jobs sont limités à une exécution par jour, avec une précision "dans l'heure" (ex: `0 8 * * *` peut se déclencher entre 8h00 et 8h59) — c'est exactement adapté à un rappel quotidien de fin de contrat.

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
- Connectez-vous sur le frontend déployé avec le compte gestionnaire créé par le seed (ou créez-en un via `POST /api/auth/register`).
- Testez un paiement en mode démo depuis le portail locataire.
- Testez manuellement le rappel de fin de contrat avant d'attendre le lendemain :
  ```bash
  curl -H "Authorization: Bearer VOTRE_CRON_SECRET" https://votre-backend.vercel.app/api/cron/contract-reminders
  ```
- Vérifiez dans Supabase → Storage que les fichiers uploadés (image d'un bien, photo d'incident) apparaissent bien dans `public-uploads`.

---

## Ce qui a changé dans le code pour cette cible de déploiement

- **Base de données** : `better-sqlite3` → `postgres-js` + Drizzle en dialecte `postgresql` (`backend/src/db/`).
- **Fichiers** : plus de disque local (`backend/uploads/` a été supprimé) — tout passe par `backend/src/services/storage.service.ts` vers Supabase Storage. Les pièces d'identité (bucket privé) sont servies via URL signée générée à la demande (`GET /api/tenants/:id/id-document-url`), jamais via un lien public permanent.
- **Rappels planifiés** : `node-cron` reste actif en développement local (`ENABLE_INTERNAL_CRON=true`) mais est désactivé en production ; `backend/vercel.json` déclare un Vercel Cron Job quotidien qui appelle `GET /api/cron/contract-reminders`, protégé par le header `Authorization: Bearer $CRON_SECRET` que Vercel envoie automatiquement.
- **Frontend** : `frontend/vercel.json` ajoute une règle de réécriture pour que le routage côté client (React Router) fonctionne aussi sur un rechargement de page ou un lien direct (ex: `/portail/paiements`).
