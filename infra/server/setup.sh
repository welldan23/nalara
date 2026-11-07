#!/usr/bin/env bash
# One-time (and re-runnable) VPS setup for NALARA (deploy-vps.md §1-2).
#
#   sudo infra/server/setup.sh --email you@example.com [--site nalara.media]
#
# Normally started by the "Server setup" GitHub Actions workflow over SSH as root. It:
#   - installs Docker (official apt repository), ufw, unattended-upgrades and age;
#   - adds 2 GB of swap when the host has none (image builds need it on 4 GB hosts);
#   - creates the `nalara` deploy user and /srv/nalara;
#   - moves the CI key (comment `nalara-ci`) from root to `nalara`, locked to one command
#     (/usr/local/sbin/nalara-ci: deploy or status only, no shell, no forwarding);
#   - writes /srv/nalara/.env with fresh random secrets once (mode 0600). A later run never
#     touches existing secrets; it only updates the address when --site is given;
#   - opens 22, 80 and 443 in ufw and denies the rest.
# Without --site the site lives at <public-ip>.sslip.io until a domain is bought (D-08).
set -euo pipefail
umask 022

EMAIL=''
SITE=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --site) SITE="${2:-}"; shift 2 ;;
    *) echo "setup: unknown argument $1" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "setup: run as root (sudo)" >&2; exit 1; }
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || {
  echo "setup: --email must be an email address (contact for the HTTPS certificate)" >&2
  exit 2
}
if [[ -n "$SITE" && ! "$SITE" =~ ^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$ ]]; then
  echo "setup: --site must be a lowercase host name without scheme, e.g. nalara.media" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT=/srv/nalara
ENV_FILE="$ROOT/.env"
USER_NAME=nalara

. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  ubuntu:22.04 | ubuntu:24.04 | debian:12 | debian:13) ;;
  *) echo "setup: supported: Ubuntu 22.04/24.04, Debian 12/13 (found ${PRETTY_NAME:-unknown})" >&2; exit 1 ;;
esac

log() { printf '\n== %s\n' "$*"; }

log "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg ufw unattended-upgrades age openssl
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Swap"
if [[ -z "$(swapon --noheadings)" ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "2 GB swap added"
else
  echo "swap already present"
fi

log "Deploy user and folders"
id "$USER_NAME" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$USER_NAME"
getent group docker >/dev/null || groupadd docker
usermod -aG docker "$USER_NAME"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0750 "$ROOT" "$ROOT/releases"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0700 "$ROOT/backups"
install -o root -g root -m 0755 "$HERE/nalara-ci.sh" /usr/local/sbin/nalara-ci
install -o root -g root -m 0755 "$HERE/nalara.sh" /usr/local/bin/nalara

log "CI key"
home="$(getent passwd "$USER_NAME" | cut -d: -f6)"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0700 "$home/.ssh"
user_keys="$home/.ssh/authorized_keys"
touch "$user_keys"
ci_key="$(grep -E '^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+ nalara-ci$' /root/.ssh/authorized_keys 2>/dev/null | tail -n 1 || true)"
if [[ -n "$ci_key" ]]; then
  # Replace any earlier CI key: only the newest one may deploy.
  grep -v ' nalara-ci$' "$user_keys" > "$user_keys.new" || true
  printf 'restrict,command="/usr/local/sbin/nalara-ci" %s\n' "$ci_key" >> "$user_keys.new"
  mv "$user_keys.new" "$user_keys"
  # Root no longer accepts the CI key: from now on it can only deploy.
  grep -v ' nalara-ci$' /root/.ssh/authorized_keys > /root/.ssh/authorized_keys.new || true
  cat /root/.ssh/authorized_keys.new > /root/.ssh/authorized_keys
  rm -f /root/.ssh/authorized_keys.new
  echo "CI key moved to $USER_NAME (deploy only); removed from root"
elif grep -q ' nalara-ci$' "$user_keys"; then
  echo "CI key already in place"
else
  echo "setup: no key with comment nalara-ci in /root/.ssh/authorized_keys (see deploy-vps.md §A)" >&2
  exit 1
fi
chown "$USER_NAME:$USER_NAME" "$user_keys"
chmod 0600 "$user_keys"

log "Secrets (/srv/nalara/.env)"
if [[ -z "$SITE" ]]; then
  ip="$(curl -fsS4 --max-time 10 https://api.ipify.org || true)"
  [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || { echo "setup: cannot find the public IPv4; pass --site" >&2; exit 1; }
  SITE="${ip//./-}.sslip.io"
fi
set_kv() { # key value: replace the line or append it
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
if [[ ! -f "$ENV_FILE" ]]; then
  (
    umask 077
    {
      echo "# Written by infra/server/setup.sh on $(date -u +%F). Secrets: never copy into chat."
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
      echo "DB_MIGRATOR_PASSWORD=$(openssl rand -hex 24)"
      echo "DB_APP_PASSWORD=$(openssl rand -hex 24)"
      echo "DB_WORKER_PASSWORD=$(openssl rand -hex 24)"
      echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
      echo "MFA_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')"
      echo "PUBLIC_SITE_ENABLED=false"
      echo "LOG_LEVEL=info"
    } > "$ENV_FILE"
  )
  echo "new secrets written"
else
  echo "existing secrets kept"
fi
set_kv SITE_ADDRESS "$SITE"
set_kv APP_BASE_URL "https://$SITE"
set_kv CADDY_TLS "$EMAIL"
chown "$USER_NAME:$USER_NAME" "$ENV_FILE"
chmod 0600 "$ENV_FILE"

log "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

log "Done"
echo "site: https://$SITE (readers see nothing until PUBLIC_SITE_ENABLED=true)"
echo "next: run the Deploy workflow, then on the server: sudo nalara founder <email>"
