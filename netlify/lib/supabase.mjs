import { env } from "./http.mjs";

// threepl_orders columns, renamed to the field names the dashboard uses.
const COLUMNS = [
  "orderID:order_id",
  "ULID:ulid",
  "orderDate:order_date",
  "paymentMode:payment_mode",
  "cxPhone:cx_phone",
  "cx_first_name",
  "cx_last_name",
  "status:source_status",
  "akidha_status",
  "akidha_updated_at",
].join(",");

function headers(extra = {}) {
  const key = env("SUPABASE_SERVICE_KEY");
  return { apikey: key, authorization: `Bearer ${key}`, ...extra };
}

function restUrl(path) {
  // Accept both https://x.supabase.co and https://x.supabase.co/rest/v1/
  const base = env("SUPABASE_URL").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  return `${base}/rest/v1/${path}`;
}

export async function fetchReadyOrders() {
  const res = await fetch(restUrl(`threepl_orders?select=${COLUMNS}&order=order_date.desc.nullslast`), {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function fetchOrder(orderId) {
  const url = restUrl(
    `threepl_orders?select=${COLUMNS}&order_id=eq.${encodeURIComponent(orderId)}&limit=1`
  );
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

// Records the status we pushed to Akidha.
export async function recordAkidhaStatus(orderId, status) {
  const now = new Date().toISOString();
  const res = await fetch(restUrl(`threepl_orders?order_id=eq.${encodeURIComponent(orderId)}`), {
    method: "PATCH",
    headers: headers({ "content-type": "application/json", prefer: "return=minimal" }),
    body: JSON.stringify({ akidha_status: status, akidha_updated_at: now, updated_at: now }),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text()}`);
}
