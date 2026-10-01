import { checkAuth, json } from "../lib/http.mjs";
import { fetchOrder, fetchOrderItems } from "../lib/supabase.mjs";

const isCod = (paymentMode) => /cod|cash/i.test(paymentMode || "");

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Use GET" });
  const denied = checkAuth(req);
  if (denied) return denied;

  const orderID = new URL(req.url).searchParams.get("orderID");
  if (!orderID) return json(400, { error: "Need ?orderID=" });

  try {
    const order = await fetchOrder(orderID);
    if (!order) return json(404, { error: `Order ${orderID} is not in orders_ready_for_hl_viable` });

    const items = (await fetchOrderItems(order.orderID)).map((i) => ({
      sku: i.skuCode,
      name: i.medicineName,
      qty: Number(i.itemQty) || 0,
      price: Number(i.itemDiscountedPrice) || 0,
    }));
    if (!items.length) return json(404, { error: `No items for order ${orderID} in SUPER_SHEET_V1` });

    // itemDiscountedPrice is taken as the price of one unit.
    const orderValue = Math.round(items.reduce((sum, i) => sum + i.price * i.qty, 0) * 100) / 100;
    const totalQty = items.reduce((sum, i) => sum + i.qty, 0);

    return json(200, {
      orderNo: order.orderID,
      orderDate: order.orderDate,
      customerName: [order.cx_first_name, order.cx_last_name].filter(Boolean).join(" "),
      address: [order.cx_add_street_1, order.cx_add_street_2, order.city, order.state]
        .map((p) => String(p ?? "").trim())
        .filter(Boolean)
        .join(", "),
      pincode: order.pincode,
      mobile: order.cxPhone,
      paymentMode: order.paymentMode,
      orderValue,
      // Prepaid orders have nothing to collect on delivery.
      collectible: isCod(order.paymentMode) ? orderValue : 0,
      items,
      totalQty,
    });
  } catch (err) {
    console.error(err);
    return json(502, { error: err.message });
  }
};

export const config = { path: "/api/label" };
