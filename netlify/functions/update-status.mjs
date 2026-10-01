import { checkAuth, json } from "../lib/http.mjs";
import { fetchOrder, recordAkidhaStatus } from "../lib/supabase.mjs";
import { STATUSES, allowedNext, akidhaUpdateStatus } from "../lib/akidha.mjs";

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
    // request can't update an order that never reached READY_FOR_HL.
    const order = await fetchOrder(orderID);
    if (!order) {
      return json(404, {
        error: `Order ${orderID} is no longer in orders_ready_for_hl_viable. Press Refresh; its status may have changed.`,
      });
    }
    if (!order.ULID) return json(422, { error: `Order ${orderID} has no ULID` });

    // Statuses go one step at a time (e.g. no Delivered before Out for delivery).
    const allowed = allowedNext(order.akidha_status);
    if (!allowed.includes(status)) {
      const current = order.akidha_status || "not sent";
      return json(409, {
        error: allowed.length
          ? `Order ${orderID} is ${current}; next step must be ${allowed.join(" or ")}.`
          : `Order ${orderID} is already ${current}; no further updates.`,
      });
    }

    const result = await akidhaUpdateStatus(order.ULID, status);
    if (!result.ok) {
      return json(502, { error: `Akidha rejected the update (${result.status})`, akidha: result.body });
    }

    // Use the ID exactly as stored so the view's join matches.
    await recordAkidhaStatus(order.orderID, status);
    return json(200, { ok: true, orderID, status, akidha: result.body });
  } catch (err) {
    console.error(err);
    return json(502, { error: err.message });
  }
};

export const config = { path: "/api/update-status" };
