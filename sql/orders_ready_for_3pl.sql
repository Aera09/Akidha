-- Run once in the Supabase SQL editor.

-- Tracks what we last pushed to Akidha. We don't overwrite "status" itself,
-- because the view below filters on status = 'ready_for_3pl' and the order
-- would vanish from the dashboard after the first update.
ALTER TABLE public."Order_Level_V4"
    ADD COLUMN IF NOT EXISTS akidha_status text,
    ADD COLUMN IF NOT EXISTS akidha_updated_at timestamptz;

-- CREATE OR REPLACE VIEW can only append columns, so drop first in case the
-- column order changed.
DROP VIEW IF EXISTS public.orders_ready_for_3pl;

CREATE VIEW public.orders_ready_for_3pl AS
SELECT
    "orderID",
    "orderDate",
    "paymentMode",
    "cxPhone",
    cx_first_name,
    cx_last_name,
    "ULID",
    status,
    akidha_status,
    akidha_updated_at
FROM
    public."Order_Level_V4"
WHERE
    status = 'ready_for_3pl';
