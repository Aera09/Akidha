// ═══════════════════════════════════════════════════════════════════════════
// DocPharma → Supabase (doc_pharma schema) → Akidha OMS
// Edge Function: docpharma-webhook
//
// DocPharma posts order updates here (invoiced, shipped, reattempt,
// delivered, ...). We answer straight away, then in the background:
//   1. update the order in doc_pharma.orders (current_status, current_status_at, ...)
//   2. add a row to doc_pharma.webhook_logs (every event, with its time)
//   3. if the new status means something for Akidha, update the order in
//      Akidha OMS (by ULID), one status step at a time
//
// Deploy:  supabase functions deploy docpharma-webhook --no-verify-jwt
// URL:     https://<project-ref>.supabase.co/functions/v1/docpharma-webhook?token=<DOCPHARMA_WEBHOOK_SECRET>
//
// Secrets (supabase secrets set NAME=value):
//   DOCPHARMA_WEBHOOK_SECRET          same value as in the dashboard's .env
//   AKIDHA_ENV                        STAGE or PROD
//   AKIDHA_BASE_URL_STAGE / _PROD     https://stageapi.akidha.in / https://api.akidha.in
//   AKIDHA_EMAIL_STAGE / _PROD
//   AKIDHA_PASSWORD_STAGE / _PROD
// SUPABASE_URL and the service role key are provided by Supabase.
// ═══════════════════════════════════════════════════════════════════════════

import { akidhaSteps, akidhaTarget, currentStatus, rowUpdate, summarize } from "./logic.ts";

const SCHEMA = "doc_pharma";

// Current time in India as "YYYY-MM-DD HH:MM:SS" (IST); the tables store IST.
const istNow = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 19).replace("T", " ");

function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.service_role) return keys.service_role;
  } catch { /* fall through */ }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

// ── Supabase REST, scoped to the doc_pharma schema ───────────────────────
async function db(path: string, init: RequestInit = {}) {
  const key = serviceKey();
  const res = await fetch(`${env("SUPABASE_URL").replace(/\/+$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "accept-profile": SCHEMA,
      "content-profile": SCHEMA,
      "content-type": "application/json",
      prefer: "return=minimal",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path.split("?")[0]} failed (${res.status}): ${await res.text()}`);
  // Writes come back empty (prefer: return=minimal), reads come back as JSON.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function findOrder(partnerOrderId: string) {
  const wanted = partnerOrderId.trim();
  const rows = await db(`orders?select=*&orderID=eq.${encodeURIComponent(wanted)}`);
  return rows?.[0] ?? null;
}

const patchOrder = (orderID: string, fields: Record<string, unknown>) =>
  db(`orders?orderID=eq.${encodeURIComponent(orderID)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...fields, updated_at: istNow() }),
  });

// ── Akidha OMS (same endpoints as mx-inbound) ───────────────────────────
function akidha(name: string): string {
  const mode = env("AKIDHA_ENV").toUpperCase();
  const value = env(mode ? `${name}_${mode}` : name);
  if (!value) throw new Error(`Missing secret ${mode ? `${name}_${mode}` : name}`);
  return value;
}

async function akidhaLogin(): Promise<string> {
  const res = await fetch(`${akidha("AKIDHA_BASE_URL").replace(/\/$/, "")}/api/v1/users/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: akidha("AKIDHA_EMAIL"), password: akidha("AKIDHA_PASSWORD") }),
  });
  const match = (res.headers.get("set-cookie") ?? "").match(/JSESSIONID=([^;]+)/);
  if (!res.ok || !match) throw new Error(`Akidha login failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return match[1];
}

async function akidhaStatus(sid: string, ulid: string, status: string) {
  const res = await fetch(
    `${akidha("AKIDHA_BASE_URL").replace(/\/$/, "")}/api/v1/IN/en/orders/${encodeURIComponent(ulid)}/status/${status}`,
    { method: "PUT", headers: { cookie: `JSESSIONID=${sid}`, "content-type": "application/json" }, body: "{}" },
  );
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// Sends each step to Akidha in order; stops at the first one Akidha refuses.
// Returns the last status Akidha accepted and a short note for the log.
async function pushToAkidha(ulid: string, steps: string[]) {
  let sid = await akidhaLogin();
  let reached: string | null = null;
  for (const step of steps) {
    let r = await akidhaStatus(sid, ulid, step);
    if (!r.ok && (r.status === 401 || r.status === 403 || r.body.includes("SessionKeyInvalid"))) {
      sid = await akidhaLogin();
      r = await akidhaStatus(sid, ulid, step);
    }
    if (!r.ok) {
      return { reached, error: `Akidha refused ${step} (${r.status}): ${r.body.slice(0, 300)}` };
    }
    reached = step;
  }
  return { reached, error: null };
}

// ── Webhook ──────────────────────────────────────────────────────────────
function tokenOk(req: Request): boolean {
  const secret = env("DOCPHARMA_WEBHOOK_SECRET");
  const given = new URL(req.url).searchParams.get("token") || "";
  if (!secret || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function processEvent(event: any) {
  const { partnerOrderId, fields } = summarize(event);
  const order = partnerOrderId ? await findOrder(partnerOrderId) : null;
  let akidhaResult = order ? "no Akidha change for this status" : "order not in doc_pharma.orders";

  try {
    if (order) {
      const update = rowUpdate(order, fields);
      const now = istNow();
      await patchOrder(order.orderID, {
        ...update,
        ...(update.current_status ? { current_status_at: now } : {}),
        dp_last_event: event,
        dp_last_event_at: now,
      });

      // Use the order's status after this event to decide what Akidha needs.
      const steps = akidhaSteps(order.akidha_status, akidhaTarget({ ...order, ...update }));
      if (steps.length && !order.ULID) {
        akidhaResult = `would send ${steps.join(" → ")}, but the order has no ULID`;
        await patchOrder(order.orderID, { akidha_error: akidhaResult });
      } else if (steps.length) {
        const { reached, error } = await pushToAkidha(order.ULID, steps);
        akidhaResult = error ?? `sent ${steps.join(" → ")}`;
        await patchOrder(order.orderID, {
          ...(reached ? { akidha_status: reached, akidha_updated_at: istNow() } : {}),
          akidha_error: error,
        });
      }
    }
  } catch (err) {
    akidhaResult = `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
    console.error("[docpharma-webhook]", partnerOrderId, akidhaResult);
    if (order) await patchOrder(order.orderID, { akidha_error: akidhaResult }).catch(() => {});
  }

  await db("webhook_logs", {
    method: "POST",
    body: JSON.stringify({
      partner_order_id: partnerOrderId,
      current_status: currentStatus(fields),
      order_status: fields.dp_order_status,
      suborder_status: fields.dp_suborder_status,
      status_code: fields.dp_status_code,
      matched: Boolean(order),
      akidha_result: akidhaResult,
      payload: event,
    }),
  });
  console.log(`[docpharma-webhook] ${partnerOrderId} | ${fields.dp_suborder_status ?? fields.dp_order_status} | ${akidhaResult}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!tokenOk(req)) return json({ error: "Invalid webhook token" }, 401);

  let event: any;
  try {
    event = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  // Answer DocPharma straight away; do the work in the background.
  const work = processEvent(event).catch((err) => console.error("[docpharma-webhook] failed:", err));
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  else await work;
  return json({ received: true });
});
