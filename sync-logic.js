// Decides what each role may write to the cloud and rebuilds the full picture when reading.
// Buying costs live in the admin-only "costs" collection, so attendants never receive them.
const strip = (o, keys) => { const r = { ...o }; keys.forEach(k => delete r[k]); return r; };

// Returns [[path, data, options?], ...] to write for one record.
export function writesFor(col, o, role) {
  const id = String(o.id), admin = role === "admin", w = [];
  if (col === "products") {
    if (!admin) return w;
    w.push(["products/" + id, strip(o, ["cost"])]);
    w.push(["costs/p" + id, { id: "p" + id, cost: +o.cost || 0 }]);
  } else if (col === "bikes") {
    if (admin) {
      w.push(["bikes/" + id, strip(o, ["cost"])]);
      w.push(["costs/b" + id, { id: "b" + id, cost: +o.cost || 0 }]);
    } else {
      // Attendants can only mark a bicycle as sold.
      w.push(["bikes/" + id, { status: o.status, soldDate: o.soldDate || "", saleId: o.saleId || "" }, { merge: true }]);
    }
  } else if (col === "entries") {
    if (o.type === "Expense") { if (admin) w.push(["expenses/" + id, o]); }
    else if (o.type === "Restock") {
      if (admin) { w.push(["entries/" + id, strip(o, ["price", "cost"])]); w.push(["costs/e" + id, { id: "e" + id, price: +o.price || 0 }]); }
    } else {
      w.push(["entries/" + id, strip(o, ["cost"])]);
      if (admin && +o.cost) w.push(["costs/e" + id, { id: "e" + id, cost: +o.cost }]);
    }
  }
  return w;
}

// Paths to remove for one record (only administrators can delete).
export function deletesFor(col, id) {
  id = String(id);
  if (col === "products") return ["products/" + id, "costs/p" + id];
  if (col === "bikes") return ["bikes/" + id, "costs/b" + id];
  return ["entries/" + id, "expenses/" + id, "costs/e" + id];
}

// Puts the cloud pieces back together into what the app shows.
export function mergeAll(raw) {
  const cost = {}; (raw.costs || []).forEach(c => { cost[c.id] = c; });
  const products = (raw.products || []).map(p => ({ ...p, cost: cost["p" + p.id] ? cost["p" + p.id].cost : 0 }));
  const bikes = (raw.bikes || []).map(b => ({ ...b, cost: cost["b" + b.id] ? cost["b" + b.id].cost : 0 }));
  const entries = (raw.entries || []).map(e => {
    const c = cost["e" + e.id];
    if (e.type === "Restock") return { ...e, price: c ? c.price : 0 };
    return c && c.cost ? { ...e, cost: c.cost } : e;
  }).concat(raw.expenses || []);
  return { products, bikes, entries };
}
