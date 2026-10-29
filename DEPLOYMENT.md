# Deployment & Environments

Manual deployment, no CI/CD and no Docker in production: the code is cloned and **built on the server**, and PM2 runs it under an unprivileged user. `docker-compose.yml` is only for a local Postgres (development and the e2e tests).

No real hosts, passwords, keys or connection strings belong in this repo. They exist only in the server's `.env` files (gitignored, mode 600).

## Layout on the server

| What | Where |
|---|---|
| App user | `tyreterra` — no sudo, no password, owns the app files |
| Code | `/opt/tyreterra` (git clone of `master`, mode 750) |
| API config | `/opt/tyreterra/apps/api/.env` (mode 600, owner `tyreterra`) |
| Web build config | `/opt/tyreterra/apps/web/.env.production` |
| Uploads | `/var/www/uploads` (owner `tyreterra`, group `www-data`, mode 750) — the path is fixed in `deals.controller.ts` |
| PM2 config | `/home/tyreterra/ecosystem.config.js` |
| PM2 boot unit | `pm2-tyreterra` (systemd, runs as `tyreterra`) |
| nginx site | `/etc/nginx/sites-available/tyreterra` (+ `00-catchall`, headers in `/etc/nginx/snippets/tyreterra-headers.conf`) |
| TLS | Let's Encrypt via `certbot --nginx`, renewed by `certbot.timer` |

| Process | Listens on |
|---|---|
| `tyreterra-api` (NestJS) | `127.0.0.1:3101` |
| `tyreterra-web` (Next.js) | `127.0.0.1:3100` |

Both bind to localhost only and are reached through nginx on `https://<domain>`. The firewall allows SSH, 80 and 443; a request by bare IP or an unknown `Host` gets no response (see *Domain, nginx, TLS*).

For debugging without nginx, an SSH tunnel still works (CORS will only accept it if `CORS_ORIGIN` is temporarily the tunnel origin):

```bash
ssh -N -L 3100:127.0.0.1:3100 -L 3101:127.0.0.1:3101 root@<server>
```

## Configuration

### API — `apps/api/.env`

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` on the server |
| `PORT` | yes | `3101` |
| `HOST` | no | bind address, default `127.0.0.1`; set `0.0.0.0` only if the API really must be exposed |
| `DATABASE_URL` | yes* | Neon connection string; takes priority over the discrete `DATABASE_HOST/PORT/USER/PASSWORD/NAME` (+ `DATABASE_SSL`) vars, which remain supported |
| `JWT_SECRET` | yes | random, e.g. `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | no | e.g. `15m` |
| `ENCRYPTION_KEY` | **yes** | key material for AES-256-GCM encryption of prices and contacts. The API refuses to start without it unless `NODE_ENV` is `development`/`test`. **Back it up outside the server** — if it is lost, existing encrypted data cannot be read |
| `CORS_ORIGIN` | yes | origin of the web app: `https://<domain>` |
| `FRONTEND_URL` | yes | base URL for password-reset links; same value as `CORS_ORIGIN` |

Enter secrets on the server directly (e.g. `read -rsp` into the file), never through chat, tickets or git.

### Web — `apps/web/.env.production`

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | **Baked into the bundle at build time** — changing it requires a rebuild. `/api` (nginx serves web and API on one domain); all API calls are made from the browser, so a relative URL works |

## Environments (`APP_ENV`)

Production is the default in every script. `APP_ENV=staging` makes `main.ts`, `app.module.ts` and `src/config/data-source.ts` load `apps/api/.env.staging` instead of `.env`:

```bash
cd apps/api
npm run start:staging            # nest start with APP_ENV=staging
npm run migration:run:staging    # migrations against the staging DB only
npm run migration:revert:staging
```

Each database has its own `migrations` table, so applying a migration to one never touches the other.

## First-time server setup

