// DocPharma Partner API (see the DocPharma_Partner_API Postman collection).
//   POST {baseUrl}/v2/place-order/   header x-api-key
// DOCPHARMA_ENV picks the settings: DEV -> *_DEV, PROD -> *_PROD.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const isCod = (paymentMode) => /\bcod\b|cash|\bpod\b|pay on delivery/i.test(paymentMode || "");

function setting(name, fallback) {
  const mode = (process.env.DOCPHARMA_ENV || "").trim().toUpperCase();
  const key = mode ? `${name}_${mode}` : name;
  const value = (process.env[key] || "").trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${key}`);
}

const optional = (name) => (process.env[name] || "").trim();

// Last 10 digits, so "+91 98765 43210" becomes "9876543210".
const mobile10 = (phone) => String(phone ?? "").replace(/\D/g, "").slice(-10);

// Builds the place-order body for one docpharma_orders row and its
// SUPER_SHEET_V1 item lines. Returns { payload, problems } where problems
// lists anything DocPharma marks mandatory that is missing.
export function buildPayload(order, items) {
  const id = String(order.orderID).trim();
  const name = [order.cx_first_name, order.cx_last_name].map((p) => String(p ?? "").trim()).filter(Boolean).join(" ");
  const cod = isCod(order.paymentMode);

  const orderDetails = items.map((i) => {
    const qty = Number(i.itemQty) || 0;
    const mrp = round2(i.itemMRP ?? i.itemDiscountedPrice);
    const price = Number(i.itemDiscountedPrice ?? i.itemMRP) || 0;
    return {
      partner_sku_code: String(i.skuCode),
      fh_sku_type: "Medicine",
      sku_name: i.medicineName,
      sku_qty: qty,
      mrp,
      // Discount for the whole line: (MRP - selling price) x qty.
      discount_amount: round2(Math.max(0, mrp - price) * qty),
    };
  });

  const shipping = round2(items.find((i) => i.shippingCost != null)?.shippingCost);
  const itemsTotal = orderDetails.reduce((s, i) => s + i.mrp * i.sku_qty - i.discount_amount, 0);
  const amount = round2(order.finalAmount ?? itemsTotal + shipping);

  const payload = {
    partner_order_id: id,
    partner_order_no: id,
    customer_name: name,
    patient_name: name,
    mobile_no: mobile10(order.cxPhone),
    state: order.state ?? "",
    city: order.city ?? "",
    zipcode: String(order.pincode ?? "").trim(),
    address_1: order.cx_add_street_1 ?? "",
    address_2: order.cx_add_street_2 ?? "",
    payment_mode_order: cod ? "COD" : "Prepaid",
    payment_mode_item: {
      payment_details: [
        {
          payment_status: cod ? 1 : 10,
          transaction_id: cod ? `COD_${id}` : id,
          amount,
        },
      ],
    },
    collectible: cod ? amount : 0,
    order_details: orderDetails,
    discount: 0,
    shipping_charges: shipping,
    order_type: setting("DOCPHARMA_ORDER_TYPE", "HL"),
  };
  if (optional("DOCPHARMA_WEBHOOK_URL")) payload.webhook_url = optional("DOCPHARMA_WEBHOOK_URL");
  if (optional("DOCPHARMA_VENDOR_CODE")) payload.vendor_code = optional("DOCPHARMA_VENDOR_CODE");

  const problems = [];
  if (!name) problems.push("customer name is empty");
  if (payload.mobile_no.length !== 10) problems.push("mobile number is not 10 digits");
  if (!/^\d{6}$/.test(payload.zipcode)) problems.push("pincode is not 6 digits");
  if (!payload.address_1) problems.push("address line 1 is empty");
  if (!orderDetails.length) problems.push("no items in SUPER_SHEET_V1");
  if (orderDetails.some((i) => !i.sku_qty)) problems.push("an item has quantity 0");
  return { payload, problems };
}

export async function placeOrder(payload) {
  const base = setting("DOCPHARMA_BASE_URL").replace(/\/$/, "");
  const res = await fetch(`${base}/v2/place-order/`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": setting("DOCPHARMA_API_KEY") },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  const ok = res.ok && /success/i.test(body.status || "");
  return { ok, httpStatus: res.status, body };
}
