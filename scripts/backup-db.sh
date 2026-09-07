#!/usr/bin/env bash
# Dump the production database to a local file, and prove the file is usable.
#
#   DATABASE_URL='<External Database URL from Render>' ./scripts/backup-db.sh
#
# Render's free Postgres expires 30 days after creation: it goes read-only,
# then Render deletes it and everything in it after a 14-day grace period. The
# SCHEMA is safe either way — prisma/schema.prisma and the migrations are in
# git — but merchants, orders, the ledger and every product photo exist in
# exactly one place. This is the second place.
#
# ALLOW_LOCAL=1 permits a local URL so the script itself can be tested. An
# untested backup script is one you find out about on the day you need it.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required." >&2
  echo "Render dashboard -> your Postgres -> Connections -> External Database URL" >&2
  exit 1
fi

if [ -z "${ALLOW_LOCAL:-}" ]; then
  case "$DATABASE_URL" in
    *localhost*|*127.0.0.1*)
      echo "That is a LOCAL database. Pass Render's External Database URL," >&2
      echo "or this backs up development data and proves nothing." >&2
      echo "(Set ALLOW_LOCAL=1 only to test this script.)" >&2
      exit 1
      ;;
  esac
fi

command -v pg_dump >/dev/null || {
  echo "pg_dump not found:  sudo apt install postgresql-client" >&2
  exit 1
}

# Prisma appends ?schema=public, which pg_dump rejects with "invalid URI query
# parameter" — and with stderr hidden that produces a small file containing no
# tables, which looks like a backup until the day it matters.
PG_URL="${DATABASE_URL%%\?*}"

OUT_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/rhodium-$(date +%Y%m%d-%H%M%S).sql.gz"

echo "Dumping to $FILE ..."
# --no-owner / --no-acl so it restores into a database whose roles differ from
# the one it came from, which is the situation you will actually be in.
pg_dump "$PG_URL" --no-owner --no-acl | gzip > "$FILE"
echo "Wrote $FILE ($(du -h "$FILE" | cut -f1))"

# A dump that cannot be read is not a backup. Read the table names out of the
# file itself rather than pattern-matching one per table: pg_dump quotes
# reserved words, so `order` appears as public."order" while the rest are
# bare, and a pattern that misses that reports a good dump as empty.
echo "Verifying ..."
FOUND=$(gzip -dc "$FILE" | sed -n 's/^CREATE TABLE public\.\(.*\) ($/\1/p' | tr -d '"' | sort)

missing=0
for table in merchant order payment ledger_entry buyer product media_object; do
  if printf '%s\n' "$FOUND" | grep -qx "$table"; then
    printf '  %-16s ok\n' "$table"
  else
    printf '  %-16s MISSING\n' "$table"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -gt 0 ]; then
  echo >&2
  echo "$missing expected table(s) absent — do NOT treat this file as a backup." >&2
  exit 1
fi

echo
echo "All expected tables present."
echo "Now copy it somewhere else — a backup beside the thing it protects is not one."
