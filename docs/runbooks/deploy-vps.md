# Runbook — Deploy NALARA to one Linux VPS (Phase 0)

Scope: PRD B §9.3 deploy gates, §15 VPS hardening; ADR-002/003/006. Every step is manual and
reviewed. **Do not point live DNS at the server or open ports until the founder approves
(D-08, D-09).** Never paste secrets into chat, issues, screenshots or logs.

## 0. Read-only discovery (change nothing)

```bash
uname -a && cat /etc/os-release
df -h && free -m
sudo ss -tulpn                      # what already listens
sudo ufw status verbose || true
docker version && docker compose version
```

Confirm you can log in with an SSH **key** from a second terminal before touching SSH or the
firewall (never lock yourself out).

## 1. Host baseline

1. Non-root deploy user in the `docker` group. SSH key login only (`PasswordAuthentication no`) only after the key login is confirmed working.
2. Firewall: allow `22/tcp` (ideally from known IPs), `80/tcp`, `443/tcp`, `443/udp`, then deny the rest:
   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
   sudo ufw enable
   ```
   Docker-published ports bypass UFW, which is why only Caddy publishes any (`compose.prod.yaml`).
3. Automatic security updates (`unattended-upgrades`). Docker log rotation is set per service.

## 2. Secrets (on the host only)

Create `/srv/nalara/.env` with mode `0600`, owned by the deploy user. It must not be inside the repository.

| Variable | How to generate |
|---|---|
| `POSTGRES_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD` | `openssl rand -hex 24` (hex keeps URLs valid) |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `MFA_ENCRYPTION_KEY` | `openssl rand -base64 32`. **Back it up offline**: losing it means re-enrolling MFA |
| `APP_BASE_URL` | `https://<domain>` |
| `SITE_ADDRESS` | `<domain>` (no scheme) |
| `CADDY_TLS` | ACME contact email for real certificates (`internal` only for a rehearsal) |

## 3. Build, migrate, start

```bash
cd /srv/nalara/app            # git checkout of a reviewed tag/commit
C="docker compose -f compose.prod.yaml --env-file /srv/nalara/.env"
$C build
$C up -d db
$C run --rm migrate           # explicit migration step (ADR-003); take a backup first once data exists
$C up -d
$C ps                         # db, api, web healthy; caddy running
```

Create the founder once, from the server (never over HTTP):

```bash
$C run --rm -e FOUNDER_EMAIL=<email> api node dist/cli/bootstrap-founder.js --production
```

## 4. Verify the deploy gates

```bash
curl -sI http://<domain>/ | head -3                 # 308 → https
curl -sI https://<domain>/ | grep -i -E 'strict-transport|x-frame|content-security'
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/health/ready   # 404 (internal only)
sudo ss -tulpn | grep -E ':(3000|4000|5432)\b' && echo "UNEXPECTED OPEN PORT"
```

Then sign in at `https://<domain>/os/login`: password → TOTP enrolment → store the recovery codes offline.

## 5. HTTPS rehearsal without DNS (local CA)

`CADDY_TLS=internal`, `SITE_ADDRESS=nalara.test`, then `pnpm run test:compose`. This runs TEST-OPS-01..04 against Caddy's local CA. Never use `internal` for the public site.

## 6. Rollback

1. `git checkout <previous tag>` → `$C build` → `$C up -d`.
2. Migrations are forward-only (PRD D3). A schema rollback means restoring the pre-deploy backup into a **new** database and switching to it (runbook P0-015). Never drop production data from a natural-language instruction.
3. Emergency stop of public access: `$C stop caddy` (API, web and DB keep running privately).
