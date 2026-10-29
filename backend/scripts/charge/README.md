# Kit de simulation de charge

Répond à la question « et avec N gestionnaires ? ». Une seule commande monte une base de test, la remplit avec N agences réalistes, fait travailler le vrai backend sous charge croissante, mesure l'envoi quotidien des e-mails, et écrit un **rapport** avec un verdict, les goulots d'étranglement et le **revenu estimé en FCFA**.

> **Jamais contre la production.** Le kit crée sa propre base Postgres locale (ou s'attache à une base `localhost` vide) et refuse toute autre adresse. Il n'appelle aucun service extérieur : ni Supabase, ni Vercel, ni paiement, ni WhatsApp, ni vrai serveur d'e-mails.

## Lancer

```bash
cd backend
npm ci                                   # une fois
node scripts/charge/simuler.js --agences 500
```

Le rapport est écrit dans `backend/scripts/charge/rapports/simulation-500-agences-<date>.md` (dossier ignoré par git). Compter environ 6 minutes pour 500 agences avec les réglages par défaut.

Pour voir toutes les options : `node scripts/charge/simuler.js --aide`.

## Exemples

```bash
# 200 agences, davantage de formules Starter
node scripts/charge/simuler.js --agences 200 --profil starter=40,pro=55,enterprise=5

# 1 000 agences, paliers plus fins et mesures plus longues
node scripts/charge/simuler.js --agences 1000 --paliers 5,10,20,40,70,100 --duree 60

# Seulement la consultation, sans le test d'e-mails
node scripts/charge/simuler.js --agences 500 --sans-cron

# Et si l'envoi d'un e-mail prend 1,2 s au lieu de 0,5 s, avec 10 envois de front ?
node scripts/charge/simuler.js --agences 500 --delai-smtp 1200 --parallele 10
```

## Ce que fait chaque étape

1. **Compile** le backend (comme en production) si besoin (`--reconstruire` pour forcer).
2. **Crée un Postgres local** réglé comme votre base de production : 60 connexions maximum et un petit cache (224 Mo). Il est supprimé à la fin (`--garder` pour le conserver).
3. **Démarre le backend** en plusieurs instances (6 par défaut), chacune avec une seule connexion à la base, comme les fonctions Vercel.
4. **Remplit la base** avec N agences. Une agence a la formule que sa taille impose : **Starter** 5 biens, **Pro** 20 biens, **Enterprise** 100 biens (une sur dix en a 400). Un bail actif par bien et douze mois de factures payées, dont le mois en cours en partie impayé.
5. **Applique la charge** par paliers (10, 20, 40, 100 % des agences connectées en même temps). Chaque gestionnaire enchaîne une session type de 11 requêtes : tableau de bord, notifications, listes, comptes-rendus de gestion, relevé annuel, synthèse fiscale.
6. **Mesure la tâche quotidienne** d'envoi d'e-mails contre un faux serveur SMTP (délai fixe par message).
7. **Écrit le rapport**, avec le revenu calculé sur les prix lus dans `subscription.controller.ts` (une seule source de vérité).

## Lire le rapport

| Verdict | Signification |
|---|---|
| 🟢 OK | 95 % des requêtes répondent en moins de 500 ms |
| 🟠 limite | sous 1,5 s |
| 🔴 saturé | au-delà de 1,5 s |
| 🔴 KO | plus de 1 % d'erreurs |

- Le palier le plus haut qui reste vert ou orange est le **nombre de gestionnaires connectés en même temps** que le service absorbe sur la machine de test.
- La section « Où est le goulot ? » compare le temps de la base au temps du backend.
- La section « Tâche quotidienne » projette combien de jours il faut pour envoyer tous les avis d'échéance du mois.

## Réglages utiles

| Option | Rôle | Défaut |
|---|---|---|
| `--agences` | nombre de gestionnaires simulés | 500 |
| `--profil` | répartition des formules en % (somme 100) | `starter=20,pro=70,enterprise=10` |
| `--paliers` | % d'agences connectées en même temps | `10,20,40,100` |
| `--duree` | secondes de mesure par palier | 40 |
| `--pause` | pause moyenne entre deux requêtes d'un utilisateur (ms) | 1000 |
| `--instances` | instances du backend | 6 |
| `--budget-cron` | secondes de budget du test d'e-mails | 30 |
| `--delai-smtp` | durée simulée d'un envoi d'e-mail (ms) | 500 |
| `--parallele` | envois d'e-mails de front | 5 |

## Prérequis

- Linux ou macOS (le script démarre un Postgres local ; sous Windows, utilisez WSL).
- Postgres 15 ou plus (`apt install postgresql`, `brew install postgresql@16`) : les binaires sont cherchés automatiquement (`--pg-bin` ou `PG_BIN` sinon). Si vous lancez le script en tant que root, il utilise l'utilisateur système `postgres`.
- Node 20 ou plus et les dépendances du backend (`npm ci`).
- Un port libre pour Postgres (5433, `--port-pg`) et les ports 4101 et suivants pour les instances.

## Limites à garder en tête

- **Une seule machine** : le backend, la base et le générateur de charge se partagent le même processeur. Sur Vercel, chaque fonction a le sien : les temps absolus mesurés ici sont **pessimistes** ; ce qui compte, c'est la courbe (où ça se dégrade) et la comparaison avant/après un changement.
- **Pas de pooler Supabase** ni de réseau entre Vercel et Supabase.
- **Le débit d'e-mails** dépend du vrai serveur d'envoi : le kit le simule par un délai fixe. Les limites par jour d'un compte Zoho ou Gmail ne sont pas simulées.
- Le **revenu** est brut : avant frais de paiement, taxes, essais gratuits non convertis et départs.

## Fichiers

| Fichier | Rôle |
|---|---|
| `simuler.js` | le chef d'orchestre, à lancer |
| `seed.sql` | modèle des données d'une agence (rempli par `simuler.js`) |
| `charge.js` | le générateur de charge (utilisable seul : voir l'en-tête du fichier) |
| `smtp-sink.js` | faux serveur SMTP avec délai fixe |
