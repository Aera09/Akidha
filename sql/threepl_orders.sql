-- Run once in the Supabase SQL editor.
--
-- threepl_orders holds every order that has reached ready_for_3pl.
-- A trigger on Order_Level_V4 keeps it in sync:
--   * status becomes 'ready_for_3pl'  -> the order is inserted (or refreshed)
--   * any later change to that order  -> its row here is updated
-- The dashboard writes the status it pushed to Akidha into akidha_status.

CREATE TABLE IF NOT EXISTS public.threepl_orders (
    order_id          text PRIMARY KEY,
    ulid              text,
    order_date        timestamptz,
    payment_mode      text,
    cx_phone          text,
    cx_first_name     text,
    cx_last_name      text,
    source_status     text,          -- current status in Order_Level_V4
    akidha_status     text,          -- last status the dashboard sent to Akidha
    akidha_updated_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Only the service role key (used by the dashboard's server functions) can
-- read or write this table; the public anon key gets nothing.
ALTER TABLE public.threepl_orders ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.sync_threepl_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'ready_for_3pl' THEN
        INSERT INTO public.threepl_orders (
            order_id, ulid, order_date, payment_mode, cx_phone,
            cx_first_name, cx_last_name, source_status
        )
        VALUES (
            NEW."orderID"::text, NEW."ULID"::text, NEW."orderDate"::timestamptz,
            NEW."paymentMode"::text, NEW."cxPhone"::text,
            NEW.cx_first_name::text, NEW.cx_last_name::text, NEW.status::text
        )
        ON CONFLICT (order_id) DO UPDATE SET
            ulid          = EXCLUDED.ulid,
            order_date    = EXCLUDED.order_date,
            payment_mode  = EXCLUDED.payment_mode,
            cx_phone      = EXCLUDED.cx_phone,
            cx_first_name = EXCLUDED.cx_first_name,
            cx_last_name  = EXCLUDED.cx_last_name,
            source_status = EXCLUDED.source_status,
            updated_at    = now();
    ELSE
        -- Only orders that already reached ready_for_3pl are tracked.
        UPDATE public.threepl_orders SET
            ulid          = NEW."ULID"::text,
            order_date    = NEW."orderDate"::timestamptz,
            payment_mode  = NEW."paymentMode"::text,
            cx_phone      = NEW."cxPhone"::text,
            cx_first_name = NEW.cx_first_name::text,
            cx_last_name  = NEW.cx_last_name::text,
            source_status = NEW.status::text,
            updated_at    = now()
        WHERE order_id = NEW."orderID"::text;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_threepl_order ON public."Order_Level_V4";
CREATE TRIGGER trg_sync_threepl_order
AFTER INSERT OR UPDATE ON public."Order_Level_V4"
FOR EACH ROW EXECUTE FUNCTION public.sync_threepl_order();

-- Copy in the orders that are already ready_for_3pl.
INSERT INTO public.threepl_orders (
    order_id, ulid, order_date, payment_mode, cx_phone,
    cx_first_name, cx_last_name, source_status
)
SELECT
    "orderID"::text, "ULID"::text, "orderDate"::timestamptz,
    "paymentMode"::text, "cxPhone"::text,
    cx_first_name::text, cx_last_name::text, status::text
FROM public."Order_Level_V4"
WHERE status = 'ready_for_3pl'
ON CONFLICT (order_id) DO NOTHING;
