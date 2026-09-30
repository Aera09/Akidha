# Akidha 3PL dashboard

Reads orders from the Supabase view `orders_ready_for_3pl`, shows them in a web
page, and pushes a status change to the Akidha OMS when you click **Send**.

```
Browser (public/index.html)
   │  /api/orders, /api/update-status   (dashboard password header)
   ▼
Netlify Functions (netlify/functions)  ── keeps all secrets server-side
   ├── Supabase REST  → read view, write back akidha_status
   └── Akidha OMS     → login (JSESSIONID) → status update by ULID
```

The browser never calls Akidha or Supabase directly. That keeps the Akidha
password and Supabase service key off the public site, and avoids CORS problems.

## 1. Supabase

Run `sql/orders_ready_for_3pl.sql` in the Supabase SQL editor. It adds
`akidha_status` / `akidha_updated_at` to `Order_Level_V4` and recreates the view
with `ULID`, `status` and those two columns.

## 2. Run locally

Needs Node 20.12 or newer. There are no npm dependencies.

```bash
cp .env.example .env     # fill in real values
npm start                # http://localhost:8888
```

`npm run dev` restarts the server when you edit a file.

## 3. Deploy to Netlify

1. Push this repo to GitHub and import it in Netlify (build settings come from `netlify.toml`, no build command).
2. Site configuration → Environment variables: add every key from `.env.example` except `PORT`.
3. Deploy. The page and `/api/*` routes work the same as locally.

## Akidha API settings

The login and status-update requests are in `netlify/lib/akidha.mjs`. Check
them against the Akidha API docs and adjust the env vars (`AKIDHA_LOGIN_PATH`,
`AKIDHA_LOGIN_FORMAT`, `AKIDHA_STATUS_PATH`, `AKIDHA_STATUS_METHOD`) or the
request body in `sendStatus()` if they differ.
