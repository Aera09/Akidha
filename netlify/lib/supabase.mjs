import { env } from "./http.mjs";

function headers(extra = {}) {
  const key = env("SUPABASE_SERVICE_KEY");
  return { apikey: key, authorization: `Bearer ${key}`, ...extra };
}

function restUrl(path) {
  return `${env("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`;
}

export async function fetchReadyOrders() {
  const res = await fetch(restUrl("orders_ready_for_3pl?select=*&order=orderDate.desc"), {
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

// Records the status we pushed to Akidha. No-op when the column isn't configured.
export async function recordAkidhaStatus(orderId, status) {
  const column = env("SUPABASE_WRITEBACK_COLUMN", "");
  if (!column) return;
  const body = { [column]: status };
  if (column === "akidha_status") body.akidha_updated_at = new Date().toISOString();
  const res = await fetch(restUrl(`Order_Level_V4?orderID=eq.${encodeURIComponent(orderId)}`), {
    method: "PATCH",
    headers: headers({ "content-type": "application/json", prefer: "return=minimal" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text()}`);
}
