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
  const res = await fetch(restUrl("orders_ready_for_3pl?select=*&order=orderDate.desc.nullslast"), {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function fetchOrder(orderId) {
  const url = restUrl(
    `orders_ready_for_3pl?select=*&orderID=eq.${encodeURIComponent(orderId)}&limit=1`
  );
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

// Records the status we pushed to Akidha. Once an order has a row here it
// stays in orders_ready_for_3pl even after its Order_Level_V4 status changes.
export async function recordAkidhaStatus(orderId, status) {
  const res = await fetch(restUrl("threepl_status?on_conflict=order_id"), {
    method: "POST",
    headers: headers({
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      order_id: String(orderId),
      akidha_status: status,
      akidha_updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text()}`);
}
