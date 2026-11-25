// Excel (XLSX) exports. SheetJS is loaded on demand so the main bundle stays small.
import { downloadBlob, fmtDT, ymd } from "./util.js";

export async function downloadXlsx(sheets, filename) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No records" }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  downloadBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

export const lineCost = (l, idx) => idx.lineCostById?.get(l.id) ?? null;

export function inventorySheet(data, idx) {
  return data.products.map(p => { const bs = idx.batchesByProduct.get(p.id) || []; return {
    Code: p.code, Product: p.name, Category: p.category, Condition: p.condition, Size: p.attrs?.size || "", Brand: p.attrs?.brand || "", Grade: p.attrs?.grade || "", Colour: p.attrs?.colour || "",
    "Selling price (UGX)": p.sellPrice, "In stock": idx.stock.get(p.id) || 0, "Latest cost (UGX)": bs.length ? idx.batchCost.get(bs[bs.length - 1].id) || 0 : "", Archived: p.archived ? "Yes" : "No" }; });
}
export const purchasesSheet = data => data.purchases.flatMap(p => p.lines.map(l => ({ Received: fmtDT(p.receivedAt), Supplier: p.supplier, Invoice: p.invoiceNo, "Received by": p.receivedBy, Code: l.code, Product: l.name, Quantity: l.qty, "Cost each (UGX)": l.unitCost, "Line total (UGX)": l.qty * l.unitCost })));
export const salesSheet = idx => idx.salesView.flatMap(s => s.lines.map(l => ({ Reference: s.ref, Date: fmtDT(s.createdAt), Status: s.status, Attendant: s.createdByName, Item: l.name, Code: l.code, Quantity: l.qty, "Unit price (UGX)": l.unitPrice, "Discount (UGX)": l.discount || 0, "Line total (UGX)": l.qty * l.unitPrice - (l.discount || 0), "Sale total (UGX)": s.total, "Paid (UGX)": s.paid, "Balance (UGX)": s.balance, "Payment status": s.payStatus })));
export const bicyclesSheet = (data, idx) => data.bicycles.map(b => { const c = data.bicycleCosts.find(x => x.id === b.id); const inf = idx.bikes.get(b.id); return { Brand: b.brand, Model: b.model, "Frame / serial": b.frameNo, Type: b.type, Colour: b.colour, Condition: b.condition, "Buying price (UGX)": c?.buyPrice ?? "", "Selling price (UGX)": b.sellPrice, Supplier: c?.supplier || "", "Purchase date": c?.purchaseDate || "", Status: inf?.status, "Sold for (UGX)": inf?.sale?.total ?? "", "Profit (UGX)": inf?.profit ?? "" }; });
export const profitSheet = idx => idx.salesView.filter(s => s.status === "completed").map(s => ({ Reference: s.ref, Date: fmtDT(s.createdAt), "Revenue (UGX)": s.total, "Cost of goods (UGX)": s.cost, "Profit (UGX)": s.profit }));
export const stamp = () => ymd(new Date());
