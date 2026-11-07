#!/usr/bin/env bash
# Founder shortcuts on the server (installed as /usr/local/bin/nalara by setup.sh).
#
#   sudo nalara status            service health
#   sudo nalara logs [service]    last log lines (api, web, worker, caddy, db, agent)
#   sudo nalara founder <email>   create the founder account once (asks for the password)
#   sudo nalara restart           restart the running stack
set -euo pipefail

ROOT=/srv/nalara
[[ -d "$ROOT/app" ]] || { echo "nalara: nothing deployed yet (run the Deploy workflow)" >&2; exit 1; }
cd "$ROOT/app"
compose() { sudo -u nalara docker compose -p nalara -f compose.prod.yaml --env-file "$ROOT/.env" "$@"; }

case "${1:-}" in
  status) compose ps ;;
  logs) compose logs --tail 100 "${2:-api}" ;;
  restart) compose up -d ;;
  founder)
    email="${2:-}"
    [[ "$email" == *@* ]] || { echo "usage: sudo nalara founder <email>" >&2; exit 2; }
    # The password is typed into the terminal, never passed as an argument (P0-007).
    compose run --rm -e FOUNDER_EMAIL="$email" api node dist/cli/bootstrap-founder.js --production
    ;;
  *) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//' ; exit 2 ;;
esac
