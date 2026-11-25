import assert from "node:assert/strict";
import { buildIndex, allocateFIFO, maxDiscount, settingsOf, detectIssues } from "../src/logic.js";

const t0 = "2026-01-01T10:00:00Z", t1 = "2026-01-05T10:00:00Z", t2 = "2026-01-09T10:00:00Z";
const data = {
  products: [{ id: "p1", code: "TYR-0001", name: "Tyre 26" }],
  batchStock: [{ id: "b1", productId: "p1", qty: 10, receivedAt: t0 }, { id: "b2", productId: "p1", qty: 10, receivedAt: t1 }],
  batchCosts: [{ id: "b1", unitCost: 1000 }, { id: "b2", unitCost: 1500 }],
  bicycles: [{ id: "k1", frameNo: "F1", brand: "Phoenix", model: "X" }],
  bicycleCosts: [{ id: "k1", buyPrice: 200000 }],
  sales: [], saleLines: [], payments: [], adjustments: [], reservations: [], settings: []
};
let idx = buildIndex(data, { admin: true });

// FIFO takes the oldest batch first, then moves on when it is exhausted.
let alloc = allocateFIFO("p1", 12, idx);
assert.deepEqual(alloc, [{ batchId: "b1", qty: 10 }, { batchId: "b2", qty: 2 }]);
assert.equal(allocateFIFO("p1", 21, idx), null, "short stock without override is refused");
assert.deepEqual(allocateFIFO("p1", 21, idx, { allowOver: true }).at(-1), { batchId: null, qty: 1, override: true, costUnknown: true });

// A sale uses actual batch cost for profit; partial payments give a balance.
data.sales.push({ id: "s1", ref: "S-1", status: "completed", createdAt: t2 });
data.saleLines.push({ id: "s1_0", saleId: "s1", idx: 0, kind: "part", productId: "p1", qty: 12, unitPrice: 2000, discount: 1000, alloc });
data.payments.push({ id: "pay1", saleId: "s1", amount: 10000, method: "Cash", at: t2 });
idx = buildIndex(data, { admin: true });
const s = idx.saleById.get("s1");
assert.equal(s.total, 12 * 2000 - 1000);
assert.equal(s.cost, 10 * 1000 + 2 * 1500);
assert.equal(s.profit, 23000 - 13000);
assert.equal(s.paid, 10000); assert.equal(s.balance, 13000); assert.equal(s.payStatus, "Partial");
assert.equal(idx.stock.get("p1"), 8);
assert.equal(idx.remaining.get("b1"), 0); assert.equal(idx.remaining.get("b2"), 8);

// Final payment closes the balance automatically.
data.payments.push({ id: "pay2", saleId: "s1", amount: 13000, method: "Airtel Money", at: t2 });
assert.equal(buildIndex(data, { admin: true }).saleById.get("s1").payStatus, "Paid");

// Cancelling returns stock; next sale then uses the oldest batch again.
data.sales[0].status = "cancelled";
idx = buildIndex(data, { admin: true });
assert.equal(idx.stock.get("p1"), 20);
assert.deepEqual(allocateFIFO("p1", 3, idx), [{ batchId: "b1", qty: 3 }]);

// Manual decrease follows FIFO too.
data.adjustments.push({ id: "a1", productId: "p1", change: -4, alloc: [{ batchId: "b1", qty: 4 }] });
assert.equal(buildIndex(data).stock.get("p1"), 16);

// Discount limits.
const st = { discountPct: 10, discountFixed: 500, discountRule: "both" };
assert.equal(maxDiscount(10000, st), 500);
assert.equal(maxDiscount(10000, { ...st, discountRule: "either" }), 1000);
assert.equal(maxDiscount(1000, { ...st, discountRule: "either" }), 500);
assert.equal(maxDiscount(10000, { discountPct: 0, discountFixed: 0, discountRule: "both" }), 0);
assert.equal(settingsOf({ settings: [] }).discountRule, "both");
assert.deepEqual(settingsOf({ settings: [] }).categories, [], "new installations start without preset categories");
const configured = settingsOf({ settings: [{ id: "main", categories: [{ name: "Brake pads", prefix: "BRP", fields: [{ key: "position", label: "Position", options: ["Front", "Rear"] }] }] }] });
assert.equal(configured.categories[0].name, "Brake pads");
assert.deepEqual(configured.categories[0].fields[0].options, ["Front", "Rear"]);
assert.deepEqual(settingsOf({ settings: [{ id: "main", categories: [] }] }).categories, [], "an intentionally empty category list is preserved");

