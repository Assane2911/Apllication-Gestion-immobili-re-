#!/usr/bin/env bash
#
# Sauvegarde logique, chiffrée, de la base de l'application.
#
#   DATABASE_URL=...  BACKUP_PASSPHRASE=...  sauvegarder.sh <dossier-de-sortie>
#
# Écrit dans le dossier, sous un nom horodaté (UTC) :
#   immoplatform-AAAAMMJJ-HHMMSS.dump.gpg         la copie : pg_dump (format « custom »), chiffrée en AES-256
#   immoplatform-AAAAMMJJ-HHMMSS.dump.gpg.sha256  son empreinte, pour détecter un fichier abîmé avant de restaurer
# et n'affiche, en dernière ligne, que le nom de la copie.
#
# Seul le schéma `public` est copié : c'est celui de l'application. Les schémas gérés par Supabase (auth, storage...)
# se recréent avec le projet ; les FICHIERS déposés (espaces de stockage) ne sont pas dans une copie de base — voir
# DEPLOYMENT.md, « Sauvegarde et restauration ».
#
# Aucune trace des commandes (pas de `set -x`) : elle afficherait l'adresse de la base, mot de passe compris. La
# phrase de passe passe par un descripteur de fichier, jamais en argument (visible dans la liste des processus).
set -euo pipefail

echec() {
  echo "Erreur : $*" >&2
  exit 1
}

[[ -n "${DATABASE_URL:-}" ]] || echec "la variable DATABASE_URL (adresse de la base à sauvegarder) est absente."
[[ -n "${BACKUP_PASSPHRASE:-}" ]] || echec "la variable BACKUP_PASSPHRASE (phrase de passe de chiffrement) est absente."
sortie="${1:-}"
[[ -n "$sortie" && -d "$sortie" ]] || { echo "Usage : sauvegarder.sh <dossier-de-sortie existant>" >&2; exit 2; }

# Forme de l'adresse, vérifiée AVANT d'appeler pg_dump. Une faute de frappe courante (crochets du « [YOUR-PASSWORD] » de
# Supabase gardés, « @ » dans le mot de passe, mauvais port) fait sinon répondre à pg_dump « could not translate host name
# "…fin-du-mot-de-passe@serveur" », et ce journal est public : un morceau du mot de passe y apparaît. Les messages ci-dessous
# disent quoi corriger sans jamais citer un morceau de l'adresse.
[[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]] || echec "l'adresse (DATABASE_URL) doit commencer par postgresql://"
arobases="${DATABASE_URL//[^@]/}"
if [[ "${#arobases}" -gt 1 ]]; then
  echec "l'adresse contient ${#arobases} « @ » au lieu d'un seul (celui qui précède le nom du serveur). Un « @ » dans le mot de passe doit s'écrire %40 ; sinon choisissez un mot de passe en lettres et chiffres."
fi
mot_de_passe=""
infos=""
if [[ "${#arobases}" -eq 1 ]]; then
  reste="${DATABASE_URL#*://}"
  infos="${reste%%@*}"
  if [[ "$infos" == *"["* || "$infos" == *"]"* ]]; then
    echec "l'adresse contient des crochets autour de l'utilisateur ou du mot de passe. Remplacez « [YOUR-PASSWORD] » tout entier, crochets compris, par le mot de passe."
  fi
  if [[ "$infos" == *:* ]]; then mot_de_passe="${infos#*:}"; fi
  hote_port="${reste#*@}"
  hote_port="${hote_port%%/*}"
  hote="${hote_port%%:*}"
  port=""
  if [[ "$hote_port" == *:* ]]; then port="${hote_port##*:}"; fi
  if [[ "$hote" == *.pooler.supabase.com ]]; then
    if [[ -n "$port" && "$port" != "5432" ]]; then
      echec "le port est $port : il faut le Session pooler de Supabase, port 5432 (le Transaction pooler, port 6543, ne convient pas à pg_dump)."
    fi
    [[ "${infos%%:*}" == *.* ]] || echec "sur le pooler Supabase, l'utilisateur doit s'écrire « nom.référence du projet » (par exemple sauvegarde.abcdefghij), pas le nom seul."
  fi
fi

# Le mot de passe de l'adresse, retiré de tout message d'erreur renvoyé par un outil.
masquer() {
  local texte
  texte="$(cat)"
  [[ -n "$mot_de_passe" ]] && texte="${texte//"$mot_de_passe"/***}"
  printf '%s\n' "$texte"
}

travail="$(mktemp -d)"
nom="immoplatform-$(date -u +%Y%m%d-%H%M%S).dump.gpg"
termine=0
nettoyer() {
  rm -rf "$travail"
  # Jamais de copie à moitié écrite laissée dans le dossier de sortie.
  if [[ "$termine" -ne 1 ]]; then rm -f "$sortie/$nom" "$sortie/$nom.sha256"; fi
}
trap nettoyer EXIT

dump="$travail/base.dump"
if ! pg_dump --format=custom --schema=public --no-owner --no-privileges --file="$dump" --dbname="$DATABASE_URL" 2>"$travail/erreur.txt"; then
  { echo "Erreur : pg_dump a échoué."; masquer <"$travail/erreur.txt"; } >&2
  exit 1
fi

# Une sauvegarde sans aucune table (mauvaise adresse, base neuve) serait « réussie » et inutile : on la refuse.
tables="$(pg_restore --list "$dump" | grep -c ' TABLE DATA ' || true)"
[[ "$tables" -ge 1 ]] || echec "aucune table dans le schéma public de la base : mauvaise adresse ? Rien n'a été sauvegardé."

if ! printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 \
  --compress-algo none --output "$sortie/$nom" "$dump" 2>"$travail/erreur-gpg.txt"; then
  { echo "Erreur : le chiffrement a échoué."; masquer <"$travail/erreur-gpg.txt"; } >&2
  exit 1
fi

(cd "$sortie" && sha256sum "$nom" >"$nom.sha256")
termine=1
echo "Sauvegarde : $tables tables, copie chiffrée." >&2
echo "$nom"
