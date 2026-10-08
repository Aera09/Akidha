import { timingSafeEqual } from "node:crypto";
import { json } from "../lib/http.mjs";
import { fetchOrder, logWebhook, recordPlacement } from "../lib/supabase.mjs";

// DocPharma posts order updates here (invoiced, shipped, reattempt,
// delivered, ...). The URL carries ?token=DOCPHARMA_WEBHOOK_SECRET because
// DocPharma does not sign its calls.
function tokenOk(req) {
  const secret = (process.env.DOCPHARMA_WEBHOOK_SECRET || "").trim();
  if (!secret) return false;
  const given = Buffer.from(new URL(req.url).searchParams.get("token") || "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Once an order is in one of these states, a later non-final event (e.g. a
// delayed "reattempt") must not move it back.
const FINAL = /^(delivered|cancel+ed|rto[-_ ]?delivered|returned)$/i;
const isFinal = (fields) => FINAL.test(fields.dp_suborder_status || "") || FINAL.test(fields.dp_order_status || "");

const text = (v) => (v === null || v === undefined || v === "" ? null : String(v));

// Picks what the dashboard shows from one webhook payload.
export function summarize(event) {
  const subs = Array.isArray(event.suborders) ? event.suborders : [];
  // The suborder with the highest status code is the furthest along.
  const sub = subs.reduce((best, s) => (best && Number(best.status_code) >= Number(s.status_code) ? best : s), null) || {};
  const log = sub.logistic_details || {};
  return {
    partnerOrderId: text(event.partner_order_id ?? event.partner_order_no),
    fields: {
      dp_order_status: text(event.status),
      dp_suborder_status: text(sub.status),
      dp_status_code: sub.status_code == null || isNaN(Number(sub.status_code)) ? null : Number(sub.status_code),
      dp_logistic_status: text(log.current_status),
      dp_tracking_number: text(log.tracking_number),
      dp_tracking_url: text(log.tracking_url),
      dp_delivery_partner: text(log.delivery_partner_name),
      dp_invoice_url: text(sub.invoice_url),
      dp_status_reason: text(log.reason ?? sub.display_reason ?? sub.reason),
    },
  };
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  if (!tokenOk(req)) return json(401, { error: "Invalid webhook token" });

  let event;
  try {
    event = await req.json();
  } catch {
    return json(400, { error: "Body must be JSON" });
  }

  const { partnerOrderId, fields } = summarize(event);
  try {
    const order = partnerOrderId ? await fetchOrder(partnerOrderId) : null;
    await logWebhook({
      partner_order_id: partnerOrderId,
      order_status: fields.dp_order_status,
      suborder_status: fields.dp_suborder_status,
      status_code: fields.dp_status_code,
      matched: Boolean(order),
      payload: event,
    });
    if (!order) return json(200, { received: true, matched: false });

    // Status fields always take the latest event's values; tracking, invoice
    // and courier details are kept when a later event leaves them out.
    const sticky = ["dp_tracking_number", "dp_tracking_url", "dp_delivery_partner", "dp_invoice_url"];
    let update = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== null || !sticky.includes(k)));
    if (isFinal(order) && !isFinal(fields)) {
      // Keep the final status; only fill in tracking/invoice details.
      update = Object.fromEntries(Object.entries(update).filter(([k]) => sticky.includes(k)));
    }
    await recordPlacement(order.orderID, {
      ...update,
      dp_last_event: event,
      dp_last_event_at: new Date().toISOString(),
    });
    return json(200, { received: true, matched: true });
  } catch (err) {
    console.error(err);
    // 500 so DocPharma retries if it does that.
    return json(500, { error: err.message });
  }
};

export const config = { path: "/api/docpharma-webhook" };
