-- Run in the Supabase SQL editor after docpharma_orders.sql. Safe to run again.
-- Adds what the DocPharma webhook needs. Existing rows are not changed; only
-- new, empty columns are added.

-- Latest status from DocPharma, shown on the dashboard.
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_order_status    text;        -- top-level "status", e.g. in-progress, delivered
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_suborder_status text;        -- suborders[].status, e.g. invoiced, shipped, reattempt
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_status_code     integer;     -- suborders[].status_code
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_logistic_status text;        -- logistic_details.current_status
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_tracking_number text;
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_tracking_url    text;
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_delivery_partner text;
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_invoice_url     text;
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_status_reason   text;        -- e.g. "Customer not reachable"
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_last_event      jsonb;
ALTER TABLE public.docpharma_orders ADD COLUMN IF NOT EXISTS dp_last_event_at   timestamptz;

-- Every webhook call, as received (like webhook_logs in mx-inbound).
CREATE TABLE IF NOT EXISTS public.docpharma_webhook_logs (
    id               bigserial PRIMARY KEY,
    received_at      timestamptz NOT NULL DEFAULT now(),
    partner_order_id text,
    order_status     text,
    suborder_status  text,
    status_code      integer,
    matched          boolean NOT NULL DEFAULT false,   -- found in docpharma_orders?
    payload          jsonb
);
CREATE INDEX IF NOT EXISTS docpharma_webhook_logs_order_idx
    ON public.docpharma_webhook_logs (partner_order_id, received_at DESC);

ALTER TABLE public.docpharma_webhook_logs ENABLE ROW LEVEL SECURITY;
