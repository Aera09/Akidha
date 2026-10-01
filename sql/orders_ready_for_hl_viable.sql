-- Run in the Supabase SQL editor. Nothing in Order_Level_V4 is changed.
--
-- orders_ready_for_hl_viable is a live view over Order_Level_V4. Once an
-- order's status has been 'ready_for_3pl', it stays in the view and shows
-- whatever its status in Order_Level_V4 is now.
--
-- A view can't remember past statuses, so hl_viable_orders records the
-- orders that reached ready_for_3pl. A trigger adds them; it only writes to
-- hl_viable_orders, and if it ever fails the write to Order_Level_V4 still
-- goes through.

-- Clean up earlier versions.
DROP VIEW IF EXISTS public.orders_ready_for_3pl;
DROP TRIGGER IF EXISTS trg_sync_threepl_order ON public."Order_Level_V4";
DROP FUNCTION IF EXISTS public.sync_threepl_order();
DROP TABLE IF EXISTS public.threepl_orders;

-- Orders that have reached ready_for_3pl at least once.
CREATE TABLE IF NOT EXISTS public.hl_viable_orders (
    order_id  text PRIMARY KEY,
    ready_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hl_viable_orders ENABLE ROW LEVEL SECURITY;

-- Last status the dashboard sent to Akidha, per order.
CREATE TABLE IF NOT EXISTS public.threepl_status (
    order_id          text PRIMARY KEY,
    akidha_status     text NOT NULL,
    akidha_updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.threepl_status ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.track_hl_viable_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'ready_for_3pl' THEN
        BEGIN
            INSERT INTO public.hl_viable_orders (order_id)
            VALUES (NEW."orderID"::text)
            ON CONFLICT (order_id) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'track_hl_viable_order skipped order %: %', NEW."orderID", SQLERRM;
        END;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_hl_viable_order ON public."Order_Level_V4";
CREATE TRIGGER trg_track_hl_viable_order
AFTER INSERT OR UPDATE OF status ON public."Order_Level_V4"
FOR EACH ROW EXECUTE FUNCTION public.track_hl_viable_order();

-- Record the orders that are ready_for_3pl now, plus any already sent to
-- Akidha from the dashboard.
INSERT INTO public.hl_viable_orders (order_id)
SELECT "orderID"::text FROM public."Order_Level_V4" WHERE status = 'ready_for_3pl'
UNION
SELECT order_id FROM public.threepl_status
ON CONFLICT (order_id) DO NOTHING;

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
    h.ready_at,
    s.akidha_status,
    s.akidha_updated_at
FROM public.hl_viable_orders h
JOIN public."Order_Level_V4" o ON o."orderID"::text = h.order_id
LEFT JOIN public.threepl_status s ON s.order_id = h.order_id;
