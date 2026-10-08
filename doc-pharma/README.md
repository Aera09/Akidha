# DocPharma integration

Places Akidha orders with DocPharma through the DocPharma Partner API
(`POST {baseUrl}/v2/place-order/`, `x-api-key` header), takes DocPharma's
status updates through a Supabase Edge Function, and pushes the matching
status to Akidha OMS.

```
Order_Level_V4 (status = READY_FOR_3PL)
   │  trigger
   ▼
doc_pharma.orders  (+ SUPER_SHEET_V1 for items)
   │  dashboard: Preview → Place Order
   ▼
DocPharma inventory-availability/v2 ── every SKU in stock? no → not placed
   │  yes
   ▼
DocPharma place-order ── fh_order_id / order_number saved on the row
   │  webhook (shipped, out for delivery, delivered, RTO …)
   ▼
Edge Function docpharma-webhook
   ├─ updates doc_pharma.orders, logs to doc_pharma.webhook_logs
   └─ Akidha OMS  PUT /orders/{ULID}/status/{STATUS}, one step at a time
```

Separate project from the HL/Viable dashboard in the repository root: its own
`.env`, its own Netlify site (base directory `doc-pharma`), port 8889 locally.

## 1. Supabase: schema and table

Run `sql/doc_pharma_schema.sql` in the Supabase SQL editor. As soon as an
`Order_Level_V4` order gets status `READY_FOR_3PL` it is copied into
`doc_pharma.orders`, and after that it keeps following V4 (status, address,
amount), like `orders_ready_for_hl_viable` does for `READY_FOR_HL`. It creates the `doc_pharma` schema with
`doc_pharma.orders` and `doc_pharma.webhook_logs`, and a trigger on
`Order_Level_V4` that only reads it. It does not change `Order_Level_V4` or
the HL/Viable table. Running it again is safe.

Then expose `doc_pharma` to the API (the dashboard and the edge function read
it through the API). In this project the list is set on the `authenticator`
role, which overrides **Project Settings → API → Exposed schemas**, so add it
there with SQL, keeping the schemas already listed:

```sql
select rolconfig from pg_roles where rolname = 'authenticator';   -- current list
ALTER ROLE authenticator
SET pgrst.db_schemas = 'public, myrx, myrx_production, inventory, doc_pharma';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
```

## 2. Supabase: edge function (webhook)

```bash
cd doc-pharma
supabase login
supabase link --project-ref <project-ref>
supabase secrets set DOCPHARMA_WEBHOOK_SECRET=<long random text> \
  AKIDHA_ENV=STAGE \
  AKIDHA_BASE_URL_STAGE=https://stageapi.akidha.in AKIDHA_EMAIL_STAGE=... AKIDHA_PASSWORD_STAGE=... \
  AKIDHA_BASE_URL_PROD=https://api.akidha.in AKIDHA_EMAIL_PROD=... AKIDHA_PASSWORD_PROD=...
supabase functions deploy docpharma-webhook --no-verify-jwt
```

(Without the CLI: Supabase → Edge Functions → Deploy a new function, name
`docpharma-webhook`, paste `index.ts` and `logic.ts`, turn off "Verify JWT",
and add the same secrets under Edge Functions → Secrets.)

`--no-verify-jwt` is needed because DocPharma does not send a Supabase key;
the function checks `?token=` against `DOCPHARMA_WEBHOOK_SECRET` instead and
answers 401 otherwise.

## 3. Run the dashboard locally

```bash
cd doc-pharma
cp .env.example .env      # Supabase key, DocPharma API key, same DOCPHARMA_WEBHOOK_SECRET
npm start                 # http://localhost:8889
```

`DOCPHARMA_ENV=DEV` uses `https://partner-api.dev.docpharma.in`; set it to
`PROD` for `https://partner-api.docpharma.in`. Restart after changing `.env`.

With `DOCPHARMA_WEBHOOK_SECRET` set, every order placed sends DocPharma
`webhook_url = SUPABASE_URL/functions/v1/docpharma-webhook?token=...`. Orders
placed before that won't send updates. Because the webhook runs on Supabase,
it works even while the dashboard runs on localhost.

## How an order is mapped

