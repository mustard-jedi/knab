# Knab

A small, self-hosted envelope budget. Assign every dollar to a category, enter
transactions quickly from a phone, and see reports. Budget periods can start on
any day of the month (for example the 23rd, giving Jan 23 – Feb 22).

- **Multi-user, password protected.** Each person has private budgets and can
  invite others into a specific budget.
- **Custom cutoff periods.** One setting per budget; change it any time.
- **Recurring transactions**, transfers, CSV export, light and dark themes.
- **REST API** with a flat JSON Schema designed for small local AI models, plus
  a `knab` command-line client. See [docs/API.md](docs/API.md).
- No bank connections and no loan calculators.

Stack: Node.js 22, Fastify, SQLite (one file), React + Tailwind.

## Run it on your own computer

```bash
npm install
npm run build
npm start
```

Open <http://localhost:3000>. The first visit asks you to create the admin
account, then your first budget.

For development, `npm run dev` runs the API on port 3000 and the web app with
live reload on <http://localhost:5173>. `npm test` runs the test suite.

## Deploy on a Linux server

One-time setup (Node.js 22+ and git must be installed):

```bash
npm install -g pm2
git clone https://github.com/YOUR_NAME/knab.git
cd knab
cp .env.example .env      # then edit .env
./deploy.sh
pm2 startup               # prints a command to run so Knab starts on boot
```

To update later, run `./deploy.sh` again. It backs up the database, pulls from
GitHub, installs dependencies, runs the tests, builds the web app, removes
development dependencies, reloads the PM2 service and checks that it answers.
If any step fails it stops before touching the running service.
`./deploy.sh some-branch` deploys a branch other than `main`.

Useful commands: `pm2 status`, `pm2 logs knab`, `pm2 restart knab`.

### Settings (`.env`)

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | `127.0.0.1` = only via a reverse proxy on the same machine; `0.0.0.0` = reachable directly on your network |
| `DB_PATH` | `data/knab.sqlite` | Where the database file lives |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | Set `true` behind nginx or Caddy |

### Putting it on the internet

Do not expose port 3000 directly. Put a reverse proxy with HTTPS in front, keep
`HOST=127.0.0.1`, and set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.

With [Caddy](https://caddyserver.com) the whole configuration is:

```
budget.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Sign-in attempts are limited to 10 per 5 minutes per address, passwords are
stored as Argon2 hashes, and there is no public sign-up: only an admin can add
users (Settings → Users).

### Backups

All data is in the one database file. `node scripts/backup.js` writes a safe
copy to `backups/` while the server is running and keeps the newest 14.
`deploy.sh` runs it before every update. To run it nightly, add this with
`crontab -e` (adjust the path):

```
15 3 * * * cd /home/you/knab && node scripts/backup.js >> backups/backup.log 2>&1
```

To restore, stop the service, copy a backup over `data/knab.sqlite`, delete any
`data/knab.sqlite-wal` and `data/knab.sqlite-shm` files, and start it again.

## How the budget works

- **Ready to Assign** is money you have that is not yet in a category. Income
  recorded without a category lands there; assigning money to categories brings
  it down to zero.
- **Available** for a category is everything ever assigned to it plus all its
  transactions. Unspent money carries into the next period, and so does
  overspending (as a negative amount).
- Ready to Assign plus the Available of every category always equals the total
  of your account balances. Transfers between accounts never change the budget.
- Credit cards are ordinary accounts with a negative balance. Spending on the
  card comes out of the category at the time of purchase; paying the card is a
  transfer.
- **Periods.** A budget's "period starts on day" setting decides the date
  ranges. A period is named after the month it starts in, so with day 23,
  `2026-01` is Jan 23 – Feb 22. Day 29–31 falls back to the last day of shorter
  months. Changing the day re-sorts existing transactions into the new ranges;
  assigned amounts stay with their period name.

## Project layout

```
server/            API server (Fastify), SQL migrations, recurring job
shared/periods.js  Date and period maths used by both server and web app
web/               React app (built into dist/)
bin/knab.js        Command-line client
test/              Tests (node --test)
deploy.sh          Update-and-restart script for Linux
ecosystem.config.cjs  PM2 process definition
scripts/backup.js  Database backup
```
