# Akidha 3PL dashboard

Reads orders from the Supabase table `threepl_orders`, shows them in a web
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

Run `sql/threepl_orders.sql` once in the Supabase SQL editor. It creates the
`threepl_orders` table and a trigger on `Order_Level_V4`:

- when an order's status becomes `ready_for_3pl`, it is inserted into `threepl_orders`
- any later change to that order in `Order_Level_V4` updates its row
- the dashboard stores the status it sent to Akidha in `akidha_status`

It also copies in the orders that are already `ready_for_3pl`. Running it
again is safe.

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

## Akidha API

`netlify/lib/akidha.mjs` uses the same Akidha endpoints as the `mx-inbound`
edge function:

- Login: `POST /api/v1/users/sessions` with `{ email, password }`, returns a `JSESSIONID` cookie
- Status: `PUT /api/v1/IN/en/orders/{ULID}/status/{STATUS}`

Point `AKIDHA_BASE_URL` at `https://stageapi.akidha.in` while testing and
switch to `https://api.akidha.in` for production.
