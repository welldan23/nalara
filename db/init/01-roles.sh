#!/bin/sh
# Local/dev database bootstrap for the official postgres image (runs once on an empty volume).
# Creates the two roles from ADR-003 and a database owned by the migrator.
# Production roles are created the same way, manually, as documented in db/README.md.
set -eu

: "${DB_MIGRATOR_PASSWORD:?DB_MIGRATOR_PASSWORD must be set}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD must be set}"
DB_NAME="${DB_NAME:-nalara}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=migrator_password="$DB_MIGRATOR_PASSWORD" \
  --set=app_password="$DB_APP_PASSWORD" \
  --set=db_name="$DB_NAME" <<'SQL'
CREATE ROLE nalara_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE nalara_app LOGIN PASSWORD :'app_password';
CREATE DATABASE :"db_name" OWNER nalara_migrator;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO nalara_app;
\connect :"db_name"
GRANT USAGE ON SCHEMA public TO nalara_app;
SQL
