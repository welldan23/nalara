#!/usr/bin/env bash
# The only command the CI key may run (forced in authorized_keys by setup.sh). No shell, no
# forwarding: the GitHub Actions deploy job can ask for exactly two things.
#
#   deploy <40-hex commit>   release tarball (git archive, gzip) on stdin
#   status                   service health, no secrets
#
# A deploy unpacks into /srv/nalara/releases/<commit>, builds, takes an encrypted backup when a
# backup key exists, runs the explicit migration (ADR-003), starts the stack and waits until db,
# api, worker and web are healthy. If they are not, /srv/nalara/app goes back to the previous
# release and that one is started again. Migrations are forward-only (PRD D3), so the previous
# release must tolerate the new schema; restore a backup otherwise (backup-restore.md §6).
set -euo pipefail
umask 022

ROOT=/srv/nalara
RELEASES="$ROOT/releases"
ENV_FILE="$ROOT/.env"
KEEP=5

# Split the client's request on spaces only (no glob expansion).
read -r -a request <<< "${SSH_ORIGINAL_COMMAND:-}"
action="${request[0]:-}"

compose() { docker compose -p nalara -f compose.prod.yaml --env-file "$ENV_FILE" "$@"; }

healthy() { # all long-running services healthy
  local service state
  for service in db api worker web; do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "nalara-$service-1" 2>/dev/null || echo missing)"
    [[ "$state" == healthy ]] || return 1
  done
}

wait_healthy() {
  local _
  for _ in $(seq 1 60); do
    healthy && return 0
    sleep 5
  done
  return 1
}

status() {
  echo "release: $(basename "$(readlink -f "$ROOT/app" 2>/dev/null || echo none)")"
  docker ps --filter label=com.docker.compose.project=nalara --format '{{.Names}}\t{{.Status}}' | sort
}

case "$action" in
  status)
    status
    ;;
  deploy)
    commit="${request[1]:-}"
    [[ "$commit" =~ ^[0-9a-f]{40}$ && ${#request[@]} -eq 2 ]] || { echo "deploy: need one full commit sha" >&2; exit 2; }
    exec 9>"$ROOT/.deploy.lock"
    flock -n 9 || { echo "deploy: another deploy is running" >&2; exit 1; }

    target="$RELEASES/$commit"
    rm -rf "$target.partial"
    mkdir -p "$target.partial"
    tar -xz -C "$target.partial" --no-same-owner --no-same-permissions
    [[ -f "$target.partial/compose.prod.yaml" ]] || { echo "deploy: archive has no compose.prod.yaml" >&2; rm -rf "$target.partial"; exit 1; }
    rm -rf "$target"
    mv "$target.partial" "$target"

    previous="$(readlink -f "$ROOT/app" 2>/dev/null || true)"
    cd "$target"
    echo "== build $commit"
    compose build --pull

    if [[ -f "$ROOT/backup.pub" ]] && [[ -n "$(compose ps -q db 2>/dev/null)" ]]; then
      echo "== backup before migrating"
      AGE_RECIPIENTS_FILE="$ROOT/backup.pub" BACKUP_DIR="$ROOT/backups" \
        PG_EXEC="docker compose -p nalara -f compose.prod.yaml --env-file $ENV_FILE exec -T db" \
        infra/scripts/backup.sh
    fi

    echo "== migrate"
    compose up -d --wait db
    compose run --rm migrate

    echo "== start"
    ln -sfn "$target" "$ROOT/app.new" && mv -T "$ROOT/app.new" "$ROOT/app"
    compose up -d --remove-orphans
    if wait_healthy; then
      echo "== healthy"
      status
      # Keep the newest releases only (the current one is always among them).
      find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2- |
        while read -r old; do [[ "$old" != "$target" ]] && rm -rf "$old"; done
      exit 0
    fi

    echo "deploy: services not healthy after 5 minutes" >&2
    compose ps >&2 || true
    compose logs --tail 40 api web worker >&2 || true
    if [[ -n "$previous" && -d "$previous" && "$previous" != "$target" ]]; then
      echo "== rolling back to $(basename "$previous")" >&2
      ln -sfn "$previous" "$ROOT/app.new" && mv -T "$ROOT/app.new" "$ROOT/app"
      (cd "$previous" && compose up -d --remove-orphans) || true
    fi
    exit 1
    ;;
  *)
    echo "nalara-ci: allowed: 'status' or 'deploy <commit>'" >&2
    exit 2
    ;;
esac
