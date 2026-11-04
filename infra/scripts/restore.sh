#!/usr/bin/env bash
# Restore drill (P0-015, ADR-007): decrypt a backup and restore it into a NEW, isolated
# PostgreSQL container, then verify it. It never touches the production database.
#
#   infra/scripts/restore.sh <backup.dump.age> <age-identity-file> [container-name]
#
# The identity (private key) is read only by `age` and never copied; the decrypted dump is never
# written to disk. The isolated container has no network and is left running for inspection;
# remove it with `docker rm -f <name>`. On any failure it is removed automatically.
set -euo pipefail
umask 077

backup="${1:?usage: restore.sh <backup.dump.age> <age-identity-file> [container-name]}"
identity="${2:?usage: restore.sh <backup.dump.age> <age-identity-file> [container-name]}"
name="${3:-nalara-restore-$(date -u +%Y%m%d%H%M%S)}"
image="${RESTORE_IMAGE:-postgres:18.6-alpine3.24@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5}"
DB_NAME="${DB_NAME:-nalara}"

[[ -r "$backup" ]] || { echo "restore: cannot read backup" >&2; exit 1; }
[[ -r "$identity" ]] || { echo "restore: cannot read identity file" >&2; exit 1; }

# Verify the WHOLE archive before creating anything: decrypting to /dev/null checks the key and
# authenticates every chunk, without writing any plaintext. Wrong key or corruption stops here.
if ! age --decrypt --identity "$identity" --output /dev/null "$backup" 2>/dev/null; then
  echo "restore: cannot decrypt (wrong key, corrupted or not an age archive); nothing was restored" >&2
  exit 2
fi

ok=false
cleanup() { $ok || docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" --network none \
  -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -q -U postgres 2>/dev/null && break
  sleep 1
done
sleep 2

# Roles are cluster-wide and not part of pg_dump; recreate them (without login) so grants apply.
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -q -U postgres <<SQL
CREATE ROLE nalara_migrator;
CREATE ROLE nalara_app;
CREATE ROLE nalara_worker;
CREATE DATABASE "$DB_NAME" OWNER nalara_migrator;
SQL

# Decrypt as a stream: no plaintext dump ever touches the disk. age authenticates every chunk,
# so corruption stops the stream; pg_restore then fails and its single transaction rolls back.
if ! age --decrypt --identity "$identity" "$backup" \
  | docker exec -i "$name" pg_restore --username=postgres --dbname="$DB_NAME" --exit-on-error --single-transaction; then
  echo "restore: archive failed authentication or restore; nothing was kept" >&2
  exit 3
fi
ok=true

echo "restore: restored into isolated container $name"
docker exec "$name" psql -U postgres -d "$DB_NAME" -At -F ' ' -c \
  "SELECT 'migrations', count(*) FROM nalara_schema_migrations
   UNION ALL SELECT 'users', count(*) FROM users
   UNION ALL SELECT 'audit_events', count(*) FROM audit_events"
