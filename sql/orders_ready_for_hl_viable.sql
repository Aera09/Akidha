-- Run in the Supabase SQL editor. Nothing in Order_Level_V4 is changed.
--
-- orders_ready_for_hl_viable is a live view over Order_Level_V4. An order shows up
-- as soon as its status is 'ready_for_3pl' and stays while its status moves
-- through the later 3PL statuses listed below. It also stays once the
-- dashboard has sent it to Akidha (kept in threepl_status).
--
-- Edit the status list to match the values your Order_Level_V4 really uses:
--   SELECT DISTINCT status FROM public."Order_Level_V4" ORDER BY 1;

-- Clean up earlier versions: the old view name and the trigger-based table.
DROP VIEW IF EXISTS public.orders_ready_for_3pl;
DROP TRIGGER IF EXISTS trg_sync_threepl_order ON public."Order_Level_V4";
DROP FUNCTION IF EXISTS public.sync_threepl_order();
DROP TABLE IF EXISTS public.threepl_orders;

CREATE TABLE IF NOT EXISTS public.threepl_status (
    order_id          text PRIMARY KEY,
    akidha_status     text NOT NULL,
    akidha_updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only the service role key (used by the dashboard's server functions) can
-- read or write it.
ALTER TABLE public.threepl_status ENABLE ROW LEVEL SECURITY;

-- DROP VIEW fails (and changes nothing) if orders_ready_for_hl_viable is a table.
DROP VIEW IF EXISTS public.orders_ready_for_hl_viable;

CREATE VIEW public.orders_ready_for_hl_viable
WITH (security_invoker = true) AS
SELECT
    o."orderID",
    o."orderDate",
    o."paymentMode",
    o."cxPhone",
    o.cx_first_name,
    o.cx_last_name,
    o."ULID",
    o.cx_add_street_1,
    o.cx_add_street_2,
    o.city,
    o.state,
    o.pincode,
    o.status,
    s.akidha_status,
    s.akidha_updated_at
FROM public."Order_Level_V4" o
LEFT JOIN public.threepl_status s ON s.order_id = o."orderID"::text
WHERE lower(o.status) IN (
        'ready_for_3pl',
        'shipment_picked_up',
        'out_for_delivery',
        'completed',
        'rto_initiated',
        'rto_delivered'
      )
   OR s.order_id IS NOT NULL;
