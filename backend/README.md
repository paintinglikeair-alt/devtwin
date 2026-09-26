# DevTwin Backend — Deployment Guide

## Stack
- **Frontend:** `devtwin/index.html` → deploy as a static site on Railway
- **Backend:** `devtwin/backend/` → deploy as a Node.js service on Railway
- **Database:** Supabase (Postgres)

---

## Step 1 — Supabase Setup

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → New Project
2. Open **SQL Editor** → paste the contents of [`schema.sql`](./schema.sql) → Run
3. Go to **Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_KEY` *(keep this secret!)*

---

## Step 2 — Railway Backend Deployment

1. Go to [railway.com/dashboard](https://railway.com/dashboard) → New Project → Deploy from GitHub repo
2. Select this repo, set **Root Directory** to `devtwin/backend`
3. Add these **Environment Variables** in Railway:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Your Supabase service_role key |
| `JWT_SECRET` | Any long random string |

4. Railway will auto-detect `package.json` and run `node server.js`
5. Copy the deployed URL (e.g. `https://devtwin-backend-production.up.railway.app`)

---

## Step 3 — Point the Frontend to the Backend

In `devtwin/index.html`, find this line near the bottom:

```js
const DEVTWIN_API = (window.DEVTWIN_API_URL || '').replace(/\/$/, '');
```

You can either:

**Option A** — Hard-code it (simplest for hackathon):
```js
const DEVTWIN_API = 'https://your-app.up.railway.app';
```

**Option B** — Set it at runtime via a `<script>` tag before the closing `</body>`:
```html
<script>window.DEVTWIN_API_URL = 'https://your-app.up.railway.app';</script>
```

---

## Step 4 — Deploy the Frontend

Option: serve `devtwin/index.html` as a static file from the same Railway service, or use a second Railway static site.

To serve it from the backend, add this to `server.js`:
```js
import { readFileSync } from 'fs';
app.get('/', (_, res) => res.send(readFileSync('../index.html', 'utf8')));
```

---

## Step 5 — Connect Bob

1. Open DevTwin in the browser → click **Profile / Login** in the sidebar
2. Register / Login
3. In the **Connect Bob to DevTwin** section, click **Copy MCP Config for Bob**
4. In Bob: **Settings → MCP Servers** → paste the JSON config
5. In Bob chat, say:
   > *"Show me my latest DevTwin snapshots"*

Bob will call `get_my_snapshots` via MCP and return your personal snapshots instantly. 🚀

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create account |
| POST | `/auth/login` | — | Login |
| POST | `/auth/regen-token` | JWT | Regenerate MCP token |
| POST | `/snapshots` | JWT | Push snapshots |
| GET | `/snapshots` | JWT | Pull snapshots |
| POST | `/mcp` | MCP Token | Bob MCP endpoint |
| GET | `/health` | — | Health check |
