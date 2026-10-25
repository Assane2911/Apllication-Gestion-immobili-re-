#!/usr/bin/env bash
# À exécuter une seule fois depuis frontend/, APRÈS "npx cap add android" et
# "npx cap add ios" (ces deux commandes doivent avoir déjà créé android/ et ios/).
# Insère les permissions nécessaires aux écrans qui utilisent <input type="file">
# (biens, contrats, incidents, logo de l'agence).
#
# Android : la CAMÉRA seulement (capture="environment" pour photographier un incident). Pas de
# READ_MEDIA_IMAGES : le sélecteur de fichiers du système donne accès aux seules photos choisies sans
# permission, et cette permission restreinte de Google Play ferait refuser la publication.
# iOS : descriptions d'usage de la caméra et de la photothèque, exigées par l'App Store.
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST="android/app/src/main/AndroidManifest.xml"
PLIST="ios/App/App/Info.plist"

if [ -f "$MANIFEST" ]; then
  if ! grep -q "android.permission.CAMERA" "$MANIFEST"; then
    perl -0pi -e 's{(<manifest[^>]*>)}{$1\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />}' "$MANIFEST"
    echo "OK  -> permissions ajoutées dans $MANIFEST"
  else
    echo "--  -> $MANIFEST contient déjà la permission CAMERA, rien à faire"
  fi
else
  echo "!!  -> $MANIFEST introuvable (avez-vous lancé \"npx cap add android\" ?)"
fi

if [ -f "$PLIST" ]; then
  if ! grep -q "NSCameraUsageDescription" "$PLIST"; then
    perl -0pi -e 's{(</dict>\s*</plist>)}{  <key>NSCameraUsageDescription</key>\n  <string>Permet de photographier un problème signalé pour illustrer le ticket.</string>\n  <key>NSPhotoLibraryUsageDescription</key>\n  <string>Permet de choisir une photo de bien ou un document depuis la bibliothèque.</string>\n$1}' "$PLIST"
    echo "OK  -> permissions ajoutées dans $PLIST"
  else
    echo "--  -> $PLIST contient déjà NSCameraUsageDescription, rien à faire"
  fi
else
  echo "!!  -> $PLIST introuvable (avez-vous lancé \"npx cap add ios\" ?)"
fi
