-- DocPharma integration, all in its own schema: doc_pharma.
-- Run in the Supabase SQL editor. Safe to run again.
-- Nothing in public."Order_Level_V4" is changed: the trigger only reads it.
--
--   doc_pharma.orders        one row per order: order details, stock check, what
--                            DocPharma returned and reported, and the Akidha status
--                            current_status / current_status_at = latest DocPharma status
--   doc_pharma.webhook_logs  every webhook call from DocPharma with its time
--                            (status history: order_123 invoiced, shipped, delivered ...)
--
-- All times are stored in IST (Asia/Kolkata) as plain timestamps, so Supabase
-- shows them exactly as Indian time.
--
-- Trigger: as soon as an Order_Level_V4 row gets status READY_FOR_3PL it is
-- copied here, and after that it keeps following V4 (status, address, ...),
-- the same way orders_ready_for_hl_viable follows READY_FOR_HL.
--
-- After running: Supabase -> Project Settings -> API -> Exposed schemas,
-- add doc_pharma (the dashboard and edge function read it through the API).

CREATE SCHEMA IF NOT EXISTS doc_pharma;

-- Only the service role key (dashboard server functions and the edge function)
-- uses this schema.
GRANT USAGE ON SCHEMA doc_pharma TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA doc_pharma GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA doc_pharma GRANT ALL ON SEQUENCES TO service_role;

-- Current time in IST.
CREATE OR REPLACE FUNCTION doc_pharma.ist_now()
RETURNS timestamp LANGUAGE sql STABLE AS $$
    SELECT (now() AT TIME ZONE 'Asia/Kolkata')::timestamp(0);
$$;

