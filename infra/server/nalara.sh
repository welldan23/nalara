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
#   sudo nalara ai                connect the AI team to OpenCode Go (D-25), step by step
#   sudo nalara ai-model <role|default> <model>   change one agent's model
#   sudo nalara ai-off            stop the agent container (the CMS keeps working)
#   sudo nalara ai-check          test the saved OpenCode key (prints the answer, never the key)
#   sudo nalara sources-seed      add the starter source list as candidates (verify them in the OS)
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
  echo "Buka bot barumu di Telegram dan kirim: /start  (cukup sekali; skrip ini menunggu sendiri)"
  local ids user='' chat='' saved_user saved_chat _
  # A re-run (webhook already set, so Telegram returns no updates) keeps the ids saved earlier.
  saved_user="$(sed -n 's/^TELEGRAM_FOUNDER_USER_ID=\([0-9]*\)$/\1/p' "$ENV_FILE" | tail -n 1)"
  saved_chat="$(sed -n 's/^TELEGRAM_CHAT_ID=\(-\{0,1\}[0-9]*\)$/\1/p' "$ENV_FILE" | tail -n 1)"
  for _ in $(seq 1 40); do
    # A one-off container: works even while the worker itself waits for the chat id.
    ids="$(compose run --rm --no-deps -T worker node dist/cli/telegram-setup.js ids 2>&1 || true)"
    # `|| true`: no match yet is normal here and must not end the script (set -e, pipefail).
    user="$(grep -o '"userId":[0-9]*' <<< "$ids" | tail -n 1 | cut -d: -f2 || true)"
    chat="$(grep -o '"chatId":-\{0,1\}[0-9]*' <<< "$ids" | tail -n 1 | cut -d: -f2 || true)"
    [[ -n "$user" && -n "$chat" ]] && break
    if [[ -n "$saved_user" && -n "$saved_chat" ]]; then
      user="$saved_user"
      chat="$saved_chat"
      break
    fi
    if grep -q '"level":"error"' <<< "$ids"; then
      echo "Telegram menolak permintaan: $(grep -o '"code":"[^"]*"' <<< "$ids" | tail -n 1 || true)" >&2
      echo "Cek token di @BotFather, lalu ulangi: sudo nalara telegram" >&2
      exit 1
    fi
    printf '.'
    sleep 3
  done
  echo
  [[ -n "$user" && -n "$chat" ]] || { echo "Belum ada pesan /start yang masuk dalam 2 menit. Kirim /start ke bot, lalu ulangi: sudo nalara telegram" >&2; exit 1; }
  echo "Akun Telegram ditemukan (user id $user)."
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

AI_BASE_DEFAULT="${NALARA_AI_BASE:-https://opencode.ai/inference/go/openai/v1}"
AI_ROLES=(radar penulis pemeriksa periset pemantau)
# Starting picks (founder can change any with `nalara ai-model`): a cheap default, a strong
# writer, a checker from another model family than the writer, mid-range research.
# DeepSeek is left out: OpenCode serves it outside Europe/US, and an account limited to those
# regions gets 400 "hosted outside Europe and the United States" (founder's account, 2026-11-08).
declare -A AI_PICK=(
  [default]=gpt-6-luna
  [radar]=gpt-6-luna
  [penulis]=qwen3.8-max
  [pemeriksa]=claude-haiku-5-5
  [periset]=minimax-m3
  [pemantau]=gpt-6-luna
)

ai_models() { # model ids the provider lists, minus the ones that train on prompts
  curl -fsS --max-time 20 "${1:-$AI_BASE_DEFAULT}/models" |
    grep -o '"id":"[^"]*"' | cut -d'"' -f4 | grep -v -e '-contributor' -e '-free$' | sort
}

ai_model() {
  local role="${1:-}" model="${2:-}" models base
  [[ "$role" == default || " ${AI_ROLES[*]} " == *" $role "* ]] || { echo "Peran: default, ${AI_ROLES[*]}" >&2; exit 2; }
  base="$(sed -n 's/^AI_BASE_URL=//p' "$ENV_FILE")"
  models="$(ai_models "${base:-$AI_BASE_DEFAULT}")"
  if [[ -z "$model" ]]; then
    echo "Model yang boleh dipakai:"; tr '\n' ' ' <<< "$models" | fold -s -w 78; echo
    exit 2
  fi
  grep -qx -- "$model" <<< "$models" || { echo "Model '$model' tidak ada di daftar (atau melatih dirinya dari prompt)." >&2; exit 1; }
  if [[ "$role" == default ]]; then set_kv AI_MODEL "$model"; else set_kv "AI_MODEL_${role^^}" "$model"; fi
  compose --profile agent up -d agent >/dev/null
  echo "Oke: $role → $model"
}

# One tiny request with the key. OpenCode Go refuses requests without x-opencode-session (400
# MissingSessionID), so the check sends one like the agent runner does. Prints the HTTP status on
# the first line and OpenCode's error message (never the key) on the second.
ai_ping() {
  local key="$1" base="$2" model="$3" session out
  session="$(cat /proc/sys/kernel/random/uuid)"
  out="$(mktemp)"
  curl -s -o "$out" -w '%{http_code}\n' --max-time 60 "$base/chat/completions" \
    -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
    -H 'User-Agent: NALARA-Agent/1.0' -H "x-opencode-session: $session" \
    -d "{\"model\":\"$model\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}" || echo 000
  grep -o '"message":"[^"]*"' "$out" | head -n 1 | cut -d'"' -f4 || true
  rm -f "$out"
}

# Says what an answer means; returns 0 only for a working key.
ai_explain() {
  local code="$1" detail="${2:-}" model="${3:-}"
  case "$code" in
    200) echo "Key diterima: OpenCode Go menjawab (model $model)." ;;
    401) echo "Key ditolak (401). Buat key baru di opencode.ai → Console → API Keys, lalu: sudo nalara ai" >&2; return 1 ;;
    402|403) echo "Akses ditolak ($code): biasanya langganan Go belum aktif atau jatahnya habis. Cek di opencode.ai." >&2; return 1 ;;
    429) echo "Jatah pemakaian sedang habis (429). Key benar; agent mencoba lagi nanti." ; return 1 ;;
    000) echo "Tidak bisa menghubungi OpenCode (jaringan). Coba lagi sebentar." >&2; return 1 ;;
    *)
      echo "OpenCode menjawab $code untuk model $model." >&2
      [[ -z "$detail" ]] || echo "Pesan OpenCode: $detail" >&2
      if [[ "$detail" == *"outside Europe"* ]]; then
        echo "Model ini tidak diizinkan oleh pengaturan wilayah akunmu. Ganti modelnya: sudo nalara ai-model <peran|default> <model>" >&2
      fi
      return 1 ;;
  esac
}

