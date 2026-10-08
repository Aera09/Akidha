# DocPharma integration

Places Akidha orders with DocPharma through the DocPharma Partner API
(`POST {baseUrl}/v2/place-order/`, `x-api-key` header), takes DocPharma's
status updates through a Supabase Edge Function, and pushes the matching
status to Akidha OMS.

```
Order_Level_V4 (status = READY_FOR_DOCPHARMA)
   │  trigger
   ▼
doc_pharma.orders  (+ SUPER_SHEET_V1 for items)
   │  dashboard: Preview → Place Order
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

Open `sql/doc_pharma_schema.sql`, change `'READY_FOR_DOCPHARMA'` (two places)
to the `Order_Level_V4` status that means "send to DocPharma", and run it in
the Supabase SQL editor. It creates the `doc_pharma` schema with
`doc_pharma.orders` and `doc_pharma.webhook_logs`, and a trigger on
`Order_Level_V4` that only reads it. It does not change `Order_Level_V4` or
the HL/Viable table. Running it again is safe.

Then **Project Settings → API → Exposed schemas**: add `doc_pharma` and save.
The dashboard and the edge function read the schema through the API.

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
| `payment_mode_order` | `COD` for COD/POD/cash, otherwise `Prepaid` |
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

Every webhook call is stored in `doc_pharma.webhook_logs` with what was sent
to Akidha (`akidha_result`). The dashboard shows the DocPharma status, courier,
Track / Invoice links, and the Akidha status or error.
