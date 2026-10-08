import { checkAuth, json } from "../lib/http.mjs";
import { fetchOrder, fetchOrderItems, updateOrder } from "../lib/supabase.mjs";
import { checkAndRecordStock } from "../lib/stock.mjs";
import { buildPayload, placeOrder } from "../lib/docpharma.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const denied = checkAuth(req);
  if (denied) return denied;

  let orderID;
  try {
    ({ orderID } = await req.json());
  } catch {
    return json(400, { error: "Body must be JSON" });
  }
  if (!orderID) return json(400, { error: "Need orderID" });

  try {
    const order = await fetchOrder(orderID);
    if (!order) return json(404, { error: `Order ${orderID} is not in doc_pharma.orders` });
    // Never place the same order twice.
    if (order.dp_status === "PLACED") {
      return json(409, { error: `Order ${orderID} is already placed with DocPharma (${order.dp_fh_order_id}).` });
    }

    const { payload, problems } = buildPayload(order, await fetchOrderItems(order.orderID));
    if (problems.length) return json(422, { error: `Not sent: ${problems.join("; ")}`, payload });

    // Place only when DocPharma has every item in stock for this pincode.
    const stock = await checkAndRecordStock(order.orderID, payload);
    if (!stock.inStock) return json(409, { error: `Not sent: ${stock.reason}`, stock });

    const result = await placeOrder(payload);
    const now = new Date().toISOString();
    if (!result.ok) {
      const reason = result.body.error || result.body.message || result.body.raw || `HTTP ${result.httpStatus}`;
      await updateOrder(order.orderID, { dp_status: "FAILED", dp_error: String(reason).slice(0, 500), dp_response: result.body });
      return json(502, { error: `DocPharma rejected the order (${result.httpStatus}): ${reason}`, docpharma: result.body });
    }

    const fields = {
      dp_status: "PLACED",
      dp_fh_order_id: result.body.data?.fh_order_id ?? null,
      dp_order_number: result.body.order_number != null ? String(result.body.order_number) : null,
      dp_error: null,
      dp_response: result.body,
      dp_placed_at: now,
    };
    await updateOrder(order.orderID, fields);
    return json(200, { ok: true, orderID, ...fields });
  } catch (err) {
    console.error(err);
    return json(502, { error: err.message });
  }
};

export const config = { path: "/api/place-order" };
