import { env } from "./http.mjs";

function headers(extra = {}) {
  const key = env("SUPABASE_SERVICE_KEY");
  return { apikey: key, authorization: `Bearer ${key}`, ...extra };
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
  const res = await fetch(restUrl("docpharma_orders?select=*&order=queued_at.desc"), { headers: headers() });
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
  return readJson(await fetch(url, { headers: headers() }), "read");
}

// Saves what DocPharma returned for an order.
export async function recordPlacement(orderId, fields) {
  const url = restUrl(`docpharma_orders?orderID=eq.${encodeURIComponent(orderId)}`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers({ "content-type": "application/json", prefer: "return=minimal" }),
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text()}`);
}
