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

export async function fetchReadyOrders() {
  const res = await fetch(restUrl("orders_ready_for_hl_viable?select=*&order=orderDate.desc.nullslast"), {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Matches on the same rows the dashboard lists, comparing IDs as trimmed
// text so a numeric/text or whitespace difference in "orderID" can't miss.
export async function fetchOrder(orderId) {
  const wanted = String(orderId).trim();
  const rows = await fetchReadyOrders();
  return rows.find((o) => String(o.orderID).trim() === wanted) || null;
}

// Records the status we pushed to Akidha on the order's row.
export async function recordAkidhaStatus(orderId, status) {
  const now = new Date().toISOString();
  const url = restUrl(`orders_ready_for_hl_viable?orderID=eq.${encodeURIComponent(orderId)}`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers({ "content-type": "application/json", prefer: "return=minimal" }),
    body: JSON.stringify({ akidha_status: status, akidha_updated_at: now, updated_at: now }),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text()}`);
}

// Item lines for one order from SUPER_SHEET_V1 (one row per SKU).
export async function fetchOrderItems(orderId) {
  const url = restUrl(
    `SUPER_SHEET_V1?select=skuCode,medicineName,itemQty,itemDiscountedPrice` +
      `&orderID=eq.${encodeURIComponent(orderId)}&order=medicineName.asc`
  );
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  return res.json();
}