1. **OS hardening** (Ubuntu 24.04): SSH keys only (`PermitRootLogin prohibit-password`, `PasswordAuthentication no` in a `sshd_config.d` file that sorts first), `ufw` allowing SSH and `Nginx Full` (80/443), `fail2ban` for sshd, `unattended-upgrades`. Verify key login in a new session before closing the old one.
2. **Runtime:** Node 20 LTS (NodeSource apt repo), `git`, `npm i -g pm2`. Never run `pm2` commands as root — that starts a stray root daemon.
3. **User and directories:**
   ```bash
   useradd -m -s /bin/bash tyreterra
   install -d -o tyreterra -g tyreterra -m 750 /opt/tyreterra
   install -d -o tyreterra -g www-data  -m 750 /var/www/uploads
   ```
4. **Code and build** — as `tyreterra`, started from a directory it can read (e.g. `cd /home/tyreterra`), otherwise npm/PM2 fail with `EACCES`:
   ```bash
   cd /home/tyreterra
   sudo -u tyreterra git clone --branch master https://github.com/OttoOtter-hub/tyreterra-web.git /opt/tyreterra
   cd /opt/tyreterra
   sudo -u tyreterra -H npm ci
   sudo -u tyreterra -H env NODE_OPTIONS=--max-old-space-size=2048 nice -n 10 npm run api:build
   # write apps/web/.env.production (NEXT_PUBLIC_API_URL) first, then:
   cd apps/web && sudo -u tyreterra -H env NODE_OPTIONS=--max-old-space-size=2048 NEXT_TELEMETRY_DISABLED=1 nice -n 10 npm run build
   ```
   `npm ci` installs dev dependencies too — they are needed for the build and for `migration:run` (ts-node).
   Both builds first compile the shared tire size package `packages/tire-size` (`@tyreterra/tire-size`, used by API and web) through their `prebuild` scripts; no separate step is needed. `npm run size:build` builds it alone.
5. **`.env`:** create `apps/api/.env` (see the table above), `chown tyreterra:tyreterra`, `chmod 600`.
6. **Database schema** — see *Migrations* below.
7. **First admin:** `src/seed-admin.ts` reads the password only from `SEED_ADMIN_PASSWORD` (no default). Read it hidden inside the `tyreterra` shell so it never appears in `ps` or shell history:
   ```bash
   cd /home/tyreterra && sudo -u tyreterra -H bash -c '
     cd /opt/tyreterra/apps/api
     read -rsp "Admin password: " P; echo
     export SEED_ADMIN_PASSWORD="$P"; unset P
     ./node_modules/.bin/ts-node -T src/seed-admin.ts'
   ```
8. **PM2** — `/home/tyreterra/ecosystem.config.js`:
   ```js
   module.exports = {
     apps: [
       {
         name: 'tyreterra-api',
         cwd: '/opt/tyreterra/apps/api',
         script: 'dist/main.js',
         max_memory_restart: '600M',
         node_args: '--max-old-space-size=512',
       },
       {
         name: 'tyreterra-web',
         cwd: '/opt/tyreterra/apps/web',
         script: '/opt/tyreterra/node_modules/next/dist/bin/next', // hoisted by npm workspaces
         args: 'start -p 3100 -H 127.0.0.1',
         max_memory_restart: '600M',
         env: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
       },
     ],
   };
   ```
   ```bash
   cd /home/tyreterra
   sudo -u tyreterra -H pm2 start /home/tyreterra/ecosystem.config.js
   sudo -u tyreterra -H pm2 save
   pm2 startup systemd -u tyreterra --hp /home/tyreterra   # installs pm2-tyreterra.service
   ```

## Migrations

Schema changes go **only through migrations**. `synchronize` is `false` everywhere: the hand-written migrations differ from the entities in column types and enum names, and a sync would drop and re-add those columns.

```bash
cd /home/tyreterra && sudo -u tyreterra -H npm --prefix /opt/tyreterra/apps/api run migration:run
```

The `migrations` table records what has been applied (8 migrations as of 2026-10-20). The smart import branch adds 1750000000009 (listing_sizes, backfilled from listings), 1750000000010 (parsed load index columns + comment, backfilled by parsing `load_index`) , 1750000000011 (import tables) and 1750000000012 ("x" size diameter column; dot-less inch widths such as 1800R25 re-read as inches); they run on a database with data, and down migrations drop exactly what they added. Before running against an existing database, check that table for pending entries.

