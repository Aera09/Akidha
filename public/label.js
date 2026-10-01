// Builds the 4x6 inch shipping label (same layout as ShippingLabel_1.docx)
// as a standalone HTML page with Download PDF and Print buttons.
// Used by index.html: window.renderLabelHtml(data, { logoUrl, html2pdfUrl }).
(function () {
  const MAX_ROWS = 6;

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const money = (n) =>
    "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const date = (v) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  function itemRows(items) {
    const shown = items.slice(0, MAX_ROWS);
    const rows = shown.map(
      (i) => `<tr><td><b>${esc(i.sku)}</b><span class="nm">${esc(i.name)}</span></td><td class="q">${esc(i.qty)}</td></tr>`
    );
    const extra = items.length - shown.length;
    if (extra > 0) {
      const qty = items.slice(MAX_ROWS).reduce((s, i) => s + i.qty, 0);
      rows.push(`<tr><td><i>+ ${extra} more item${extra > 1 ? "s" : ""}</i></td><td class="q">${esc(qty)}</td></tr>`);
    }
    while (rows.length < MAX_ROWS) rows.push(`<tr><td>&nbsp;</td><td></td></tr>`);
    return rows.join("");
  }

  window.renderLabelHtml = function (d, { logoUrl, html2pdfUrl }) {
    // The label shows the date it was generated, not the order's date.
    const labelDate = date(new Date());
    const fileName = `Label_${String(d.orderNo).replace(/[^\w-]+/g, "_")}.pdf`;
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Label ${esc(d.orderNo)}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 10px 12px; font: 13px system-ui, sans-serif; background: #f4f5fa; border-bottom: 1px solid #ddd; }
  .toolbar button { font: inherit; height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid #c9cbd6; background: #fff; cursor: pointer; }
  .toolbar button.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; font-weight: 600; }
  .toolbar button:disabled { opacity: .6; cursor: wait; }
  .toolbar span { color: #555; margin-left: auto; }
  .sheet { padding: 16px; background: #f4f5fa; }
  .sheet .label { margin: 0 auto; box-shadow: 0 2px 12px rgba(0,0,0,.18); background: #fff; }
  @media print {
    .toolbar { display: none; }
    .sheet { padding: 0; background: #fff; }
    .sheet .label { box-shadow: none; margin: 0; }
  }
  body { font: 9pt/1.3 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label { width: 4in; height: 6in; padding: 0.14in 0.16in; display: flex; flex-direction: column; overflow: hidden; }
  .top { display: flex; justify-content: space-between; gap: 8px; }
  .shipto h4 { margin: 0 0 2px; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }
  .shipto .name { font-size: 11pt; font-weight: 700; }
  .shipto .pin { font-size: 12pt; font-weight: 700; margin-top: 2px; }
  .logo { width: 1.3in; height: auto; flex: none; align-self: flex-start; }
  .pay { display: flex; justify-content: space-between; margin-top: 6px; padding: 4px 0; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; font-weight: 700; font-size: 10pt; }
  .from { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 5px; font-size: 6pt; line-height: 1.35; }
  .from b { font-size: 6.5pt; }
  .from .h { color: #333; }
  .meta { display: flex; justify-content: space-between; margin-top: 6px; padding-top: 4px; border-top: 1.5px solid #000; font-weight: 700; font-size: 8.5pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 8pt; }
  th, td { border: 1px solid #000; padding: 2px 5px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  td.q, th.q { width: 0.55in; text-align: center; }
  .nm { display: block; font-size: 6.5pt; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 2.9in; }
  .total { text-align: right; font-weight: 700; margin-top: 3px; font-size: 9pt; }
  .foot { margin-top: auto; font-size: 5.5pt; line-height: 1.35; color: #222; }
</style></head>
<body>
<div class="toolbar">
  <button class="primary" id="download" type="button">Download PDF</button>
  <button id="print" type="button">Print</button>
  <span>${esc(fileName)}</span>
</div>
<div class="sheet"><div class="label">
  <div class="top">
    <div class="shipto">
      <h4>Ship To</h4>
      <div class="name">${esc(d.customerName)}</div>
      <div>${esc(d.address)}</div>
      <div class="pin">${esc(d.pincode)}</div>
      <div>${esc(d.mobile)}</div>
    </div>
    <img class="logo" src="${esc(logoUrl)}" alt="Akidha">
  </div>

  <div class="pay">
    <span>Payment: ${esc(d.paymentMode)}</span>
    <span>Collectible Amount: ${money(d.collectible)}</span>
  </div>

  <div class="from">
    <div>
      <div class="h">Shipped By (if undelivered, return to)</div>
      <b>AKIDHA</b><br>
      UNIT NO. 102, 1ST FLOOR,<br>
      PLOT NO B/93, GOVT INDUSTRIAL ESTATE,<br>
      OPP. SAHYADRI NAGAR, CHARKOP,<br>
      KANDIVALI (W), MUMBAI – 400 067<br>
      Customer Care: +91 77180 51578 / +91 77180 56080<br>
      support@akidha.in
    </div>
    <div>
      <div class="h">Delivered By</div>
      <b>VIABLE LOGISTICS</b><br>
      SHOP NO. 19, GROUND FLOOR,<br>
      HEERA PANNA SHOPPING MALL,<br>
      NEXT TO LAKE FRONT SOLITAIRE BLDG,<br>
      POWAI, MUMBAI – 400 076<br>
      Customer Care: +91 93724 89926<br>
      customerservice@viablelogistics.in
    </div>
  </div>

  <div class="meta">
    <span>Order#: ${esc(d.orderNo)}</span>
    <span>Order Date: ${esc(labelDate)}</span>
  </div>

  <table>
    <thead><tr><th>SKU</th><th class="q">QTY</th></tr></thead>
    <tbody>${itemRows(d.items || [])}</tbody>
  </table>
  <div class="total">Total Quantity: ${esc(d.totalQty)}</div>

  <div class="foot">
    All disputes are subject to Mumbai Jurisdiction only.<br>
    Goods once sold will only be taken back or exchanged as per Company's exchange and return policy.<br>
    This is an auto generated label and does not require any signature.
  </div>
</div></div>
<script src="${esc(html2pdfUrl)}"></script>
<script>
  document.getElementById("print").onclick = () => window.print();
  document.getElementById("download").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      await html2pdf()
        .set({
          filename: ${JSON.stringify(fileName)},
          margin: 0,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 3, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "in", format: [4, 6], orientation: "portrait" },
        })
        .from(document.querySelector(".label"))
        .toPdf()
        .get("pdf")
        .then((pdf) => {
          // Rounding can spill a sliver onto a second page; keep only the label.
          while (pdf.getNumberOfPages() > 1) pdf.deletePage(pdf.getNumberOfPages());
        })
        .save();
    } catch (err) {
      alert("Could not create the PDF: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Download PDF";
    }
  };
</script>
</body></html>`;
  };
})();
