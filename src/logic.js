// Pure business logic (no browser APIs): FIFO stock, sale totals, payments, profit, bicycle state, integrity checks.
import { norm } from "./util.js";

const group = (arr, key) => { const m = new Map(); for (const x of arr || []) { const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
const byTime = (a, b) => String(a.receivedAt || a.createdAt || a.at || "").localeCompare(String(b.receivedAt || b.createdAt || b.at || "")) || String(a.id).localeCompare(String(b.id));

export function settingsOf(data) {
  const s = (data.settings || []).find(x => x.id === "main") || {};
  return {
    exists: !!s.id,
    lowStock: Number(s.lowStock ?? 5),
    discountPct: Number(s.discountPct ?? 0),
    discountFixed: Number(s.discountFixed ?? 0),
    discountRule: s.discountRule === "either" ? "either" : "both",
    archiveAfterDays: Number(s.archiveAfterDays ?? 0),
    autoBackup: s.autoBackup !== false,
    categories: Array.isArray(s.categories) ? s.categories : []
  };
}

// Largest discount (UGX) an attendant may give on a line with the given gross value.
// "both": the discount must satisfy the percentage limit AND the fixed limit. "either": satisfying one is enough.
export function maxDiscount(gross, st) {
  const pct = Math.floor((gross * st.discountPct) / 100);
  const fixed = Math.floor(st.discountFixed);
  const m = st.discountRule === "either" ? Math.max(pct, fixed) : Math.min(pct, fixed);
  return Math.max(0, Math.min(m, gross));
}

export function buildIndex(data, { admin = false, excludeSale = null } = {}) {
  const sales = data.sales || [];
  const linesBy = group(data.saleLines, "saleId");
  for (const arr of linesBy.values()) arr.sort((a, b) => a.idx - b.idx);
  const payBy = group(data.payments, "saleId");
  const batchCost = new Map((data.batchCosts || []).map(c => [c.id, Number(c.unitCost) || 0]));
  const bikeCost = new Map((data.bicycleCosts || []).map(c => [c.id, Number(c.buyPrice) || 0]));
  const bikeCostHistory = group(data.bicycleCostHistory || [], "bicycleId");
  for (const rows of bikeCostHistory.values()) rows.sort((a, b) => String(a.effectiveAt || "").localeCompare(String(b.effectiveAt || "")));
  const refundsByReservation = group(data.refunds || [], "reservationId");
  const productById = new Map((data.products || []).map(p => [p.id, p]));
  const bikeById = new Map((data.bicycles || []).map(b => [b.id, b]));

  // ---- stock batches (FIFO) ----
  const remaining = new Map();
  const overrideQty = new Map();
  for (const b of data.batchStock || []) remaining.set(b.id, Number(b.qty) || 0);
  for (const s of sales) {
    if (s.status !== "completed" || s.id === excludeSale) continue;
    for (const l of linesBy.get(s.id) || []) for (const a of l.alloc || []) {
      if (!a.batchId) continue;
      remaining.set(a.batchId, (remaining.get(a.batchId) || 0) - a.qty);
      if (a.override) overrideQty.set(a.batchId, (overrideQty.get(a.batchId) || 0) + a.qty);
    }
  }
  for (const adj of data.adjustments || []) for (const a of adj.alloc || []) if (a.batchId) remaining.set(a.batchId, (remaining.get(a.batchId) || 0) - a.qty);

  const batchesByProduct = group([...(data.batchStock || [])].sort(byTime), "productId");
  const stock = new Map();
  for (const [pid, bs] of batchesByProduct) stock.set(pid, bs.reduce((t, b) => t + (remaining.get(b.id) || 0), 0));

  // ---- sales ----
  const soldBikes = new Map();
  const lineCostById = new Map();
  const salesView = sales.map(s => {
    const lines = linesBy.get(s.id) || [];
    const gross = lines.reduce((t, l) => t + l.qty * l.unitPrice, 0);
    const discount = lines.reduce((t, l) => t + (Number(l.discount) || 0), 0);
    const total = gross - discount;
    const payments = [...(payBy.get(s.id) || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const paid = payments.reduce((t, p) => t + (Number(p.amount) || 0), 0);
    const balance = Math.max(0, total - paid);
    const payStatus = total <= 0 || paid >= total ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
    const items = lines.reduce((t, l) => t + l.qty, 0);
    let cost = null, profit = null;
    if (admin) {
      let sum = 0, known = true;
      for (const l of lines) {
        let lineCost = 0, lineKnown = true;
        if (l.kind === "bike") {
          const history = bikeCostHistory.get(l.bikeId) || [];
          const historic = history.filter(h => String(h.effectiveAt || "") <= String(s.createdAt || "")).at(-1);
          // Once a history exists, never fall forward to a later price. If no
          // cost is known at the sale date, report profit as unknown.
          const value = history.length ? historic?.buyPrice : bikeCost.get(l.bikeId);
          if (value === undefined || !Number.isFinite(Number(value))) lineKnown = false;
          else lineCost = Number(value);
        } else {
          for (const a of l.alloc || []) {
            if (!a.batchId || !batchCost.has(a.batchId)) { lineKnown = false; continue; }
            lineCost += a.qty * (Number(batchCost.get(a.batchId)) || 0);
          }
        }
        lineCostById.set(l.id, lineKnown ? lineCost : null);
        if (!lineKnown) known = false; else sum += lineCost;
      }
      cost = known ? sum : null;
      profit = known ? total - sum : null;
    }
    const v = { ...s, lines, gross, discount, total, payments, paid, balance, payStatus, items, cost, profit };
    if (s.status === "completed") for (const l of lines) if (l.kind === "bike") { if (!soldBikes.has(l.bikeId)) soldBikes.set(l.bikeId, []); soldBikes.get(l.bikeId).push(v); }
    return v;
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const saleById = new Map(salesView.map(s => [s.id, s]));

  // ---- bicycles & reservations ----
  const resByBike = group(data.reservations, "bikeId");
  const bikes = new Map();
  for (const bike of data.bicycles || []) {
    const sold = (soldBikes.get(bike.id) || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    const reservations = (resByBike.get(bike.id) || []).map(r => {
      const refundRows = refundsByReservation.get(r.id) || [];
      const refunded = refundRows.reduce((t, x) => t + (Number(x.amount) || 0), 0);
      const depositAmount = Number(r.depositAmount) || 0;
      const refundOutstanding = Math.max(0, depositAmount - refunded);
      if (sold && sold.reservationId === r.id) return { ...r, state: "Converted to sale", refunds: refundRows, refunded, refundOutstanding, refund: null };
      if (sold) return { ...r, state: "Cancelled (sold to another buyer)", refunds: refundRows, refunded, refundOutstanding, refund: refunded > 0 ? { amount: refunded, at: refundRows.at(-1)?.at } : null };
      if (r.status === "cancelled") return { ...r, state: refundOutstanding > 0 ? "Cancelled (refund due)" : "Cancelled", refunds: refundRows, refunded, refundOutstanding, refund: refunded > 0 ? { amount: refunded, at: refundRows.at(-1)?.at } : null };
      return { ...r, state: "Active", refunds: refundRows, refunded, refundOutstanding, refund: refunded > 0 ? { amount: refunded, at: refundRows.at(-1)?.at } : null };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const active = reservations.find(r => r.state === "Active") || null;
    const profit = sold && admin ? sold.profit : null;
    bikes.set(bike.id, { status: sold ? "Sold" : active ? "Reserved" : "Available", sale: sold, reservations, active, profit });
  }

  return { remaining, overrideQty, batchesByProduct, stock, salesView, saleById, bikes, productById, bikeById, batchCost, bikeCost, lineCostById, refundsByReservation };
}

// FIFO: take from the oldest batch first. Returns [{batchId, qty}] or null when stock is short and no override is allowed.
export function allocateFIFO(productId, qty, idx, { allowOver = false } = {}) {
  const bs = idx.batchesByProduct.get(productId) || [];
  let need = qty; const alloc = [];
  for (const b of bs) {
    const r = idx.remaining.get(b.id) || 0;
    if (r <= 0) continue;
    const take = Math.min(r, need);
    alloc.push({ batchId: b.id, qty: take }); need -= take;
    if (need <= 0) break;
  }
  if (need > 0) {
    if (!allowOver) return null;
    // Above-stock units are not assigned to a real batch: using the last batch
    // would invent a cost and distort historical profit.
    alloc.push({ batchId: null, qty: need, override: true, costUnknown: true });
  }
  return alloc;
}

// Remove allocations from the oldest batches for a manual stock decrease.
export const allocateDecrease = (productId, qty, idx) => allocateFIFO(productId, qty, idx, { allowOver: false });

export function detectIssues(data, idx) {
  const issues = [];
  for (const [batchId, rem] of idx.remaining) {
    const over = idx.overrideQty.get(batchId) || 0;
    if (rem + over < 0) {
      const b = (data.batchStock || []).find(x => x.id === batchId);
      const p = b && idx.productById.get(b.productId);
      issues.push({ id: `oversold:${batchId}`, kind: "oversold", title: "Stock oversold", detail: `${p ? `${p.code} ${p.name}` : "A product"} has ${Math.abs(rem + over)} unit(s) sold beyond what was received in one batch. This usually happens when two devices sold the last units while offline.`, refs: { productId: b?.productId } });
    }
  }
  for (const [bikeId, list] of [...idx.salesView.reduce((m, s) => { if (s.status === "completed") for (const l of s.lines) if (l.kind === "bike") m.set(l.bikeId, [...(m.get(l.bikeId) || []), s]); return m; }, new Map())]) {
    if (list.length > 1) {
      const bike = idx.bikeById.get(bikeId);
      issues.push({ id: `bike-double:${bikeId}`, kind: "bike-double", title: "Bicycle sold twice", detail: `${bike ? `${bike.brand} ${bike.model} (${bike.frameNo})` : bikeId} appears in ${list.length} completed sales: ${list.map(s => s.ref).join(", ")}.`, refs: { saleIds: list.map(s => s.id) } });
    }
  }
  const dup = (rows, field, kind, label, title) => {
    const m = new Map();
    for (const r of rows || []) { const k = norm(r[field]); if (!k) continue; m.set(k, [...(m.get(k) || []), r]); }
    for (const [k, list] of m) if (list.length > 1) issues.push({ id: `${kind}:${k}`, kind, title, detail: `${label} "${list[0][field]}" is used by ${list.length} records after synchronisation.`, refs: { ids: list.map(x => x.id) } });
  };
  dup(data.sales, "ref", "dup-ref", "Sale reference", "Duplicate sale reference");
  dup(data.products, "code", "dup-code", "Product code", "Duplicate product code");
  dup(data.bicycles, "frameNo", "dup-frame", "Frame number", "Duplicate frame number");
  return issues;
}

export function lowStockProducts(data, idx, st) {
  return (data.products || []).filter(p => !p.archived).map(p => ({ p, qty: idx.stock.get(p.id) || 0 })).filter(x => x.qty <= st.lowStock);
}
