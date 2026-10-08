import { checkAuth, istNow, json } from "../lib/http.mjs";
import { fetchOrder, updateOrder } from "../lib/supabase.mjs";
import { STATUSES, allowedNext, akidhaUpdateStatus } from "../lib/akidha.mjs";

// Manual Akidha OMS update from the dashboard (admin), one step at a time.
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
    // The ULID comes from Supabase, not the browser.
    const order = await fetchOrder(orderID);
    if (!order) return json(404, { error: `Order ${orderID} is not in doc_pharma.orders` });
    if (!order.ULID) return json(422, { error: `Order ${orderID} has no ULID` });

    const allowed = allowedNext(order.akidha_status);
    if (!allowed.includes(status)) {
      const current = order.akidha_status || "not sent";
      return json(409, {
        error: allowed.length
          ? `Order ${orderID} is ${current} in Akidha; next step must be ${allowed.join(" or ")}. Press Refresh if it changed.`
          : `Order ${orderID} is already ${current} in Akidha; no further updates.`,
      });
    }

    const result = await akidhaUpdateStatus(order.ULID, status);
    if (!result.ok) {
      const error = `Akidha refused ${status} (${result.status}): ${result.body.slice(0, 300)}`;
      await updateOrder(order.orderID, { akidha_error: error });
      return json(502, { error, akidha: result.body });
    }

    await updateOrder(order.orderID, { akidha_status: status, akidha_updated_at: istNow(), akidha_error: null });
    return json(200, { ok: true, orderID, status });
  } catch (err) {
    console.error(err);
    return json(502, { error: err.message });
  }
};

export const config = { path: "/api/update-status" };
