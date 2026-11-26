-- Suppression des colonnes iban et bic (retrait du virement bancaire, PR #577).
--
-- À APPLIQUER DANS CET ORDRE, ET PAS AUTREMENT :
--   1. déployer d'abord le code qui ne nomme plus ces colonnes (schema.ts, initDb) ;
--   2. vérifier que ce déploiement est stable (/api/health, aucune erreur d'exécution) ;
--   3. seulement alors, jouer ce script. Joué AVANT, il casserait toute requête de l'ancien code, puisque Drizzle
--      nomme chaque colonne déclarée : « column iban does not exist » sur /api/owners, /api/agency, les CRG…
--
-- IRRÉVERSIBLE : les valeurs sont perdues. Retour arrière possible uniquement depuis la sauvegarde quotidienne
-- (workflow « sauvegarde », artefact chiffré conservé 30 jours) : en vérifier la fraîcheur avant de jouer le script.
--
-- Vérification préalable (lecture seule) — owners et agency_settings doivent afficher 0 ; platform_settings porte le RIB
-- de l'exploitant, qui disparaît avec la colonne :
--   SELECT 'owners' t, count(*) FILTER (WHERE iban IS NOT NULL OR bic IS NOT NULL) FROM owners
--   UNION ALL SELECT 'agency_settings', count(*) FILTER (WHERE iban IS NOT NULL OR bic IS NOT NULL) FROM agency_settings
--   UNION ALL SELECT 'platform_settings', count(*) FILTER (WHERE iban IS NOT NULL OR bic IS NOT NULL) FROM platform_settings;
--
-- Idempotent (IF EXISTS) et en une seule transaction : tout ou rien. Aucune contrainte, vue ni index ne dépend de ces
-- colonnes (relevé en production le 2026-11-26).
-- Hors périmètre, volontairement : la valeur BANK_TRANSFER des contraintes CHECK (lignes d'historique existantes).

BEGIN;

ALTER TABLE owners DROP COLUMN IF EXISTS iban;
ALTER TABLE owners DROP COLUMN IF EXISTS bic;

ALTER TABLE agency_settings DROP COLUMN IF EXISTS iban;
ALTER TABLE agency_settings DROP COLUMN IF EXISTS bic;

ALTER TABLE platform_settings DROP COLUMN IF EXISTS iban;
ALTER TABLE platform_settings DROP COLUMN IF EXISTS bic;

COMMIT;