# Tests the saved key with every model the agents are set to use (default and per role).
ai_check() {
  local key base models model answer code detail bad=0
  key="$(sed -n 's/^AI_API_KEY=//p' "$ENV_FILE" | tail -n 1)"
  base="$(sed -n 's/^AI_BASE_URL=//p' "$ENV_FILE" | tail -n 1)"
  [[ -n "$key" ]] || { echo "Belum ada API key. Jalankan: sudo nalara ai" >&2; exit 1; }
  models="$(sed -n 's/^AI_MODEL\(_[A-Z]*\)\{0,1\}=//p' "$ENV_FILE" | sort -u)"
  [[ -n "$models" ]] || models="${AI_PICK[default]}"
  for model in $models; do
    answer="$(ai_ping "$key" "${base:-$AI_BASE_DEFAULT}" "$model")"
    code="$(head -n 1 <<< "$answer")"
    detail="$(sed -n 2p <<< "$answer")"
    ai_explain "$code" "$detail" "$model" || bad=1
  done
  return "$bad"
}

ai_setup() {
  say "Langkah 1/3 — API key OpenCode Go"
  echo "Di opencode.ai: Console → API keys → buat key khusus NALARA."
  echo "Cek juga Settings → Privacy: 'Allow paid endpoints that train on request data' harus MATI."
  local key=''
  read -rsp "Tempel API key di sini (tidak akan tampil), lalu Enter: " key
  echo
  [[ "$key" =~ ^[A-Za-z0-9._-]{20,200}$ ]] || { echo "Itu tidak terlihat seperti API key. Ulangi: sudo nalara ai" >&2; exit 1; }
  local answer code
  answer="$(ai_ping "$key" "$AI_BASE_DEFAULT" "${AI_PICK[default]}")"
  code="$(head -n 1 <<< "$answer")"
  ai_explain "$code" "$(sed -n 2p <<< "$answer")" "${AI_PICK[default]}" ||
    [[ "$code" != 401 && "$code" != 403 ]] || exit 1
  set_kv AI_BASE_URL "$AI_BASE_DEFAULT"
  set_kv AI_API_KEY "$key"
  unset key

  say "Langkah 2/3 — Model per agen"
  local models role pick
  models="$(ai_models || true)"
  set_kv AI_MODEL "${AI_PICK[default]}"
  for role in "${AI_ROLES[@]}"; do
    pick="${AI_PICK[$role]}"
    if grep -qx -- "$pick" <<< "$models"; then
      set_kv "AI_MODEL_${role^^}" "$pick"
      printf '  %-10s %s\n' "$role" "$pick"
    else
      printf '  %-10s %s (default; %s tidak tersedia)\n' "$role" "${AI_PICK[default]}" "$pick"
    fi
  done
  echo "Ganti kapan saja: sudo nalara ai-model penulis <nama-model>"

  say "Langkah 3/3 — Kredensial agent dan start"
  if ! grep -q '^AGENT_TOKEN=.\{20,\}' "$ENV_FILE"; then
    compose exec -T api node dist/cli/agent-credential.js revoke runner >/dev/null 2>&1 || true
    local token
    token="$(compose exec -T api node dist/cli/agent-credential.js create runner 2>/dev/null | tail -n 1)"
    [[ "$token" =~ ^[A-Za-z0-9._~-]{20,}$ ]] || { echo "Gagal membuat kredensial agent. Kirim 'sudo nalara logs api' ke developer." >&2; exit 1; }
    set_kv AGENT_TOKEN "$token"
    unset token
  fi
  compose --profile agent up -d agent >/dev/null
  local _
  for _ in $(seq 1 20); do
    compose logs --tail 50 agent 2>/dev/null | grep -q '"msg":"agent runner started"' && break
    sleep 2
  done
  if compose logs --tail 50 agent 2>/dev/null | grep -q '"msg":"agent runner started"'; then
    echo "Agent jalan. AI masih MATI sampai kamu menyalakan saklar di NALARA OS → Agent AI."
  else
    echo "Agent belum melapor 'started'. Cek: sudo nalara logs agent" >&2
    exit 1
  fi
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
  ai) ai_setup ;;
  ai-model) ai_model "${2:-}" "${3:-}" ;;
  ai-off) compose --profile agent stop agent ;;
  ai-check) ai_check ;;
  sources-seed) compose run --rm --no-deps api node dist/cli/seed-sources.js ;;
  *) sed -n '5,16p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
