-- Jeu de données pour simuler {{AGENCES}} agences sur une base LOCALE vide, jamais en production.
-- Modèle de texte rempli par simuler.js ({{AGENCES}}, {{N_STARTER}}, {{N_PRO}}) : ne pas l'exécuter tel quel.
--
-- Profil : le plan d'une agence suit sa taille, comme les limites de chaque formule (Starter : 5 biens, Pro : 25 biens,
-- Enterprise : illimité). Les agences Starter ont 5 biens, les Pro 20, les Enterprise 100 (une sur dix en a 400).
-- Un bail actif par bien, douze mois de factures jusqu'au mois d'octobre 2026 (le dernier mois en cours, en partie impayé).
BEGIN;

CREATE TEMP TABLE agence AS
SELECT n, 'm' || n AS id,
       CASE WHEN n <= {{N_STARTER}} THEN 'STARTER' WHEN n <= {{N_STARTER}} + {{N_PRO}} THEN 'PRO' ELSE 'ENTERPRISE' END AS plan,
       CASE WHEN n <= {{N_STARTER}} THEN 5 WHEN n <= {{N_STARTER}} + {{N_PRO}} THEN 20 WHEN n % 10 = 0 THEN 400 ELSE 100 END AS biens
FROM generate_series(1, {{AGENCES}}) n;

-- Agences (gestionnaires) : abonnement actif ; le mot de passe n'est pas utilisé (les jetons sont forgés par charge.js).
INSERT INTO users (id, email, password_hash, role, subscription_status, subscription_plan, email_verified_at, trial_ends_at)
SELECT id, 'agence' || n || '@charge.local', 'x', 'MANAGER', 'ACTIVE', plan, now(), now() + interval '30 days' FROM agence;

INSERT INTO agency_settings (id, user_id) SELECT 'as' || n, id FROM agence;

-- Propriétaires : un pour cinq biens.
INSERT INTO owners (id, manager_id, first_name, last_name, phone, email, management_fee_rate)
SELECT 'o' || a.n || '_' || k, a.id, 'Prop' || k, 'Agence' || a.n, '+22177' || lpad((a.n * 100 + k)::text, 7, '0'),
       'prop' || a.n || '_' || k || '@charge.local', 8
FROM agence a, LATERAL generate_series(1, greatest(1, a.biens / 5)) k;

-- Biens, locataires, baux : un de chaque par rang.
INSERT INTO properties (id, manager_id, title, address, surface, rent, currency, owner_id)
SELECT 'p' || a.n || '_' || k, a.id, 'Bien ' || k || ' agence ' || a.n, k || ' rue de la Charge, Dakar', 40 + (k % 60), 150000 + (k % 20) * 25000, 'XOF',
       'o' || a.n || '_' || (1 + (k - 1) % greatest(1, a.biens / 5))
FROM agence a, LATERAL generate_series(1, a.biens) k;

INSERT INTO tenants (id, manager_id, first_name, last_name, phone, email)
SELECT 't' || a.n || '_' || k, a.id, 'Loc' || k, 'Agence' || a.n, '+22178' || lpad((a.n * 1000 + k)::text, 7, '0'), 'loc' || a.n || '_' || k || '@charge.local'
FROM agence a, LATERAL generate_series(1, a.biens) k;

INSERT INTO contracts (id, property_id, tenant_id, rent, deposit, start_date, end_date, currency, status, payment_day)
SELECT 'c' || a.n || '_' || k, 'p' || a.n || '_' || k, 't' || a.n || '_' || k, 150000 + (k % 20) * 25000, 300000 + (k % 20) * 50000,
       timestamp '2025-11-01', timestamp '2028-11-01', 'XOF', 'ACTIVE', 31
FROM agence a, LATERAL generate_series(1, a.biens) k;

-- Douze mois de factures (nov. 2025 à oct. 2026) : les onze premiers payés ; octobre payé aux 2/3, le reste en attente ou en retard.
CREATE TEMP TABLE mois AS
SELECT i AS rang, (date_trunc('month', timestamp '2025-11-01') + (i - 1) * interval '1 month') AS debut FROM generate_series(1, 12) i;

INSERT INTO invoices (id, contract_id, period_month, period_year, amount, due_date, currency, status, paid_at, amount_paid, payment_method)
SELECT 'i' || c.id || '_' || m.rang, c.id, extract(month FROM m.debut)::int, extract(year FROM m.debut)::int, c.rent,
       m.debut + interval '1 month' - interval '1 day', 'XOF',
       CASE WHEN m.rang < 12 OR (abs(hashtext(c.id)) % 3) <> 0 THEN 'PAID' WHEN abs(hashtext(c.id)) % 2 = 0 THEN 'LATE' ELSE 'PENDING' END,
       CASE WHEN m.rang < 12 OR (abs(hashtext(c.id)) % 3) <> 0 THEN m.debut + interval '1 month' - interval '3 days' END,
       CASE WHEN m.rang < 12 OR (abs(hashtext(c.id)) % 3) <> 0 THEN c.rent ELSE 0 END,
       CASE WHEN m.rang < 12 OR (abs(hashtext(c.id)) % 3) <> 0 THEN 'MOBILE_MONEY' END
FROM contracts c, mois m;

INSERT INTO invoice_payments (id, invoice_id, amount, paid_at, payment_method)
SELECT 'ip' || i.id, i.id, i.amount, i.paid_at, 'MOBILE_MONEY' FROM invoices i WHERE i.status = 'PAID';

-- Quelques dépenses et lignes de journal par agence.
INSERT INTO expenses (id, property_id, title, amount, category, expense_date)
SELECT 'e' || p.id || '_' || k, p.id, 'Entretien ' || k, 20000 + k * 5000, 'MAINTENANCE', timestamp '2026-03-10' + k * interval '20 days'
FROM properties p, LATERAL generate_series(1, 2) k WHERE abs(hashtext(p.id)) % 3 = 0;

INSERT INTO activity_logs (id, manager_id, action, actor_label, entity_type, entity_label)
SELECT 'al' || a.n || '_' || k, a.id, 'contract.update', 'Gestionnaire', 'contract', 'Bail ' || k
FROM agence a, LATERAL generate_series(1, 60) k;

COMMIT;
