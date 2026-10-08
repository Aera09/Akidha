# DocPharma integration

Places Akidha orders with DocPharma through the DocPharma Partner API
(`POST {baseUrl}/v2/place-order/`, `x-api-key` header).

```
Order_Level_V4 (status = READY_FOR_DOCPHARMA)
   │  trigger
   ▼
docpharma_orders (Supabase)  +  SUPER_SHEET_V1 (items)
   │  dashboard: Preview → Place Order
   ▼
DocPharma place-order  →  fh_order_id / order_number saved back on the row
```

Separate project from the HL/Viable dashboard in the repository root: its own
`.env`, its own Netlify site (base directory `doc-pharma`), port 8889 locally.

## 1. Supabase

Open `sql/docpharma_orders.sql`, change `'READY_FOR_DOCPHARMA'` (two places) to
the `Order_Level_V4` status that means "send to DocPharma", and run it once in
the Supabase SQL editor. It does not change `Order_Level_V4` and does not
touch the HL/Viable table or trigger. Running it again is safe.

## 2. Run locally

```bash
cd doc-pharma
cp .env.example .env      # fill in Supabase key and DocPharma API key
npm start                 # http://localhost:8889
```

`DOCPHARMA_ENV=DEV` uses `https://partner-api.dev.docpharma.in`; set it to
`PROD` for `https://partner-api.docpharma.in`. Restart after changing `.env`.

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
| `webhook_url` | `DOCPHARMA_PUBLIC_URL/api/docpharma-webhook?token=DOCPHARMA_WEBHOOK_SECRET`, when both are set |
| `vendor_code` | `DOCPHARMA_VENDOR_CODE` if set |

Preview shows the exact JSON before anything is sent. An order is not sent if
the name, 10-digit mobile, 6-digit pincode, address or items are missing, and
an order already placed cannot be placed again.

## Status updates (webhook)

Run `sql/docpharma_webhook.sql` once (after `docpharma_orders.sql`). It adds
status columns to `docpharma_orders` and a `docpharma_webhook_logs` table.

Set `DOCPHARMA_PUBLIC_URL` (the deployed Netlify site URL) and
`DOCPHARMA_WEBHOOK_SECRET` (any long random text). Every order placed after
that tells DocPharma to post updates to
`DOCPHARMA_PUBLIC_URL/api/docpharma-webhook?token=...`. The endpoint:

- rejects calls without the right token (401)
- stores every call in `docpharma_webhook_logs`, matched to an order or not
- updates the order's `dp_order_status`, `dp_suborder_status`,
  `dp_status_code`, `dp_logistic_status`, `dp_status_reason` from the latest
  event, and keeps the tracking number/URL, courier and invoice URL

The dashboard shows the latest status, courier, reason, and Track / Invoice
links. DocPharma cannot reach `localhost`, so webhooks only arrive once the
site is deployed. Orders placed before the URL was set won't send updates.
