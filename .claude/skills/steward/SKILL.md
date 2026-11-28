---
name: steward
description: Conventions du dépôt pour mener une pull request jusqu'à la fusion, en particulier les PR de dépendances (Dependabot) : vérifications à faire avant de fusionner, dont l'aperçu Vercel du backend.
---

# Mener une pull request jusqu'à la fusion

Ces conventions complètent la consigne permanente du propriétaire du dépôt (« fusionne la PR quand la CI est verte »). Elles
ne donnent à personne le droit de fusionner : elles disent seulement quoi vérifier avant de le faire, quand c'est permis.

## Toute PR

1. Les 8 contrôles de la CI sont verts sur la dernière validation de la PR : Backend (types, types et tests, démarrage réel,
   trois tranches de tests), Frontend (construction et tests), Vercel Preview Comments.
2. Aucun conflit de fusion, aucun commentaire de relecture en attente.
3. Une PR qui change le comportement de l'application dit, dans son texte, ce qui a été vérifié et ce qui ne l'a pas été.

## PR de dépendances (Dependabot ou autre) qui touche `backend/`

Une CI verte ne suffit pas. Le 26 novembre 2026, la mise à jour de `pdfkit` en 0.21 (PR 534) passait toute la CI, puis a fait
planter la fonction Vercel au démarrage de l'API (`ERR_REQUIRE_ESM` : la dépendance `fontkit` v3 n'est qu'un module ES). La
cause n'apparaît pas dans la CI, qui démarre le serveur avec Node, pas avec l'environnement de Vercel. Avant de fusionner :

1. **L'aperçu Vercel du backend de la PR est `READY`** (projet `prj_mc2Fc7yAAZjCkf2cd4zI3mToWnkq`, équipe
   `team_y8ydHqxYj62oWBkMgkhx86Xi`). Un aperçu en échec, ou « Ignored » alors que le dossier `backend/` change, bloque la
   fusion.
2. **`/api/health/ready` de cet aperçu répond 200** (lecture de l'adresse de l'aperçu, pas de la production).
3. **Aucune erreur d'exécution** n'est signalée sur cet aperçu.
4. Si l'une de ces vérifications échoue : ne pas fusionner, dire laquelle a échoué, et ajouter la dépendance à la liste
   `ignore` de `.github/dependabot.yml` avec la raison, si le problème vient de la version et non de la PR.

Une dépendance qui change la façon dont un module est chargé (passage en module ES, nouvelle version majeure d'un paquet
d'extensions, pilote de base de données, moteur de PDF) mérite une vérification supplémentaire : ouvrir la route qui s'en
sert sur l'aperçu, pas seulement la route de santé.

## PR de dépendances qui touche seulement `frontend/`

L'aperçu Vercel du frontend est `READY` et la page d'accueil de l'aperçu se charge. Les versions majeures ne sont jamais
proposées par Dependabot : chacune est une migration à décider et à tester à part.

## Après la fusion d'une PR qui touche l'application

Vérifier le déploiement de production du commit de fusion : `READY`, alias `api.immoplatformpro.com` posé,
`/api/health/ready` en 200, aucune erreur d'exécution. Puis réaligner la branche de travail sur `main`.
