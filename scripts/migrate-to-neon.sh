#!/usr/bin/env bash
# Copy the live database into Neon, and prove the copy is complete.
#
#   SOURCE_DATABASE_URL='<Render External Database URL>' ./scripts/migrate-to-neon.sh
#
# The target defaults to NEON_DATABASE_URL from .env. Nothing is written to the
# source, and the script refuses to run if the target already holds data.
#
# Row counts are compared table by table at the end. A migration that "looked
# fine" but silently dropped the ledger is the failure worth engineering
# against, so a mismatch exits non-zero and says which table.
set -euo pipefail

SOURCE="${SOURCE_DATABASE_URL:-}"
TARGET="${TARGET_DATABASE_URL:-}"

if [ -z "$SOURCE" ]; then
  echo "SOURCE_DATABASE_URL is required." >&2
  echo "Render dashboard -> rhodium-db -> Connections -> External Database URL" >&2
  exit 1
fi

if [ -z "$TARGET" ] && [ -f .env ]; then
  TARGET=$(grep -m1 '^NEON_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
fi
if [ -z "$TARGET" ]; then
  echo "No target. Set TARGET_DATABASE_URL, or NEON_DATABASE_URL in .env." >&2
  exit 1
fi

# Two traps that make libpq hang or fail rather than say why:
#
#  - Prisma appends ?schema=public, which pg_dump rejects as an invalid URI
#    query parameter.
#  - Ubuntu's psql/pg_dump are wrappers from postgresql-client-common that
#    default to the LOCAL cluster's port (5433 here), not 5432. Against a
#    hostname with no port that produces a silent connection timeout, which
#    reads exactly like a firewall and is not one.
normalize() {
  local url="${1%%\?*}"
  # Insert :5432 only when no port is already present after the host.
  if ! printf '%s' "$url" | sed -E 's#^[a-z]+://[^@]*@##' | grep -qE '^[^/]+:[0-9]+'; then
    url=$(printf '%s' "$url" | sed -E 's#(@[^/]+)/#\1:5432/#')
  fi
  printf '%s' "$url"
}

SRC=$(normalize "$SOURCE")
DST=$(normalize "$TARGET")

mask() { printf '%s' "$1" | sed -E 's#://[^@]*@#://***@#'; }
echo "  from: $(mask "$SRC")"
echo "    to: $(mask "$DST")"
echo

for tool in pg_dump psql; do
  command -v "$tool" >/dev/null || { echo "$tool not found: sudo apt install postgresql-client" >&2; exit 1; }
done

# Refuse to write into a database that already has tables. Restoring over live
# data is the one mistake with no undo, and "it was empty when I checked" is
# not something to rely on a human remembering.
EXISTING=$(psql "$DST" -Atc \
  "select count(*) from information_schema.tables where table_schema='public'" </dev/null)
if [ "$EXISTING" != "0" ] && [ -z "${FORCE:-}" ]; then
  echo "Target already has $EXISTING table(s) in public." >&2
  echo "Refusing to restore over them. Set FORCE=1 only if you are certain." >&2
  exit 1
fi

OUT_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$OUT_DIR"
DUMP="$OUT_DIR/pre-neon-$(date +%Y%m%d-%H%M%S).sql"

# --no-owner / --no-acl: Neon's role (neondb_owner) is not Render's, and
# ownership statements would fail against it.
echo "Dumping ..."
pg_dump "$SRC" --no-owner --no-acl > "$DUMP"
echo "  $DUMP ($(du -h "$DUMP" | cut -f1))"

echo "Restoring ..."
# ON_ERROR_STOP so a failed statement fails the script instead of leaving a
# half-populated database that looks migrated.
psql "$DST" -v ON_ERROR_STOP=1 -q -f "$DUMP" </dev/null
echo "  done"

echo
echo "Verifying row counts ..."
TABLES=$(psql "$SRC" -Atc \
  "select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by 1" </dev/null)

mismatch=0
for t in $TABLES; do
  a=$(psql "$SRC" -Atc "select count(*) from \"$t\"" </dev/null)
  b=$(psql "$DST" -Atc "select count(*) from \"$t\"" </dev/null 2>/dev/null || echo "ABSENT")
  if [ "$a" = "$b" ]; then
    printf '  %-28s %8s  ok\n' "$t" "$a"
  else
    printf '  %-28s %8s  -> %s  MISMATCH\n' "$t" "$a" "$b"
    mismatch=$((mismatch + 1))
  fi
done

# Row counts say nothing about blob contents, and the product photos are
# stored as bytea in media_object rather than as files. A truncated or
# re-encoded image would keep the count correct and still be a lost photo.
if printf '%s\n' $TABLES | grep -qx media_object; then
  echo
  echo "Checksumming stored media ..."
  SUM="select coalesce(md5(string_agg(md5(bytes), '' order by id)), 'empty') from media_object"
  ma=$(psql "$SRC" -Atc "$SUM" </dev/null)
  mb=$(psql "$DST" -Atc "$SUM" </dev/null)
  if [ "$ma" = "$mb" ]; then
    printf '  %-28s %s  ok\n' "media bytes" "${ma:0:12}"
  else
    printf '  media bytes DIFFER: %s -> %s\n' "$ma" "$mb"
    mismatch=$((mismatch + 1))
  fi
fi

if [ "$mismatch" -gt 0 ]; then
  echo >&2
  echo "$mismatch table(s) did not match. Do NOT switch DATABASE_URL." >&2
  exit 1
fi

echo
echo "Every table matches. The dump is kept at $DUMP."
echo "Now set DATABASE_URL on Render to the Neon URL and redeploy."
