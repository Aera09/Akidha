-- Run in the Supabase SQL editor. Nothing in Order_Level_V4 is changed.
-- Safe to run again.
--
-- docpharma_orders holds the orders to be placed with DocPharma. A trigger on
-- Order_Level_V4 keeps it in sync:
--   * status becomes the trigger status below -> the order is inserted
--   * any later change to that order          -> its row here is updated
-- The dashboard stores what DocPharma returned in the dp_* columns.
-- The trigger only writes to this table, and if it ever fails the write to
-- Order_Level_V4 still goes through.
--
-- >>> Trigger status: change 'READY_FOR_DOCPHARMA' (two places below) to the
-- >>> Order_Level_V4 status that means "send this order to DocPharma".

CREATE TABLE IF NOT EXISTS public.docpharma_orders (
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
    "finalAmount"     numeric,
    status            text,          -- current status in Order_Level_V4
    queued_at         timestamptz NOT NULL DEFAULT now(),
    -- Filled in by the dashboard after calling DocPharma place-order:
    dp_status         text,          -- PLACED or FAILED
    dp_fh_order_id    text,          -- data.fh_order_id
    dp_order_number   text,          -- order_number
    dp_error          text,
    dp_response       jsonb,
    dp_placed_at      timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Only the service role key (used by the dashboard's server functions) can
-- read or write it.
ALTER TABLE public.docpharma_orders ENABLE ROW LEVEL SECURITY;

-- Same helpers as the HL/Viable project (CREATE OR REPLACE keeps them identical).
CREATE OR REPLACE FUNCTION public.hl_safe_timestamp(v text)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN v::timestamptz;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.hl_safe_numeric(v text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN nullif(regexp_replace(v, '[^0-9.\-]', '', 'g'), '')::numeric;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_docpharma_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Never let a problem here block the write to Order_Level_V4.
    BEGIN
        IF upper(NEW.status::text) = 'READY_FOR_DOCPHARMA' THEN
            INSERT INTO public.docpharma_orders (
                "orderID", "ULID", "orderDate", "paymentMode", "cxPhone",
                cx_first_name, cx_last_name, cx_add_street_1, cx_add_street_2,
                city, state, pincode, "finalAmount", status
            )
            VALUES (
                NEW."orderID"::text, NEW."ULID"::text,
                public.hl_safe_timestamp(NEW."orderDate"::text),
                NEW."paymentMode"::text, NEW."cxPhone"::text,
                NEW.cx_first_name::text, NEW.cx_last_name::text,
                NEW.cx_add_street_1::text, NEW.cx_add_street_2::text,
                NEW.city::text, NEW.state::text, NEW."pinCode"::text,
                public.hl_safe_numeric(NEW."finalAmount"::text),
                NEW.status::text
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
                "finalAmount"   = EXCLUDED."finalAmount",
                status          = EXCLUDED.status,
                updated_at      = now();
        ELSE
            -- Only orders that already reached the trigger status are tracked.
            UPDATE public.docpharma_orders SET
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
                "finalAmount"   = public.hl_safe_numeric(NEW."finalAmount"::text),
                status          = NEW.status::text,
                updated_at      = now()
            WHERE "orderID" = NEW."orderID"::text;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync_docpharma_order skipped order %: %', NEW."orderID", SQLERRM;
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_docpharma_order ON public."Order_Level_V4";
CREATE TRIGGER trg_sync_docpharma_order
AFTER INSERT OR UPDATE ON public."Order_Level_V4"
FOR EACH ROW EXECUTE FUNCTION public.sync_docpharma_order();

-- Copy in the orders that already have the trigger status.
INSERT INTO public.docpharma_orders (
    "orderID", "ULID", "orderDate", "paymentMode", "cxPhone",
    cx_first_name, cx_last_name, cx_add_street_1, cx_add_street_2,
    city, state, pincode, "finalAmount", status
)
SELECT
    "orderID"::text, "ULID"::text, public.hl_safe_timestamp("orderDate"::text),
    "paymentMode"::text, "cxPhone"::text,
    cx_first_name::text, cx_last_name::text,
    cx_add_street_1::text, cx_add_street_2::text,
    city::text, state::text, "pinCode"::text,
    public.hl_safe_numeric("finalAmount"::text), status::text
FROM public."Order_Level_V4"
WHERE upper(status::text) = 'READY_FOR_DOCPHARMA'
ON CONFLICT ("orderID") DO NOTHING;
