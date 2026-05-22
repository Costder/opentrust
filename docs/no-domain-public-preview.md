# OpenTrust no-domain public preview

This is the zero-cost launch path for Joshua's OpenTrust registry while a paid domain is not available.

## Public HTTPS URL

Current Cloudflare Quick Tunnel:

https://leading-apparatus-partnerships-combinations.trycloudflare.com

Important: this URL is free but ephemeral. If the `cloudflared` process stops, the URL can change.

## Active mode

- Public web traffic enters through Cloudflare Quick Tunnel.
- The tunnel points only at the local Next.js web server on `localhost:3001`.
- The API stays private on `127.0.0.1:8000`.
- Next.js proxies public browser calls to the private API through:
  - `/api/[...path]`
  - `/.well-known/[...path]`
- Payments stay `mock` until escrow/payment review is done.
- No registry or app secrets are committed to git.

## Secret/key locations

Do not commit these:

- Production env file: `/home/joshua/opentrust/.env.production.local`
- Registry online signing key: `/home/joshua/.config/opentrust/keys/registry-online.b64`
- Generated production secret store: `/home/joshua/.config/opentrust/secrets/production.env`
- Registry state: `/home/joshua/.local/state/opentrust/registry-state.json`
- SQLite preview DB: `/home/joshua/.local/state/opentrust/opentrust.db`

All secret files are mode `600`; parent secret/state directories are mode `700`.

## Start commands

Terminal 1: start the private API.

```bash
/home/joshua/opentrust/scripts/start-public-preview.sh
```

Terminal 2: start the web server.

```bash
cd /home/joshua/opentrust/web
set -a && source ../.env.production.local && set +a
npm run dev -- --port 3001
```

Terminal 3: start the free HTTPS tunnel.

```bash
cloudflared tunnel --no-autoupdate --url http://localhost:3001 --logfile /tmp/opentrust-cloudflared.log --loglevel info
```

Then read the current URL:

```bash
python3 - <<'PY'
import pathlib, re
text = pathlib.Path('/tmp/opentrust-cloudflared.log').read_text(errors='ignore')
print(re.findall(r'https://[-a-zA-Z0-9]+\.trycloudflare\.com', text)[-1])
PY
```

If the URL changes, update `REGISTRY_URL` and `CORS_ORIGINS` in `.env.production.local`, then restart the API.

## Verified public routes

- `/launch-lab` renders.
- `/tools` renders without API fetch crash.
- `/api/v1/health` returns HTTP 200 through the web proxy.
- `/.well-known/opentrust-keys.json` returns HTTP 200 through the web proxy.
- `/.well-known/opentrust-registries.json` returns HTTP 200 through the web proxy.
- `/.well-known/revoked-passports.json` returns HTTP 200 through the web proxy.

## Backup/restore drill

SQLite preview backup:

```bash
cd /home/joshua/opentrust
./scripts/backup-sqlite.sh
./scripts/restore-sqlite.sh
```

Last verified result:

```text
[backup-sqlite] Backup saved: /home/joshua/opentrust/backups/opentrust_sqlite_20260521_140051.db.gz
/home/joshua/opentrust/backups/opentrust_sqlite_20260521_140051.db.gz: OK
[restore-sqlite] verified database opens; tables=4
```

## Payment decision

Public preview uses mock payments only.

Reason: real USDC/USDT marketplace payments should wait until escrow contracts, dispute handling, hot-wallet limits, and payment quote review are complete. The registry can be public before money is live.

## What this solves

- No domain cost.
- HTTPS is live through Cloudflare.
- API stays private behind the web app.
- Registry signing key is outside git.
- Admin token and JWT secret are real generated secrets.
- Backup/restore drill exists and passed.
- Public demo is reachable.

## Remaining limitation

This is public-preview ready, not final infrastructure production. The weak point is not OpenTrust code now; it is the free tunnel's temporary URL and the local WSL machine uptime.
