-- Run in the Supabase SQL editor. Nothing in Order_Level_V4 is changed.
--
-- orders_ready_for_hl_viable is a table of every order that has reached
-- status 'READY_FOR_HL' in Order_Level_V4. A trigger keeps it in sync:
--   * status becomes READY_FOR_HL      -> the order is inserted
--   * any later change to that order    -> its row here is updated, so
--                                          "status" always shows the
--                                          current Order_Level_V4 status
-- The dashboard writes the status it sent to Akidha into akidha_status.
-- The trigger only writes to this table, and if it ever fails the write to
-- Order_Level_V4 still goes through.

-- Clean up earlier versions (views, trigger and helper tables).
-- Old views are dropped only if they really are views, so a table with
-- either name is never touched and the script can be run again.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'orders_ready_for_3pl') THEN
        DROP VIEW public.orders_ready_for_3pl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'orders_ready_for_hl_viable') THEN
        DROP VIEW public.orders_ready_for_hl_viable;
    END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_threepl_order ON public."Order_Level_V4";
DROP FUNCTION IF EXISTS public.sync_threepl_order();
DROP TABLE IF EXISTS public.threepl_orders;
DROP TRIGGER IF EXISTS trg_track_hl_viable_order ON public."Order_Level_V4";
DROP FUNCTION IF EXISTS public.track_hl_viable_order();
DROP TABLE IF EXISTS public.hl_viable_orders;

CREATE TABLE IF NOT EXISTS public.orders_ready_for_hl_viable (
    "orderID"         text PRIMARY KEY,
    "ULID"            text,
    "orderDate"       timestamptz,
    "paymentMode"     text,
    "cxPhone"         text,
    cx_first_name     text,
    cx_last_name      text,
    cx_add_street_1   text,
    cx_add_street_2   text,
    city              text,
    state             text,
    pincode           text,
    status            text,          -- current status in Order_Level_V4
    hl_ready_at       timestamptz NOT NULL DEFAULT now(),
    akidha_status     text,          -- last status the dashboard sent to Akidha
    akidha_updated_at timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    "finalAmount"     numeric
);

-- Columns added after the table was first created.
ALTER TABLE public.orders_ready_for_hl_viable ADD COLUMN IF NOT EXISTS "finalAmount" numeric;

-- Only the service role key (used by the dashboard's server functions) can
-- read or write it.
ALTER TABLE public.orders_ready_for_hl_viable ENABLE ROW LEVEL SECURITY;

-- Turns orderDate into a timestamp, or NULL if it can't be read, so one odd
-- date never stops an order from being copied.
CREATE OR REPLACE FUNCTION public.hl_safe_timestamp(v text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN v::timestamptz;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- finalAmount -> number, or NULL if it can't be read (e.g. "₹950" or "").
CREATE OR REPLACE FUNCTION public.hl_safe_numeric(v text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN nullif(regexp_replace(v, '[^0-9.\-]', '', 'g'), '')::numeric;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_hl_viable_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Never let a problem here block the write to Order_Level_V4.
    BEGIN
        IF upper(NEW.status::text) = 'READY_FOR_HL' THEN
            INSERT INTO public.orders_ready_for_hl_viable (
                "orderID", "ULID", "orderDate", "paymentMode", "cxPhone",
                cx_first_name, cx_last_name, cx_add_street_1, cx_add_street_2,
                city, state, pincode, status, "finalAmount"
            )
            VALUES (
                NEW."orderID"::text, NEW."ULID"::text,
                public.hl_safe_timestamp(NEW."orderDate"::text),
                NEW."paymentMode"::text, NEW."cxPhone"::text,
                NEW.cx_first_name::text, NEW.cx_last_name::text,
                NEW.cx_add_street_1::text, NEW.cx_add_street_2::text,
                NEW.city::text, NEW.state::text, NEW."pinCode"::text,
                NEW.status::text,
                public.hl_safe_numeric(NEW."finalAmount"::text)
            )
            ON CONFLICT ("orderID") DO UPDATE SET
                "ULID"          = EXCLUDED."ULID",
                "orderDate"     = EXCLUDED."orderDate",
                "paymentMode"   = EXCLUDED."paymentMode",
                "cxPhone"       = EXCLUDED."cxPhone",
                cx_first_name   = EXCLUDED.cx_first_name,
                cx_last_name    = EXCLUDED.cx_last_name,
                cx_add_street_1 = EXCLUDED.cx_add_street_1,
                cx_add_street_2 = EXCLUDED.cx_add_street_2,
                city            = EXCLUDED.city,
                state           = EXCLUDED.state,
                pincode         = EXCLUDED.pincode,
                status          = EXCLUDED.status,
                "finalAmount"   = EXCLUDED."finalAmount",
                updated_at      = now();
        ELSE
            -- Only orders that already reached READY_FOR_HL are tracked.
            UPDATE public.orders_ready_for_hl_viable SET
                "ULID"          = NEW."ULID"::text,
                "orderDate"     = public.hl_safe_timestamp(NEW."orderDate"::text),
                "paymentMode"   = NEW."paymentMode"::text,
                "cxPhone"       = NEW."cxPhone"::text,
                cx_first_name   = NEW.cx_first_name::text,
                cx_last_name    = NEW.cx_last_name::text,
                cx_add_street_1 = NEW.cx_add_street_1::text,
                cx_add_street_2 = NEW.cx_add_street_2::text,
                city            = NEW.city::text,
                state           = NEW.state::text,
                pincode         = NEW."pinCode"::text,
                status          = NEW.status::text,
                "finalAmount"   = public.hl_safe_numeric(NEW."finalAmount"::text),
                updated_at      = now()
            WHERE "orderID" = NEW."orderID"::text;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync_hl_viable_order skipped order %: %', NEW."orderID", SQLERRM;
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_hl_viable_order ON public."Order_Level_V4";
CREATE TRIGGER trg_sync_hl_viable_order
AFTER INSERT OR UPDATE ON public."Order_Level_V4"
FOR EACH ROW EXECUTE FUNCTION public.sync_hl_viable_order();

-- Copy in the orders that are READY_FOR_HL right now.
INSERT INTO public.orders_ready_for_hl_viable (
    "orderID", "ULID", "orderDate", "paymentMode", "cxPhone",
    cx_first_name, cx_last_name, cx_add_street_1, cx_add_street_2,
    city, state, pincode, status, "finalAmount"
)
SELECT
    "orderID"::text, "ULID"::text, public.hl_safe_timestamp("orderDate"::text),
    "paymentMode"::text, "cxPhone"::text,
    cx_first_name::text, cx_last_name::text,
    cx_add_street_1::text, cx_add_street_2::text,
    city::text, state::text, "pinCode"::text, status::text,
    public.hl_safe_numeric("finalAmount"::text)
FROM public."Order_Level_V4"
WHERE upper(status::text) = 'READY_FOR_HL'
ON CONFLICT ("orderID") DO NOTHING;

-- Fill finalAmount for orders that were already in the table.
UPDATE public.orders_ready_for_hl_viable t
SET "finalAmount" = public.hl_safe_numeric(o."finalAmount"::text)
FROM public."Order_Level_V4" o
WHERE o."orderID"::text = t."orderID"
  AND t."finalAmount" IS NULL;
