import { env } from "./http.mjs";

// DocPharma tables live in the doc_pharma schema; SUPER_SHEET_V1 is in public.
const SCHEMA = "doc_pharma";

function headers(extra = {}, schema = SCHEMA) {
  const key = env("SUPABASE_SERVICE_KEY");
  return { apikey: key, authorization: `Bearer ${key}`, "accept-profile": schema, "content-profile": schema, ...extra };
}

function restUrl(path) {
  // Accept both https://x.supabase.co and https://x.supabase.co/rest/v1/
  const base = env("SUPABASE_URL").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  return `${base}/rest/v1/${path}`;
}

async function readJson(res, what) {
  if (!res.ok) throw new Error(`Supabase ${what} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function fetchOrders() {
  const res = await fetch(restUrl("orders?select=*&order=queued_at.desc"), { headers: headers() });
  return readJson(res, "read");
}

// Compares IDs as trimmed text so a numeric/text difference can't miss.
export async function fetchOrder(orderId) {
  const wanted = String(orderId).trim();
  const rows = await fetchOrders();
  return rows.find((o) => String(o.orderID).trim() === wanted) || null;
}

// Item lines for one order from SUPER_SHEET_V1 (one row per SKU).
export async function fetchOrderItems(orderId) {
  const url = restUrl(
    `SUPER_SHEET_V1?select=skuCode,medicineName,itemQty,itemMRP,itemDiscountedPrice,shippingCost` +
      `&orderID=eq.${encodeURIComponent(orderId)}&order=medicineName.asc`
  );
  return readJson(await fetch(url, { headers: headers({}, "public") }), "read");
}

// Saves stock-check and place-order results on an order.
export async function updateOrder(orderId, fields) {
  const url = restUrl(`orders?orderID=eq.${encodeURIComponent(orderId)}`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers({ "content-type": "application/json", prefer: "return=minimal" }),
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text()}`);
}

