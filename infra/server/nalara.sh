#!/usr/bin/env bash
# Founder shortcuts on the server. /usr/local/bin/nalara is a small wrapper that runs this file
# from the deployed release, so every deploy brings the newest commands.
#
#   sudo nalara status            service health
#   sudo nalara logs [service]    last log lines (api, web, worker, caddy, db, agent)
#   sudo nalara restart           restart the stack with the current .env
#   sudo nalara founder <email>   create the founder account once (asks for the password)
#   sudo nalara telegram          connect the founder Telegram bot (D-26), step by step
#   sudo nalara backup-setup      encrypted daily backups (ADR-007): key, schedule, first backup
#   sudo nalara backup-now        one encrypted backup now
set -euo pipefail

ROOT=/srv/nalara
ENV_FILE="$ROOT/.env"
APP="$ROOT/app"
[[ $EUID -eq 0 ]] || { echo "nalara: run with sudo" >&2; exit 1; }
[[ -d "$APP" ]] || { echo "nalara: nothing deployed yet (run the Deploy workflow)" >&2; exit 1; }

# Keep the wrapper current (older setups installed a full copy of this script).
WRAPPER='#!/usr/bin/env bash
exec bash /srv/nalara/app/infra/server/nalara.sh "$@"'
if [[ "$(cat /usr/local/bin/nalara 2>/dev/null)" != "$WRAPPER" ]]; then
  printf '%s\n' "$WRAPPER" > /usr/local/bin/nalara
  chmod 0755 /usr/local/bin/nalara
fi

cd "$APP"
compose() { sudo -u nalara docker compose -p nalara -f compose.prod.yaml --env-file "$ENV_FILE" "$@"; }

set_kv() { # key value: replace the line or append it, keeping the file private
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  chown nalara:nalara "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
}

say() { printf '\n%s\n' "$*"; }

telegram() {
  say "Langkah 1/3 — Token bot"
  echo "Di Telegram: buka @BotFather → /newbot → ikuti petunjuknya. Salin token yang diberikan."
  local token=''
  read -rsp "Tempel token bot di sini (tidak akan tampil), lalu Enter: " token
  echo
  [[ "$token" =~ ^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$ ]] || { echo "Itu bukan token bot Telegram. Ulangi: sudo nalara telegram" >&2; exit 1; }
  set_kv TELEGRAM_BOT_TOKEN "$token"
  set_kv TELEGRAM_WEBHOOK_SECRET "$(openssl rand -hex 32)"
  unset token
  compose up -d worker >/dev/null

  say "Langkah 2/3 — Kenalkan akun kamu"
  echo "Buka bot barumu di Telegram dan kirim: /start"
  read -rp "Sudah? Tekan Enter. " _
  local ids user chat
  ids="$(compose exec -T worker node dist/cli/telegram-setup.js ids 2>&1 || true)"
  user="$(grep -o '"userId":[0-9]*' <<< "$ids" | tail -n 1 | cut -d: -f2)"
  chat="$(grep -o '"chatId":-\{0,1\}[0-9]*' <<< "$ids" | tail -n 1 | cut -d: -f2)"
  # A re-run (webhook already set, so no updates to read) keeps the ids saved earlier.
  [[ -n "$user" ]] || user="$(sed -n 's/^TELEGRAM_FOUNDER_USER_ID=\([0-9]*\)$/\1/p' "$ENV_FILE")"
  [[ -n "$chat" ]] || chat="$(sed -n 's/^TELEGRAM_CHAT_ID=\(-\{0,1\}[0-9]*\)$/\1/p' "$ENV_FILE")"
  [[ -n "$user" && -n "$chat" ]] || { echo "Belum ada pesan /start yang terlihat. Kirim /start ke bot, lalu ulangi: sudo nalara telegram" >&2; exit 1; }
  set_kv TELEGRAM_FOUNDER_USER_ID "$user"
  set_kv TELEGRAM_CHAT_ID "$chat"

  say "Langkah 3/3 — Pasang webhook"
  compose up -d api worker >/dev/null
  local _
  for _ in $(seq 1 30); do
    [[ "$(docker inspect --format '{{.State.Health.Status}}' nalara-api-1 2>/dev/null)" == healthy ]] && break
    sleep 2
  done
  compose exec -T worker node dist/cli/telegram-setup.js set-webhook >/dev/null
  if compose exec -T worker node dist/cli/telegram-setup.js info | grep -q '"lastError":"'; then
    echo "Webhook terpasang tapi Telegram melaporkan error. Kirim hasil 'sudo nalara logs worker' ke developer (tanpa token)." >&2
    exit 1
  fi
  echo "Selesai. Kirim /status ke bot: balasannya \"AI mati. Usulan menunggu: N.\""
}

backup_now() {
  sudo -u nalara env AGE_RECIPIENTS_FILE="$ROOT/backup.pub" BACKUP_DIR="$ROOT/backups" \
    PG_EXEC="docker compose -p nalara -f compose.prod.yaml --env-file $ENV_FILE exec -T db" \
    infra/scripts/backup.sh
  find "$ROOT/backups" -name "nalara-*.dump.age" -printf "%TY-%Tm-%Td %TH:%TM  %s bytes  %f\n" | sort | tail -n 3
}

backup_setup() {
  command -v age-keygen >/dev/null || { echo "age belum terpasang: jalankan Server setup lagi" >&2; exit 1; }
  if [[ -s "$ROOT/backup.pub" ]]; then
    echo "Kunci backup sudah ada ($ROOT/backup.pub). Tidak dibuat ulang."
  else
    local tmp
    tmp="$(mktemp -d)"
    chmod 700 "$tmp"
    age-keygen -o "$tmp/key" 2>/dev/null
    say "KUNCI RAHASIA BACKUP — simpan SEKARANG di password manager (dan satu salinan di kertas)."
    echo "Tanpa kunci ini, backup tidak bisa dibuka. Server TIDAK menyimpannya. Jangan kirim ke chat."
    echo
    grep '^AGE-SECRET-KEY-' "$tmp/key"
    echo
    local answer=''
    until [[ "$answer" == SIMPAN ]]; do
      read -rp "Sudah disimpan? Ketik SIMPAN lalu Enter: " answer
    done
    age-keygen -y "$tmp/key" > "$ROOT/backup.pub"
    shred -u "$tmp/key"
    rmdir "$tmp"
    chown nalara:nalara "$ROOT/backup.pub"
    chmod 0644 "$ROOT/backup.pub"
    clear || true
    echo "Kunci publik disimpan di $ROOT/backup.pub; kunci rahasia sudah dihapus dari server."
  fi

  # Daily at 02:17 UTC (09:17 WIB): backup, then retention (7 daily + 4 weekly).
  local job="17 2 * * * (cd $APP && AGE_RECIPIENTS_FILE=$ROOT/backup.pub BACKUP_DIR=$ROOT/backups PG_EXEC='docker compose -p nalara -f compose.prod.yaml --env-file $ENV_FILE exec -T db' infra/scripts/backup.sh && infra/scripts/prune.sh --apply) >> $ROOT/backups/cron.log 2>&1"
  (crontab -u nalara -l 2>/dev/null | grep -v 'infra/scripts/backup.sh' || true; echo "$job") | crontab -u nalara -
  echo "Jadwal backup harian terpasang (09:17 WIB)."
  say "Backup pertama:"
  backup_now
}

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
  telegram) telegram ;;
  backup-setup) backup_setup ;;
  backup-now) backup_now ;;
  *) sed -n '5,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
