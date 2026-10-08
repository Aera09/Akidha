import { checkAuth, json } from "../lib/http.mjs";
import { fetchOrder, fetchOrderItems } from "../lib/supabase.mjs";
import { buildPayload } from "../lib/docpharma.mjs";
import { checkAndRecordStock } from "../lib/stock.mjs";

// Shows the exact body that Place Order would send, without sending it, and
// the DocPharma stock for its items (a read-only check).
export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Use GET" });
  const denied = checkAuth(req);
  if (denied) return denied;

  const orderID = new URL(req.url).searchParams.get("orderID");
  if (!orderID) return json(400, { error: "Need ?orderID=" });

  try {
    const order = await fetchOrder(orderID);
    if (!order) return json(404, { error: `Order ${orderID} is not in doc_pharma.orders` });
    const { payload, problems } = buildPayload(order, await fetchOrderItems(order.orderID));
    const stock = problems.length || order.dp_status === "PLACED" ? null : await checkAndRecordStock(order.orderID, payload);
    return json(200, { payload, problems, stock });
  } catch (err) {
    console.error(err);
    return json(502, { error: err.message });
  }
};

export const config = { path: "/api/payload" };