Creating a new migration (locally):

```bash
cd apps/api
npm run migration:generate -- src/migrations/DescriptiveName
# review the generated SQL, test it on a staging/disposable database, then commit
```

## Updating a running deployment

```bash
cd /home/tyreterra
sudo -u tyreterra git -C /opt/tyreterra pull --ff-only
sudo -u tyreterra -H npm --prefix /opt/tyreterra ci          # only if package-lock.json changed
sudo -u tyreterra -H env NODE_OPTIONS=--max-old-space-size=2048 nice -n 10 npm --prefix /opt/tyreterra run api:build
sudo -u tyreterra -H env NODE_OPTIONS=--max-old-space-size=2048 NEXT_TELEMETRY_DISABLED=1 nice -n 10 npm --prefix /opt/tyreterra/apps/web run build
sudo -u tyreterra -H npm --prefix /opt/tyreterra/apps/api run migration:run   # if the update contains migrations
sudo -u tyreterra -H pm2 restart tyreterra-api tyreterra-web
```

Logs: `sudo -u tyreterra -H pm2 logs tyreterra-api` (password-reset links appear here while the mailer is a stub).

## Domain, nginx, TLS

The domain's A record points at the server. Setup:

1. `apt install nginx certbot python3-certbot-nginx`, `ufw allow 'Nginx Full'`.
2. `/etc/nginx/snippets/tyreterra-headers.conf` — security headers, included at server level **and** in any location that has its own `add_header` (nginx drops inherited headers there):
   ```nginx
   add_header X-Content-Type-Options "nosniff" always;
   add_header X-Frame-Options "DENY" always;
   add_header Referrer-Policy "strict-origin-when-cross-origin" always;
   add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
   add_header Strict-Transport-Security "max-age=86400" always;   # raise to 31536000 once HTTPS is stable
   ```
   No CSP yet — it has to be tuned for Next.js first.
3. `/etc/nginx/sites-available/tyreterra` (symlinked into `sites-enabled`):
   ```nginx
   server {
       listen 80;
       listen [::]:80;
       server_name <domain>;

       server_tokens off;
       include /etc/nginx/snippets/tyreterra-headers.conf;

       location /api/ {
           proxy_pass http://127.0.0.1:3101;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           client_max_body_size 12m;
       }

       location /uploads/ {
           alias /var/www/uploads/;
           autoindex off;
           include /etc/nginx/snippets/tyreterra-headers.conf;
           add_header Content-Disposition "attachment" always;
       }

       location / {
           proxy_pass http://127.0.0.1:3100;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
   The API trusts exactly one proxy hop (`trust proxy` = 1), so the auth rate limits see the real client IP.
4. `/etc/nginx/sites-available/00-catchall` replaces the stock `default` site (remove its symlink), so a request by bare IP or unknown `Host` gets nothing:
   ```nginx
   server {
       listen 80 default_server;
       listen [::]:80 default_server;
       server_name _;
       server_tokens off;
       return 444;
   }
   server {
       listen 443 ssl default_server;
       listen [::]:443 ssl default_server;
       server_name _;
       ssl_reject_handshake on;
   }
   ```
5. `nginx -t && systemctl reload nginx`.
6. `certbot --nginx -d <domain> --redirect` — adds the 443 listener and certificate to the site and an HTTP→HTTPS redirect. Check renewal with `certbot renew --dry-run`.
7. Set `CORS_ORIGIN` and `FRONTEND_URL` to `https://<domain>`, rebuild web with `NEXT_PUBLIC_API_URL=/api`, restart both processes (`pm2 restart ... --update-env`).

The auth rate limits are kept in the API's memory: restarting `tyreterra-api` resets them (e.g. after an admin locks themselves out).

## Tests

```bash
npm test     # from the repo root: tire size package suites, then API unit suites + the critical-paths e2e suite
```

The e2e suite (`apps/api/src/test/critical-paths.e2e.spec.ts`) writes to the database it connects to and runs the migrations first. Point it only at a **disposable** database (e.g. `docker compose up -d` locally) — never staging or production.
