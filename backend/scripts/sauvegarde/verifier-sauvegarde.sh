#!/usr/bin/env bash
#
# Restaure une copie produite par sauvegarder.sh dans une base VIDE, puis compte les lignes de chaque table.
#
#   RESTORE_DATABASE_URL=...  BACKUP_PASSPHRASE=...  [DATABASE_URL=...]  verifier-sauvegarde.sh <copie.dump.gpg>
#
# Sert à deux choses : prouver, à chaque sauvegarde, qu'elle se restaure (le workflow le fait dans un PostgreSQL
# jetable), et restaurer pour de bon dans un projet neuf (voir DEPLOYMENT.md).
#
# Garde-fous : la base cible doit être VIDE (aucune table dans `public`) et différer de la base sauvegardée
# (DATABASE_URL, si elle est fournie) ; la restauration est faite d'un seul bloc, tout ou rien ; l'empreinte de la copie
# est contrôlée avant tout déchiffrement quand le fichier `.sha256` est à côté.
set -euo pipefail

echec() {
  echo "Erreur : $*" >&2
  exit 1
}

[[ -n "${RESTORE_DATABASE_URL:-}" ]] || echec "la variable RESTORE_DATABASE_URL (adresse de la base VIDE où restaurer) est absente."
[[ -n "${BACKUP_PASSPHRASE:-}" ]] || echec "la variable BACKUP_PASSPHRASE (phrase de passe de chiffrement) est absente."
copie="${1:-}"
[[ -n "$copie" && -f "$copie" ]] || { echo "Usage : verifier-sauvegarde.sh <copie.dump.gpg>" >&2; exit 2; }

if [[ -n "${DATABASE_URL:-}" && "$RESTORE_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echec "l'adresse de restauration est celle de la base sauvegardée : refusé, une restauration ne doit jamais écraser la source."
fi

mot_de_passe=""
if [[ "$RESTORE_DATABASE_URL" =~ ^[a-z]+://[^:/@]+:([^@]+)@ ]]; then mot_de_passe="${BASH_REMATCH[1]}"; fi
masquer() {
  local texte
  texte="$(cat)"
  [[ -n "$mot_de_passe" ]] && texte="${texte//"$mot_de_passe"/***}"
  printf '%s\n' "$texte"
}

travail="$(mktemp -d)"
trap 'rm -rf "$travail"' EXIT

# 1. L'empreinte : un fichier tronqué ou abîmé se voit ici, avant toute tentative de restauration.
if [[ -f "$copie.sha256" ]]; then
  (cd "$(dirname "$copie")" && sha256sum --check --status "$(basename "$copie").sha256") \
    || echec "l'empreinte de la copie ne correspond pas : fichier abîmé ou modifié, il ne sera pas restauré."
else
  echo "Attention : pas de fichier d'empreinte (.sha256) à côté de la copie, contrôle d'intégrité ignoré." >&2
fi

# 2. La cible doit être vide.
existantes="$(psql --no-psqlrc --quiet --tuples-only --no-align --dbname="$RESTORE_DATABASE_URL" \
  --command "select count(*) from information_schema.tables where table_schema = 'public'" 2>"$travail/erreur.txt")" \
  || { { echo "Erreur : la base de restauration est injoignable."; masquer <"$travail/erreur.txt"; } >&2; exit 1; }
[[ "$existantes" -eq 0 ]] || echec "la base de restauration n'est pas vide ($existantes tables dans public) : refusé, rien n'a été touché."

# 3. Déchiffrement.
if ! printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt --output "$travail/base.dump" "$copie" 2>/dev/null; then
  echec "déchiffrement impossible : phrase de passe incorrecte ou fichier abîmé."
fi

# 4. Restauration, tout ou rien. Le schéma `public` existe déjà dans toute base neuve (Supabase compris) : on retire de la
# liste des objets sa création et son commentaire, qui feraient échouer la restauration, et on garde tout le reste.
pg_restore --list "$travail/base.dump" | grep -Ev ' SCHEMA (- )?public( |$)' >"$travail/liste.txt" || true
if ! pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --use-list="$travail/liste.txt" --dbname="$RESTORE_DATABASE_URL" "$travail/base.dump" 2>"$travail/erreur.txt"; then
  { echo "Erreur : la restauration a échoué (rien n'a été appliqué)."; masquer <"$travail/erreur.txt"; } >&2
  exit 1
fi

# 5. Compte rendu : les lignes de chaque table.
echo "Restauration réussie. Lignes par table :"
tables="$(psql --no-psqlrc --quiet --tuples-only --no-align --dbname="$RESTORE_DATABASE_URL" \
  --command "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name")"
nombre=0
while IFS= read -r table; do
  [[ -n "$table" ]] || continue
  lignes="$(psql --no-psqlrc --quiet --tuples-only --no-align --dbname="$RESTORE_DATABASE_URL" --command "select count(*) from public.\"$table\"")"
  echo "  $table : $lignes"
  nombre=$((nombre + 1))
done <<<"$tables"
echo "$nombre tables restaurées."
