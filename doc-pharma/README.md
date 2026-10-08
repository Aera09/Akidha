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
| `order_type` | `DOCPHARMA_ORDER_TYPE_<ENV>` (default `HL`) |
| `webhook_url`, `vendor_code` | `DOCPHARMA_WEBHOOK_URL`, `DOCPHARMA_VENDOR_CODE` if set |

Preview shows the exact JSON before anything is sent. An order is not sent if
the name, 10-digit mobile, 6-digit pincode, address or items are missing, and
an order already placed cannot be placed again.
