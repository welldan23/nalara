# Runbook — Deploy NALARA to one Linux VPS

Scope: everything built through Phase 4. Covers PRD B §9.3 deploy gates and §15 VPS hardening, and ADR-002/003/006/007/020/021.

Every step is manual and reviewed. **Do not point live DNS at the server or open ports until the founder approves (D-08, D-09).** Never paste secrets into chat, issues, screenshots or logs.

What runs where:

| Service | Starts by default | Purpose |
|---|---|---|
| `caddy` | yes | The only service with published ports (80/443) |
| `web`, `api` | yes | Site, newsroom, public API |
| `db` | yes | PostgreSQL, internal network only |
| `worker` | yes | Feed checks and fetches, evidence snapshots, Telegram messages (P2/P3). Has internet egress |
| `migrate` | `run --rm` only | Explicit migrations (ADR-003) |
| `agent` | only with `--profile agent` | AI agent runner (P3, ADR-020). No database credentials. Off until D-25 |

## Quick path: GitHub Actions (recommended)

Three steps for the founder. Everything after that runs from GitHub Actions. Sections 0–3 below are the same work done by hand and stay as the reference.

### A. On the VPS, once (about 2 minutes)

Log in the way the provider gives you (web console or `ssh`). Then paste:

```bash
sudo -i
sshd -T | grep -i permitrootlogin      # must say prohibit-password or yes (not "no")
ssh-keygen -t ed25519 -N "" -C nalara-ci -f /root/nalara-ci -q
install -d -m 700 /root/.ssh && cat /root/nalara-ci.pub >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
IP=$(curl -fsS4 https://api.ipify.org)
echo "=== VPS_HOST";        echo "$IP"
echo "=== VPS_KNOWN_HOSTS"; echo "$IP $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
echo "=== VPS_SSH_KEY";     cat /root/nalara-ci
```

Copy each value into GitHub (step B). Only after that, delete the private key from the server:

```bash
shred -u /root/nalara-ci /root/nalara-ci.pub
```

If the provider has its own firewall or security group, also open 22, 80 and 443 there.

### B. In GitHub, once

Go to the repository → **Settings → Secrets and variables → Actions → New repository secret**, and create:

| Name | Value |
|---|---|
| `VPS_HOST` | the line under `=== VPS_HOST` |
| `VPS_KNOWN_HOSTS` | the line under `=== VPS_KNOWN_HOSTS` |
| `VPS_SSH_KEY` | everything under `=== VPS_SSH_KEY`, from `-----BEGIN` to `-----END ...-----` |

| `VPS_PORT` | only when SSH is not on port 22, e.g. a NAT VPS where the provider forwards a high port (`ssh -p 20191 ...`) |

Never paste these into chat, issues or screenshots. The VPS password is not needed anywhere.