| DocPharma field | From |
|---|---|
| `partner_order_id`, `partner_order_no` | `orderID` |
| `customer_name`, `patient_name` | `cx_first_name` + `cx_last_name` |
| `mobile_no` | last 10 digits of `cxPhone` |
| `address_1`, `address_2`, `city`, `state`, `zipcode` | address columns, `pincode` |
| `payment_mode_order` | `payment_type`: `COD` for COD/POD/cash, otherwise `Prepaid` |
| `payment_status` | `1` for COD, `10` for Prepaid |
| `amount`, `collectible` | `finalAmount` (collectible is 0 for Prepaid) |
| `order_details[]` | `SUPER_SHEET_V1`: `skuCode`, `medicineName`, `itemQty`, `itemMRP`; `discount_amount` = (MRP − `itemDiscountedPrice`) × qty |
| `shipping_charges` | `SUPER_SHEET_V1.shippingCost` |
| `order_type` | `SDD_NDD` (can be overridden with `DOCPHARMA_ORDER_TYPE_<ENV>`) |
| `webhook_url` | the edge function URL above, when `DOCPHARMA_WEBHOOK_SECRET` is set |
| `vendor_code` | `DOCPHARMA_VENDOR_CODE` if set |

Preview shows the exact JSON before anything is sent. An order is not sent if
the name, 10-digit mobile, 6-digit pincode, address or items are missing, and
an order already placed cannot be placed again.

Prepaid and COD orders go to the same endpoint (`/v2/place-order/`); only the
body differs (`payment_mode_order`, `payment_status` 10 or 1, `collectible`).
`doc_pharma.orders.payment_type` (`COD` or `PREPAID`) is worked out by
Supabase from `paymentMode` and updates with it. An empty `paymentMode` counts
as `PREPAID`.

### Stock check

Before placing, the dashboard asks DocPharma
(`POST /inventory-availability/v2` with the pincode, `service_type` = order
type and every SKU with its quantity) whether each SKU is available in the
needed quantity. The order is placed only when every SKU is; a SKU DocPharma
doesn't return counts as not available. Preview shows the result per SKU, and
Place Order stays disabled until it is all in stock. Place Order checks again
just before sending. The result is saved on the order: `stock_status`
(`IN_STOCK`, `OUT_OF_STOCK`, `CHECK_FAILED`), `stock_checked_at`,
`stock_detail`.

## DocPharma status → Akidha OMS

| DocPharma reports | Akidha status |
|---|---|
| invoiced, reattempt, anything else | no change |
| shipped / picked / dispatched / in transit | `SHIPMENT_PICKED_UP` |
| out for delivery | `OUT_FOR_DELIVERY` |
| delivered | `COMPLETED` |
| RTO | `RTO_INITIATED` |
| RTO delivered / returned | `RTO_DELIVERED` |

Akidha moves one step at a time, so missing steps are sent in order (e.g. a
first "delivered" sends picked up → out for delivery → completed). If Akidha
refuses a step, the order keeps the last accepted status in `akidha_status`
and the reason in `akidha_error`. A late event (e.g. reattempt after
delivered) never moves an order back. To change the mapping, edit
`akidhaTarget` in `supabase/functions/docpharma-webhook/logic.ts` and deploy
again.

### Manual Akidha update (admin)

The dashboard's **Akidha OMS** column has a dropdown to send the next status
by hand (same steps as the edge function, one at a time, with a confirm box).
It needs the Akidha settings in the dashboard's `.env` too: `AKIDHA_ENV` and
`AKIDHA_BASE_URL_*`, `AKIDHA_EMAIL_*`, `AKIDHA_PASSWORD_*` (same values as the
edge function secrets). The edge function continues from whatever status was
set by hand and never moves an order back.

`doc_pharma.orders.current_status` / `current_status_at` hold the latest
DocPharma status of each order and when it arrived. Every webhook call is also
stored in `doc_pharma.webhook_logs` with its time (`received_at`), status
(`current_status`) and what was sent to Akidha (`akidha_result`), so the full
history of an order is:

```sql
select received_at, current_status, akidha_result
from doc_pharma.webhook_logs
where partner_order_id = 'OR_123'
order by received_at;
```
 The dashboard shows the DocPharma status, courier,
Track / Invoice links, and the Akidha status or error.
