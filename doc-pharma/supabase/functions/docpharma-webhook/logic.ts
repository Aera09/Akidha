// Pure logic for the DocPharma webhook: reading an event, deciding what it
// means for Akidha, and walking Akidha's status steps. No I/O here.

export type Fields = {
  dp_order_status: string | null;
  dp_suborder_status: string | null;
  dp_status_code: number | null;
  dp_logistic_status: string | null;
  dp_tracking_number: string | null;
  dp_tracking_url: string | null;
  dp_delivery_partner: string | null;
  dp_invoice_url: string | null;
  dp_status_reason: string | null;
};

const text = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

// Picks what we store from one webhook payload.
export function summarize(event: any): { partnerOrderId: string | null; fields: Fields } {
  const subs: any[] = Array.isArray(event?.suborders) ? event.suborders : [];
  // The suborder with the highest status code is the furthest along.
  const sub = subs.reduce(
    (best: any, s: any) => (best && Number(best.status_code) >= Number(s.status_code) ? best : s),
    null,
  ) || {};
  const log = sub.logistic_details || {};
  return {
    partnerOrderId: text(event?.partner_order_id ?? event?.partner_order_no),
    fields: {
      dp_order_status: text(event?.status),
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

// Details kept from earlier events when a later one leaves them out.
export const STICKY = ["dp_tracking_number", "dp_tracking_url", "dp_delivery_partner", "dp_invoice_url"];

// Once DocPharma reports one of these, a later non-final event (e.g. a delayed
// "reattempt") must not move the order back.
const FINAL = /^(delivered|cancel+ed|rto[-_ ]?delivered|returned)$/i;
export const isFinal = (f: Partial<Fields>) =>
  FINAL.test(f.dp_suborder_status || "") || FINAL.test(f.dp_order_status || "");

// The columns to write for this event, given what the row already has.
export function rowUpdate(current: Partial<Fields>, fields: Fields): Record<string, unknown> {
  let update = Object.fromEntries(
    Object.entries(fields).filter(([k, v]) => v !== null || !STICKY.includes(k)),
  );
  if (isFinal(current) && !isFinal(fields)) {
    update = Object.fromEntries(Object.entries(update).filter(([k]) => STICKY.includes(k)));
  }
  return update;
}

// ── DocPharma status -> Akidha OMS status ────────────────────────────────
// Edit this to change the mapping. Returns null when the event should not
// change anything in Akidha (e.g. invoiced, reattempt).
export function akidhaTarget(f: Partial<Fields>): string | null {
  const s = `${f.dp_suborder_status || ""} ${f.dp_order_status || ""}`.toLowerCase();
  const l = (f.dp_logistic_status || "").toUpperCase();
  if (/rto/.test(s) || l.includes("RTO")) {
    return /deliver|return/i.test(`${s} ${l}`) ? "RTO_DELIVERED" : "RTO_INITIATED";
  }
  if (/\bdelivered\b/.test(s) || l === "DELIVERED") return "COMPLETED";
  if (/out[-_ ]?for[-_ ]?delivery|\bofd\b/.test(s) || l === "OUT_FOR_DELIVERY" || l === "OFD") return "OUT_FOR_DELIVERY";
  if (/shipped|picked|dispatched|in[-_ ]?transit/.test(s) || /PICKED|SHIPPED|IN_TRANSIT|DISPATCHED/.test(l)) {
    return "SHIPMENT_PICKED_UP";
  }
  return null;
}

// Akidha statuses go one step at a time (same rule as the HL/Viable project,
// plus RTO straight after pickup).
export const AKIDHA_NEXT: Record<string, string[]> = {
  "": ["SHIPMENT_PICKED_UP"],
  SHIPMENT_PICKED_UP: ["OUT_FOR_DELIVERY", "RTO_INITIATED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "RTO_INITIATED"],
  RTO_INITIATED: ["RTO_DELIVERED"],
  COMPLETED: [],
  RTO_DELIVERED: [],
};

// The statuses to send to Akidha, in order, to get from `current` to `target`
// (e.g. "" -> COMPLETED = picked up, out for delivery, completed). Empty when
// already there or when the target is behind/unreachable.
export function akidhaSteps(current: string | null, target: string | null): string[] {
  if (!target) return [];
  const start = current || "";
  if (start === target) return [];
  const queue: string[][] = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift()!;
    for (const next of AKIDHA_NEXT[path[path.length - 1]] ?? []) {
      if (seen.has(next)) continue;
      if (next === target) return [...path.slice(1), next];
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return [];
}
