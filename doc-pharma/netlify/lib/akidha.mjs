// Akidha OMS, for manual status updates from the dashboard. The Supabase edge
// function (supabase/functions/docpharma-webhook) sends the same statuses
// automatically when DocPharma reports shipped / delivered / RTO.
//   login:  POST {base}/api/v1/users/sessions  {email, password} -> JSESSIONID
//   status: PUT  {base}/api/v1/IN/en/orders/{ULID}/status/{STATUS}
// AKIDHA_ENV picks the settings: STAGE -> *_STAGE, PROD -> *_PROD.

export const STATUSES = ["SHIPMENT_PICKED_UP", "OUT_FOR_DELIVERY", "COMPLETED", "RTO_INITIATED", "RTO_DELIVERED"];

// Statuses allowed next, by the status last sent to Akidha ("" = not sent).
// Same steps as the edge function: one at a time; COMPLETED and RTO_DELIVERED are final.
export const NEXT_STATUSES = {
  "": ["SHIPMENT_PICKED_UP"],
  SHIPMENT_PICKED_UP: ["OUT_FOR_DELIVERY", "RTO_INITIATED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "RTO_INITIATED"],
  RTO_INITIATED: ["RTO_DELIVERED"],
  COMPLETED: [],
  RTO_DELIVERED: [],
};

export const allowedNext = (current) => NEXT_STATUSES[current || ""] ?? [];

export const akidhaEnv = () => (process.env.AKIDHA_ENV || "").trim().toUpperCase();

function setting(name) {
  const mode = akidhaEnv();
  const key = mode ? `${name}_${mode}` : name;
  const value = (process.env[key] || "").trim();
  if (!value) throw new Error(`Missing environment variable ${key}`);
  return value;
}

const baseUrl = () => setting("AKIDHA_BASE_URL").replace(/\/$/, "");

// Reused while the function instance stays warm.
let cachedSession = null;

async function login() {
  const res = await fetch(`${baseUrl()}/api/v1/users/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: setting("AKIDHA_EMAIL"), password: setting("AKIDHA_PASSWORD") }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("JSESSIONID="));
  if (!res.ok || !cookie) throw new Error(`Akidha login failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  cachedSession = cookie.slice("JSESSIONID=".length);
  return cachedSession;
}

async function sendStatus(sid, ulid, status) {
  const res = await fetch(`${baseUrl()}/api/v1/IN/en/orders/${encodeURIComponent(ulid)}/status/${encodeURIComponent(status)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `JSESSIONID=${sid}` },
    body: "{}",
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

const sessionExpired = (r) => r.status === 401 || r.status === 403 || r.body.includes("SessionKeyInvalid");

export async function akidhaUpdateStatus(ulid, status) {
  let result = cachedSession ? await sendStatus(cachedSession, ulid, status) : null;
  // No session yet, or it expired: log in once and retry.
  if (!result || (!result.ok && sessionExpired(result))) result = await sendStatus(await login(), ulid, status);
  return result;
}