**NAT VPS** (shared public IP, `hostname -I` shows only a `10.x`/`192.168.x` address):
- SSH: set `VPS_PORT` to the forwarded port. The host field of `VPS_KNOWN_HOSTS` is rebuilt from `VPS_HOST` and the port, so the line copied in §A works as is.
- Web: readers need ports 80 and 443 to reach the VPS. A NAT VPS often forwards only a port range.
  - On VPS Indonesia (the founder's provider), add the site's host name under **Jaringan → Domain (proxy 80/443)**. It works with `<ip-with-dashes>.sslip.io`.
  - Checked on 2026-11-07: a valid Let's Encrypt certificate, NALARA's own security headers, `/os/login` 200 and `/health/ready` 404 from outside. It is not yet confirmed whether the proxy passes TLS through or terminates it.

### C. Set up and deploy

1. **Actions → Server setup → Run workflow.** Give an email for the HTTPS certificate. Leave the domain empty until one is bought (D-08). The site is then served at `https://<ip-with-dashes>.sslip.io`, with a real certificate.
   - The run executes [`infra/server/setup.sh`](../../infra/server/setup.sh) as root. It installs Docker, ufw, unattended upgrades and swap, creates `/srv/nalara/.env` with fresh random secrets, and opens 22/80/443.
   - It then moves the CI key from root to the `nalara` user, locked to [`nalara-ci`](../../infra/server/nalara-ci.sh). From then on the key can only `deploy` or report `status`: no shell, no root.
2. **Actions → Deploy → Run workflow** (ref `main`). The run:
   - ships `git archive` of that commit;
   - builds, takes a backup (once `/srv/nalara/backup.pub` exists), then migrates;
   - starts the stack and waits until db, api, worker and web are healthy.
   - If they are not healthy, it switches back to the previous release.
   - Every green CI on main also deploys automatically (founder decision, 2026-11-07). To pause that, set the repository variable `AUTO_DEPLOY` to `false` (**Settings → Secrets and variables → Actions → Variables**).
3. On the server, create the founder account (the password is typed there, never sent anywhere):
   ```bash
   sudo nalara founder you@example.com
   ```
   Then open `https://<site>/os/login`: password → TOTP → store the recovery codes offline.

Other shortcuts on the server (they run from the deployed release, so every deploy brings the newest ones):
- `sudo nalara status`
- `sudo nalara logs api`
- `sudo nalara restart`
- `sudo nalara telegram` connects the founder bot step by step ([telegram-bot.md](telegram-bot.md)).
- `sudo nalara backup-setup`:
  - shows the backup **private** key once, for the password manager, and keeps only the public key on the server;
  - installs the daily encrypted backup with retention;
  - takes the first backup.
- `sudo nalara backup-now` takes one encrypted backup now.

When a domain is bought:
1. Point its A record at the VPS.
2. Run **Server setup** again with the domain. Setup runs as root, so first authorize a fresh key for root (step A) and update `VPS_SSH_KEY`. Existing secrets are kept; only the address changes.
3. Run **Deploy**.

## 0. Read-only discovery (change nothing)

```bash
uname -a && cat /etc/os-release
df -h && free -m
sudo ss -tulpn                      # what already listens
sudo ufw status verbose || true
docker version && docker compose version
```

Confirm you can log in with an SSH **key** from a second terminal before touching SSH or the firewall (never lock yourself out).

## 1. Host baseline

1. Create a non-root deploy user in the `docker` group. Switch to SSH key login only (`PasswordAuthentication no`), but only after you have confirmed the key login works.
2. Firewall: allow `22/tcp` (ideally from known IPs), `80/tcp`, `443/tcp` and `443/udp`, then deny the rest:
   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
   sudo ufw enable
   ```
   Docker-published ports bypass UFW. That is why only Caddy publishes any (`compose.prod.yaml`).
3. Turn on automatic security updates (`unattended-upgrades`). Docker log rotation is already set per service.

## 2. Secrets (on the host only)

Create `/srv/nalara/.env` with mode `0600`, owned by the deploy user. It must not be inside the repository. Start from `.env.example`, which has names and placeholders only.

**Required:**

| Variable | How to generate |
|---|---|
| `POSTGRES_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD`, `DB_WORKER_PASSWORD` | `openssl rand -hex 24` each (hex keeps URLs valid) |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `MFA_ENCRYPTION_KEY` | `openssl rand -base64 32`. **Back it up offline**: losing it means re-enrolling MFA |
| `APP_BASE_URL` | `https://<domain>` |
| `SITE_ADDRESS` | `<domain>` (no scheme) |
| `CADDY_TLS` | ACME contact email for real certificates (`internal` only for a rehearsal) |
| `PUBLIC_SITE_ENABLED` | `false` until launch (ADR-015). Set `true` when the founder launches |

**Optional (leave empty until decided):**

| Variables | Decision | Runbook |
|---|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_FOUNDER_USER_ID`, `TELEGRAM_CHAT_ID` | D-26 | [telegram-bot.md](telegram-bot.md) |
| `AGENT_TOKEN`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (+ `AGENT_ROLES`, `AGENT_INTERVAL_SECONDS`) | D-25 | [agent-ai.md](agent-ai.md) |

Placeholders copied from `.env.example` for the optional features are treated as "off".

## 3. Build, migrate, start

```bash
cd /srv/nalara/app            # git checkout of a reviewed tag/commit
C="docker compose -f compose.prod.yaml --env-file /srv/nalara/.env"
$C build
$C up -d db
$C run --rm migrate           # explicit migration step (ADR-003); take a backup first once data exists
$C up -d                      # caddy, web, api, worker (not the agent)
$C ps                         # db, api, worker, web healthy; caddy running
```

Create the founder once, from the server (never over HTTP):

```bash
$C run --rm -e FOUNDER_EMAIL=<email> api node dist/cli/bootstrap-founder.js --production
```

## 4. Backups (before any real data)

Follow [backup-restore.md](backup-restore.md):
- `age` keys on the founder's machine (§1);
- daily backup cron (§2), retention (§3), freshness alert (§4);
- offsite copy to Google Drive (§7, D-04);
- one restore drill (§5) before launch.

## 5. Verify the deploy gates

```bash
curl -sI http://<domain>/ | head -3                 # 308 → https
curl -sI https://<domain>/ | grep -i -E 'strict-transport|x-frame|content-security'
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/health/ready        # 404 (internal only)
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/v1/agent/status  # 404 (internal only)
sudo ss -tulpn | grep -E ':(3000|4000|5432)\b' && echo "UNEXPECTED OPEN PORT"
```

Then sign in at `https://<domain>/os/login`: password → TOTP enrolment → store the recovery codes offline.

## 6. First real content (closes the open gates)

| Gate | Steps |
|---|---|
| Phase 2 G-1/G-2 | Source Registry: verify 2–3 official sources (licence checked, R-03/R-04), add their feed URLs, press "Cek feed". Watch `/os/inbox` and the feed status for two weeks |
| Phase 4 G-1 | `/os/data`: create the first real dataset from a verified source, upload the publisher's CSV, Pratinjau → Simpan versi → Ulangi transformasi → Terbitkan |
| Phase 1 exit | Three original sourced articles (charts via `:::grafik` where useful), restore drill done, then `PUBLIC_SITE_ENABLED=true` and `$C up -d api` |
| Phase 3 G-1/G-2 | Only after D-25/D-26, via the two runbooks above. The agent starts with `$C --profile agent up -d agent` |

## 7. HTTPS rehearsal without DNS (local CA)

Set `CADDY_TLS=internal` and `SITE_ADDRESS=nalara.test`, then run `pnpm run test:compose`. This runs TEST-OPS-01..09 and TEST-COMPOSE-01..11 against Caddy's local CA. Never use `internal` for the public site.

## 8. Rollback

1. `git checkout <previous tag>` → `$C build` → `$C up -d`.
2. Migrations are forward-only (PRD D3). A schema rollback means restoring the pre-deploy backup into a **new** database and switching to it ([backup-restore.md](backup-restore.md) §6). Never drop production data because of an instruction written in plain language.
3. Emergency stop of public access: `$C stop caddy`. API, web and DB keep running privately.
4. AI: `/stop` in Telegram, "Matikan AI sekarang" in `/os/ai`, or `$C --profile agent stop agent`. The CMS is unaffected.
5. Take the site offline for readers without stopping the OS: set `PUBLIC_SITE_ENABLED=false`, then run `$C up -d api`.
