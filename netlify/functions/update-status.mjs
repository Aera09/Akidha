import { checkAuth, json } from "../lib/http.mjs";
import { fetchOrder, recordAkidhaStatus } from "../lib/supabase.mjs";
import { STATUSES, akidhaUpdateStatus } from "../lib/akidha.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const denied = checkAuth(req);
  if (denied) return denied;

  let input;
  try {
    input = await req.json();
  } catch {
    return json(400, { error: "Body must be JSON" });
  }
  const { orderID, status } = input || {};
  if (!orderID || !STATUSES.includes(status)) {
    return json(400, { error: `Need orderID and a status in: ${STATUSES.join(", ")}` });
  }

  try {
    // Take the ULID from Supabase rather than the browser, so a tampered
    // request can't update an order that isn't ready_for_3pl.
    const order = await fetchOrder(orderID);
    if (!order) return json(404, { error: `Order ${orderID} is not in orders_ready_for_3pl` });
    if (!order.ULID) return json(422, { error: `Order ${orderID} has no ULID` });

    const result = await akidhaUpdateStatus(order.ULID, status);
    if (!result.ok) {
      return json(502, { error: `Akidha rejected the update (${result.status})`, akidha: result.body });
    }

    await recordAkidhaStatus(orderID, status);
    return json(200, { ok: true, orderID, status, akidha: result.body });
  } catch (err) {
    console.error(err);
    return json(502, { error: err.message });
  }
};

export const config = { path: "/api/update-status" };
