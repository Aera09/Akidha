import { checkStock } from "./docpharma.mjs";
import { updateOrder } from "./supabase.mjs";
import { istNow } from "./http.mjs";

// Checks DocPharma stock for an order's payload and saves the result on the row.
export async function checkAndRecordStock(orderID, payload) {
  let stock;
  try {
    stock = await checkStock(payload);
  } catch (err) {
    // e.g. DocPharma unreachable: treat as not checked, so nothing is placed.
    stock = { inStock: false, stock_status: "CHECK_FAILED", reason: `Stock check failed: ${err.message}`, lines: [] };
  }
  await updateOrder(orderID, {
    stock_status: stock.stock_status,
    stock_checked_at: istNow(),
    stock_detail: { reason: stock.reason, lines: stock.lines, eta: stock.eta ?? null, response: stock.response ?? null },
  });
  return stock;
}
