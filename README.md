# Schedule Tracker — MERN Port

A full rewrite of the Flask + PostgreSQL "Schedule Tracker" app as **React (Next.js) + Node (Express) + MongoDB**. Lives entirely in this folder — the original Flask app next door (`../app.py` etc.) is untouched.

```
schedule-tracker-mern/
├── server/     Express API (port 8420) + MongoDB models + migration script
└── client/     Next.js frontend (port 5005)
```

## 1. Prerequisites

- **Node.js 18+** (this was built/tested on Node 24)
- **MongoDB Community Server**, running locally on the default port 27017
  - Download: https://www.mongodb.com/try/download/community
  - After installing, make sure the `MongoDB` Windows service is running (Services app, or `net start MongoDB` from an admin prompt)

## 2. Server setup

```bash
cd server
copy .env.example .env
npm install
npm run dev          # http://localhost:8420
```

Edit `.env` if you want to change the MongoDB URI, ports, or any of the feature passwords (defaults match the original Flask app: delete/update/log/request-log passwords are all preserved). The notifications password gate was removed at the user's request — `/notifications` is open to any admin/management user, no password.

The very first time the server starts, there are **no users yet** — either run the migration below (recommended, brings over your real data) or insert one admin user manually:

```js
// From server/, with MongoDB running:
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('./src/models');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  await User.create({ username: 'admin', password: 'changeme', role: 'admin' });
  console.log('Created admin/changeme');
  process.exit(0);
});
"
```

## 3. Migrating your existing PostgreSQL data (recommended)

This carries over every table from the live Postgres database (`new_schedule_track` by default) — users, records, hold attachments, completed log, notifications, activity log, request log, and the editing log.

1. In `server/.env`, fill in `PG_HOST` / `PG_PORT` / `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` with your real Postgres credentials.
2. (Optional) If you want the hold-attachment image files copied over too, also set `PG_HOLD_IMAGES_DIR` and `PG_ONHOLD_DIR` to the Flask app's `hold_images` / `onhold_attachments` folders on this machine.
3. **Run it against a copy of your database first**, not production, until you've verified the output.
4. From `server/`:
   ```bash
   npm run migrate
   ```
5. The script prints row-count verification (Postgres vs MongoDB) at the end — check those match.

Passwords: stored and compared as plain text, matching the original Flask app's actual behavior exactly (its own `hash_password()` helper existed but was never used — logins there compare the raw column value).

Re-running the migration is safe for users/records/master-lists/notifications (upserted); it skips completed_log/activity_log/request_log/editing_log if they're already populated in MongoDB, to avoid duplicating pure event logs.

## 4. Client setup

```bash
cd client
copy .env.local.example .env.local
npm install
npm run dev          # http://localhost:5005
```

Open http://localhost:5005/login.

## 5. What's different from the Flask app (deliberately)

- A few confirmed bugs in the original were fixed rather than ported: the Editing Log export used to bypass its own row-level access control; the Completed Log export used a different (narrower) team-lead scoping rule than the page that displays it; notification "seen" tracking used a comma-string substring match that could false-positive.
- `/api/records` returns JSON rows instead of a server-rendered HTML fragment (the React table renders its own rows) — same pagination/sort/search/filter contract otherwise.
- The request log auto-expires after 90 days (TTL index) instead of growing forever — easy to remove in `server/src/models/RequestLog.js` if you want indefinite retention.
- `dashboard.py` (a dead placeholder landing page) and `test.py` (leftover debug script) were not ported — see the project's plan notes for why.
- The Editing Log's spreadsheet-style grid keeps click/shift-click/drag selection and Ctrl+C/Ctrl+V/Ctrl+D, but the mouse-drag fill-handle and right-click context menu from the original were not rebuilt (same operations remain reachable via keyboard).

## 6. Daily backup

The server automatically runs a daily Excel export of the live `records` collection to `server/uploads/backups/schedule_data_YYYY-MM-DD.xlsx` (once at startup, then every midnight), with 60-day retention — matching `daily_backup.py`. Change `BACKUP_RETENTION_DAYS` / `BACKUP_DIR` in `.env` if needed.