// Bicycles: reservation is superseded (deposit refunded) when sold to someone else; sale shows profit.
data.reservations.push({ id: "r1", bikeId: "k1", status: "active", depositAmount: 50000, createdAt: t1 });
idx = buildIndex(data, { admin: true });
assert.equal(idx.bikes.get("k1").status, "Reserved");
data.sales.push({ id: "s2", ref: "S-2", status: "completed", createdAt: t2 });
data.saleLines.push({ id: "s2_0", saleId: "s2", idx: 0, kind: "bike", bikeId: "k1", qty: 1, unitPrice: 300000, discount: 0 });
idx = buildIndex(data, { admin: true });
const k = idx.bikes.get("k1");
assert.equal(k.status, "Sold"); assert.equal(k.profit, 100000);
assert.equal(k.reservations[0].state, "Cancelled (sold to another buyer)");
assert.equal(k.reservations[0].refunded, 0);
assert.equal(k.reservations[0].refundOutstanding, 50000);
assert.equal(k.reservations[0].refund, null, "a refund is not recorded until an actual refund transaction exists");

// Oversold stock and double-sold bicycles are flagged for the administrator.
data.sales.push({ id: "s3", ref: "S-3", status: "completed", createdAt: t2 });
data.saleLines.push({ id: "s3_0", saleId: "s3", idx: 0, kind: "bike", bikeId: "k1", qty: 1, unitPrice: 300000, discount: 0 });
data.sales[0].status = "completed";
data.saleLines.push({ id: "s4_0", saleId: "s4", idx: 0, kind: "part", productId: "p1", qty: 5, unitPrice: 2000, discount: 0, alloc: [{ batchId: "b2", qty: 5 }] });
data.sales.push({ id: "s4", ref: "S-4", status: "completed", createdAt: t2 });
const kinds = detectIssues(data, buildIndex(data, { admin: true })).map(i => i.kind);
assert.ok(kinds.includes("bike-double")); assert.ok(kinds.includes("oversold"));
// Historical bicycle purchase costs remain fixed at the sale date.
const historicData = {
  products: [], batchStock: [], batchCosts: [],
  bicycles: [{ id: "k2", frameNo: "F2", createdAt: t0 }],
  bicycleCosts: [{ id: "k2", buyPrice: 250000 }],
  bicycleCostHistory: [
    { id: "kh1", bicycleId: "k2", buyPrice: 200000, effectiveAt: t0 },
    { id: "kh2", bicycleId: "k2", buyPrice: 250000, effectiveAt: t2 }
  ],
  sales: [{ id: "hs1", status: "completed", createdAt: t1 }],
  saleLines: [{ id: "hs1_0", saleId: "hs1", idx: 0, kind: "bike", bikeId: "k2", qty: 1, unitPrice: 300000, discount: 0 }],
  payments: [], adjustments: [], reservations: [], settings: []
};
const historical = buildIndex(historicData, { admin: true }).saleById.get("hs1");
assert.equal(historical.cost, 200000);
assert.equal(historical.profit, 100000);

// When an override has no real batch cost, profit must be unknown rather than invented.
const unknownCostData = {
  ...data,
  sales: [{ id: "us1", status: "completed", createdAt: t2 }],
  saleLines: [{ id: "us1_0", saleId: "us1", idx: 0, kind: "part", productId: "p1", qty: 1, unitPrice: 2000, discount: 0, alloc: [{ batchId: null, qty: 1, override: true, costUnknown: true }] }],
  payments: []
};
const unknownCostSale = buildIndex(unknownCostData, { admin: true }).saleById.get("us1");
assert.equal(unknownCostSale.cost, null);
assert.equal(unknownCostSale.profit, null);

console.log("logic tests passed");
