#!/usr/bin/env bash
# start-local.sh — Levanta el entorno local completo con backup importado
# Uso: ./scripts/start-local.sh [ruta-al-backup.json]
#
# Requiere: firebase CLI, node, npm

set -e

BACKUP_DIR="./backups/latest"
BACKUP_FILE="${1:-}"

echo "╔══════════════════════════════════════════╗"
echo "║   COSP V1.0 — Modo Local (Emulador)     ║"
echo "╚══════════════════════════════════════════╝"

# 1. Preparar .env.local con modo emulador
echo "▶ Activando modo emulador..."
cp apps/web2/.env.emulator apps/web2/.env.local
# Completar con las vars reales de producción si están disponibles
if [ -f ".env.production" ]; then
  grep "NEXT_PUBLIC_FIREBASE" .env.production >> apps/web2/.env.local
fi

# 2. Importar backup si se pasa uno
IMPORT_FLAG=""
if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
  echo "▶ Importando backup desde: $BACKUP_FILE"
  node scripts/import-backup.js "$BACKUP_FILE" "$BACKUP_DIR"
  IMPORT_FLAG="--import=$BACKUP_DIR"
elif [ -d "$BACKUP_DIR" ]; then
  echo "▶ Usando backup existente en: $BACKUP_DIR"
  IMPORT_FLAG="--import=$BACKUP_DIR"
else
  echo "⚠  Sin backup — emulador arranca vacío"
fi

# 3. Levantar emuladores en background + Next.js dev
echo "▶ Iniciando Firebase Emulators + Next.js..."
firebase emulators:start $IMPORT_FLAG --export-on-exit="$BACKUP_DIR" &
EMULATOR_PID=$!

sleep 4

npm --prefix apps/web2 run dev

# Al cerrar Next.js, también cierra los emuladores
kill $EMULATOR_PID 2>/dev/null || true
echo "✔ Entorno local detenido."
