-- Run once in the Supabase SQL editor. Nothing in Order_Level_V4 is changed.
--
-- orders_ready_for_3pl is a live view over Order_Level_V4. It shows:
--   * every order whose status is 'ready_for_3pl', and
--   * every order the dashboard has already sent to Akidha, even after its
--     status in Order_Level_V4 moves on.
-- The status sent to Akidha is kept in the small threepl_status table.

-- Clean up the trigger-based version, if it was installed earlier.
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

-- DROP VIEW fails (and changes nothing) if orders_ready_for_3pl is a table.
DROP VIEW IF EXISTS public.orders_ready_for_3pl;

CREATE VIEW public.orders_ready_for_3pl
WITH (security_invoker = true) AS
SELECT
    o."orderID",
    o."orderDate",
    o."paymentMode",
    o."cxPhone",
    o.cx_first_name,
    o.cx_last_name,
    o."ULID",
    o.status,
    s.akidha_status,
    s.akidha_updated_at
FROM public."Order_Level_V4" o
LEFT JOIN public.threepl_status s ON s.order_id = o."orderID"::text
WHERE o.status = 'ready_for_3pl'
   OR s.order_id IS NOT NULL;