-- Text -> IST timestamp. A value with a time zone (e.g. ...Z or +00) is
-- converted to IST; a value without one is taken as IST already.
-- Anything unreadable becomes NULL instead of an error.
CREATE OR REPLACE FUNCTION doc_pharma.safe_timestamp(v text)
RETURNS timestamp LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF v ~ '(Z|[+-]\d{2}(:?\d{2})?)$' THEN
        RETURN (v::timestamptz AT TIME ZONE 'Asia/Kolkata')::timestamp(0);
    END IF;
    RETURN v::timestamp(0);
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION doc_pharma.safe_numeric(v text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN nullif(regexp_replace(v, '[^0-9.\-]', '', 'g'), '')::numeric;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS doc_pharma.orders (
    "orderID"           text PRIMARY KEY,
    "ULID"              text,
    "orderDate"         timestamp(0),    -- IST
    "paymentMode"       text,
    "cxPhone"           text,
    cx_first_name       text,
    cx_last_name        text,
    cx_add_street_1     text,
    cx_add_street_2     text,
    city                text,
    state               text,
    pincode             text,
    "finalAmount"       numeric,
    payment_type        text GENERATED ALWAYS AS (
                            CASE WHEN "paymentMode" ~* '(^|[^a-z])(cod|pod)([^a-z]|$)|cash|pay on delivery'
                                 THEN 'COD' ELSE 'PREPAID' END) STORED,   -- COD or PREPAID (online)
    status              text,            -- current status in Order_Level_V4
    queued_at           timestamp(0) NOT NULL DEFAULT doc_pharma.ist_now(),

    -- Stock check (dashboard -> DocPharma inventory-availability/v2)
    stock_status        text,            -- IN_STOCK, OUT_OF_STOCK or CHECK_FAILED
    stock_checked_at    timestamp(0),
    stock_detail        jsonb,           -- per SKU: need, available; reason; eta

    -- Place order (dashboard -> DocPharma), only when IN_STOCK
    dp_status           text,            -- PLACED or FAILED
    dp_fh_order_id      text,            -- data.fh_order_id
    dp_order_number     text,            -- order_number
    dp_error            text,
    dp_response         jsonb,
    dp_placed_at        timestamp(0),

    -- Status updates (DocPharma webhook -> edge function)
    current_status      text,            -- latest DocPharma status of this order
    current_status_at   timestamp(0),    -- when that status arrived
    dp_order_status     text,            -- top-level status, e.g. in-progress, delivered
    dp_suborder_status  text,            -- e.g. invoiced, shipped, reattempt, delivered
    dp_status_code      integer,
    dp_logistic_status  text,            -- logistic_details.current_status
    dp_tracking_number  text,
    dp_tracking_url     text,
    dp_delivery_partner text,
    dp_invoice_url      text,
    dp_status_reason    text,
    dp_last_event       jsonb,
    dp_last_event_at    timestamp(0),

    -- Akidha OMS (edge function -> Akidha)
    akidha_status       text,            -- last status Akidha accepted
    akidha_updated_at   timestamp(0),
    akidha_error        text,

    updated_at          timestamp(0) NOT NULL DEFAULT doc_pharma.ist_now()
);

CREATE TABLE IF NOT EXISTS doc_pharma.webhook_logs (
    id               bigserial PRIMARY KEY,
    received_at      timestamp(0) NOT NULL DEFAULT doc_pharma.ist_now(),   -- IST
    partner_order_id text,
    current_status   text,                             -- status in this event
    order_status     text,
    suborder_status  text,
    status_code      integer,
    matched          boolean NOT NULL DEFAULT false,   -- found in doc_pharma.orders?
    akidha_result    text,                             -- what was sent to Akidha, or why not
    payload          jsonb
);
CREATE INDEX IF NOT EXISTS webhook_logs_order_idx ON doc_pharma.webhook_logs (partner_order_id, received_at DESC);

GRANT ALL ON ALL TABLES IN SCHEMA doc_pharma TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA doc_pharma TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA doc_pharma TO service_role;
ALTER TABLE doc_pharma.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_pharma.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION doc_pharma.sync_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = doc_pharma, public
AS $$
BEGIN
    -- Never let a problem here block the write to Order_Level_V4.
    BEGIN
        IF upper(NEW.status::text) = 'READY_FOR_3PL' THEN
            INSERT INTO doc_pharma.orders (
                "orderID", "ULID", "orderDate", "paymentMode", "cxPhone",
                cx_first_name, cx_last_name, cx_add_street_1, cx_add_street_2,
                city, state, pincode, "finalAmount", status
            )
            VALUES (
                NEW."orderID"::text, NEW."ULID"::text,
                doc_pharma.safe_timestamp(NEW."orderDate"::text),
                NEW."paymentMode"::text, NEW."cxPhone"::text,
                NEW.cx_first_name::text, NEW.cx_last_name::text,
                NEW.cx_add_street_1::text, NEW.cx_add_street_2::text,
                NEW.city::text, NEW.state::text, NEW."pinCode"::text,
                doc_pharma.safe_numeric(NEW."finalAmount"::text),
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
                updated_at      = doc_pharma.ist_now();
        ELSE
            -- Only orders that already reached the trigger status are tracked.
            UPDATE doc_pharma.orders SET
                "ULID"          = NEW."ULID"::text,
                "orderDate"     = doc_pharma.safe_timestamp(NEW."orderDate"::text),
                "paymentMode"   = NEW."paymentMode"::text,
                "cxPhone"       = NEW."cxPhone"::text,
                cx_first_name   = NEW.cx_first_name::text,
                cx_last_name    = NEW.cx_last_name::text,
                cx_add_street_1 = NEW.cx_add_street_1::text,
                cx_add_street_2 = NEW.cx_add_street_2::text,
                city            = NEW.city::text,
                state           = NEW.state::text,
                pincode         = NEW."pinCode"::text,
                "finalAmount"   = doc_pharma.safe_numeric(NEW."finalAmount"::text),
                status          = NEW.status::text,
                updated_at      = doc_pharma.ist_now()
            WHERE "orderID" = NEW."orderID"::text;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'doc_pharma.sync_order skipped order %: %', NEW."orderID", SQLERRM;
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doc_pharma_sync_order ON public."Order_Level_V4";
CREATE TRIGGER trg_doc_pharma_sync_order
AFTER INSERT OR UPDATE ON public."Order_Level_V4"
FOR EACH ROW EXECUTE FUNCTION doc_pharma.sync_order();

-- Copy in the orders that already have the trigger status.
INSERT INTO doc_pharma.orders (
    "orderID", "ULID", "orderDate", "paymentMode", "cxPhone",
    cx_first_name, cx_last_name, cx_add_street_1, cx_add_street_2,
    city, state, pincode, "finalAmount", status
)
SELECT
    "orderID"::text, "ULID"::text, doc_pharma.safe_timestamp("orderDate"::text),
    "paymentMode"::text, "cxPhone"::text,
    cx_first_name::text, cx_last_name::text,
    cx_add_street_1::text, cx_add_street_2::text,
    city::text, state::text, "pinCode"::text,
    doc_pharma.safe_numeric("finalAmount"::text), status::text
FROM public."Order_Level_V4"
WHERE upper(status::text) = 'READY_FOR_3PL'
ON CONFLICT ("orderID") DO NOTHING;
