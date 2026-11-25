import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "../auth.jsx";
import { useData } from "../store.jsx";
import { get } from "../db.js";
import { allocateFIFO, buildIndex, maxDiscount } from "../logic.js";
import { commitGroup } from "../records.js";
import { Badge, Empty, Field, Notice, Table, useNav, useToast } from "../ui.jsx";
import { PAY_METHODS } from "../constants.js";
import { fmtDT, money, newSaleRef, norm, nowISO, uuid } from "../util.js";
import SaleDetail, { payTone } from "./SaleDetail.jsx";

export default function Sales() {
  const nav = useNav();
  const [tab, setTab] = useState(nav.params.tab || "new");
  const [open, setOpen] = useState(null);
  return (
    <div className="page">
      <div className="page-head"><h2>Sales</h2></div>
      <div className="tabs"><button className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>New sale</button><button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>Sales history</button></div>
      {tab === "new" ? <NewSale correctId={nav.params.correct} preBike={nav.params.bikeId} preReservation={nav.params.reservationId} onSaved={id => { setTab("history"); setOpen(id); }} /> : <History onOpen={setOpen} />}
      {open && <SaleDetail saleId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function NewSale({ correctId, preBike, preReservation, onSaved }) {
  const { user } = useAuth();
  const { data, idx: fullIdx, st, isAdmin } = useData();
  const toast = useToast();
  const idx = useMemo(() => (correctId ? buildIndex(data, { admin: isAdmin, excludeSale: correctId }) : fullIdx), [data, fullIdx, correctId, isAdmin]);
  const [draftId, setDraftId] = useState(uuid);
  const [ref, setRef] = useState(newSaleRef);
  const [cart, setCart] = useState([]);
  const [pays, setPays] = useState([]);
  const [reservationId, setReservationId] = useState(preReservation || "");
  const [customerName, setCustomerName] = useState("");
  const [guidedCategory, setGuidedCategory] = useState("");
  const [guidedFilters, setGuidedFilters] = useState({});
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [q, setQ] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const old = correctId ? fullIdx.saleById.get(correctId) : null;

  useEffect(() => { // prefill for a correction or for selling a specific bicycle
    if (old) {
      setCart(old.lines.map(l => { const cur = l.kind === "bike" ? idx.bikeById.get(l.bikeId) : idx.productById.get(l.productId); return { key: l.id, kind: l.kind, refId: l.productId || l.bikeId, name: l.name, code: l.code, qty: l.qty, unitPrice: cur ? cur.sellPrice : l.unitPrice, discount: l.discount || 0 }; }));
      setPays(old.payments.map(p => ({ id: uuid(), method: p.method, amount: String(p.amount), at: p.at, kind: "transfer", sourceKind: p.kind || "sale", sourcePaymentId: p.id })));
      setReservationId(old.reservationId || "");
      setCustomerName(old.customerName || "");
    } else if (preBike) { const b = idx.bikeById.get(preBike); if (b) addBike(b); }
  }, []); // eslint-disable-line

  const results = useMemo(() => {
    const s = norm(q);
    if (s.length < 1) return { categories: [], parts: [], bikes: [] };

    // Search administrator-created categories as well as existing products and bicycles.
    const categories = (st.categories || [])
      .filter(c => c.name && norm(c.name).includes(s))
      .slice(0, 5);

    const parts = data.products
      .filter(p => !p.archived && norm(`${p.name} ${p.code} ${p.category || ""} ${Object.values(p.attrs || {}).join(" ")}`).includes(s))
      .slice(0, 8);

    const bikes = data.bicycles
      .filter(b => !b.archived && idx.bikes.get(b.id)?.status !== "Sold" && norm(`${b.frameNo} ${b.brand} ${b.model}`).includes(s))
      .slice(0, 5);

    return { categories, parts, bikes };
  }, [q, data.products, data.bicycles, idx, st.categories]);

  // The guided category list is controlled only by categories created by the administrator.
  // Legacy product.category values must not silently recreate removed/default categories.
  const productCategories = useMemo(
    () => (st.categories || []).map(c => c.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [st.categories]
  );
  const guidedFields = useMemo(() => {
    const category = (st.categories || []).find(c => c.name === guidedCategory);
    if (!category) return [];
    const rows = data.products.filter(p => !p.archived && p.category === guidedCategory);
    return (category.fields || []).map(field => ({
      key: field.key,
      label: field.label || field.key,
      values: (field.options || []).length
        ? field.options
        : [...new Set(rows.map(p => p.attrs?.[field.key]).filter(v => v !== undefined && String(v).trim()).map(String))].sort()
    }));
  }, [data.products, st.categories, guidedCategory]);
  const guidedMatches = useMemo(() => data.products.filter(p => {
    if (p.archived || !guidedCategory || p.category !== guidedCategory) return false;
    return Object.entries(guidedFilters).every(([key, value]) => !value || String(p.attrs?.[key] ?? "") === value);
  }).sort((a, b) => a.name.localeCompare(b.name)), [data.products, guidedCategory, guidedFilters]);
  function toggleSelected(id) { setSelectedProducts(rows => rows.includes(id) ? rows.filter(x => x !== id) : [...rows, id]); }
  function addSelectedProducts() {
    const chosen = guidedMatches.filter(p => selectedProducts.includes(p.id));
    chosen.forEach(addPart);
    setSelectedProducts([]);
  }

  function addPart(p) {
    const stock = idx.stock.get(p.id) || 0;
    if (stock <= 0 && !isAdmin) return;
    setCart(c => { const ex = c.find(x => x.kind === "part" && x.refId === p.id); return ex ? c.map(x => (x === ex ? { ...x, qty: x.qty + 1 } : x)) : [...c, { key: uuid(), kind: "part", refId: p.id, name: p.name, code: p.code, qty: 1, unitPrice: p.sellPrice, discount: 0 }]; });
    setQ("");
  }
  function addBike(b) {
    setCart(c => (c.some(x => x.refId === b.id) ? c : [...c, { key: uuid(), kind: "bike", refId: b.id, name: `${b.brand} ${b.model}`, code: b.frameNo, qty: 1, unitPrice: b.sellPrice, discount: 0 }]));
    setQ("");
  }
  const setLine = (key, patch) => setCart(c => c.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const lines = cart.map(l => { const gross = l.qty * l.unitPrice; const max = isAdmin ? gross : maxDiscount(gross, st); const stock = l.kind === "part" ? idx.stock.get(l.refId) || 0 : 1; return { ...l, gross, max, stock, net: gross - (Number(l.discount) || 0) }; });
  const total = lines.reduce((t, l) => t + l.net, 0);
  const bikeLine = cart.find(l => l.kind === "bike");
  const bikeInfo = bikeLine ? idx.bikes.get(bikeLine.refId) : null;
  const heldRes = bikeInfo?.active || null;
  const deposit = reservationId ? data.reservations.find(r => r.id === reservationId) : null;
  const carriedDeposit = pays.some(p => p.kind === "deposit" || p.sourceKind === "deposit");
  const paidRows = pays.reduce((t, p) => t + (Number(p.amount) || 0), 0) + (deposit && !carriedDeposit ? deposit.depositAmount : 0);
  const balance = total - paidRows;

  async function submit() {
    if (saving.current) return;
    setErr("");
    if (!lines.length) return setErr("Add at least one item.");
    if (balance > 0 && !customerName.trim()) return setErr("Enter the customer name for a credit sale.");
    if (await get("sales", draftId)) { return; } // this sale was already saved – never submit twice
    const refClean = ref.trim();
    if (!refClean) return setErr("The sale reference cannot be empty.");
    if (data.sales.some(s => s.id !== correctId && norm(s.ref) === norm(refClean))) return setErr("This sale reference is already used. Choose another one.");
    const outLines = [];
    for (const [i, l] of lines.entries()) {
      const cur = l.kind === "bike" ? idx.bikeById.get(l.refId) : idx.productById.get(l.refId);
      if (!cur) return setErr(`${l.name} no longer exists.`);
      if (!Number.isInteger(l.qty) || l.qty < 1) return setErr(`Quantity for ${l.name} must be a whole number of 1 or more.`);
      const disc = Math.round(Number(l.discount) || 0);
      if (disc < 0 || disc > l.max) return setErr(`Discount for ${l.name} is above the allowed limit (${money(l.max)}).`);
      const unitPrice = cur.sellPrice;
      let alloc;
      if (l.kind === "part") {
        const short = l.qty > l.stock;
        if (short && !isAdmin) return setErr(`Only ${l.stock} of ${l.name} in stock.`);
        if (short && !window.confirm(`${l.name}: only ${l.stock} in stock. Sell ${l.qty} anyway (administrator override)?`)) return;
        alloc = allocateFIFO(l.refId, l.qty, idx, { allowOver: isAdmin });
        if (!alloc) return setErr(`Not enough stock for ${l.name}.`);
      } else if (idx.bikes.get(l.refId)?.status === "Sold" && !correctId) return setErr(`${l.name} is already sold.`);
      outLines.push({ id: `${draftId}_${i}`, saleId: draftId, idx: i, kind: l.kind, productId: l.kind === "part" ? l.refId : undefined, bikeId: l.kind === "bike" ? l.refId : undefined, name: l.name, code: l.code, qty: l.qty, unitPrice, discount: disc, alloc });
    }
    const netTotal = outLines.reduce((t, l) => t + l.qty * l.unitPrice - l.discount, 0);
    const payRows = [];
    for (const p of pays) {
      const a = Math.round(Number(p.amount));
      if (!(a > 0)) return setErr("Every payment needs an amount above 0.");
      payRows.push({ id: uuid(), saleId: draftId, amount: a, method: p.method, at: p.at || nowISO(), kind: p.kind || "sale", ...(p.sourcePaymentId ? { sourcePaymentId: p.sourcePaymentId, sourceKind: p.sourceKind } : {}) });
    }
    // A zero deposit is valid as a reservation, but is not a payment record.
    if (deposit && !carriedDeposit && Number(deposit.depositAmount) > 0) payRows.push({ id: uuid(), saleId: draftId, amount: Number(deposit.depositAmount), method: deposit.depositMethod, at: deposit.depositAt || deposit.createdAt, kind: "deposit" });
    if (payRows.reduce((t, p) => t + p.amount, 0) > netTotal) return setErr("Payments are more than the sale total.");
    if (reservationId && (!deposit || deposit.status !== "active" || (heldRes && heldRes.id !== reservationId))) return setErr("The selected reservation is no longer active. Refresh the page and check the bicycle reservation.");

    saving.current = true; setBusy(true);
    try {
      const now = nowISO();
      const audit = rec => ({ col: "saleAudit", rec: { id: uuid(), by: user.uid, byName: user.displayName, at: now, ...rec } });
      const rawOld = correctId ? data.sales.find(s => s.id === correctId) : null;
      await commitGroup([
        { col: "sales", rec: { id: draftId, ref: refClean, createdAt: now, createdBy: user.uid, createdByName: user.displayName, status: "completed", lineCount: outLines.length, total: netTotal, paidTotal: payRows.reduce((t, p) => t + p.amount, 0), ...(balance > 0 ? { customerName: customerName.trim() } : {}), ...(correctId ? { correctsSaleId: correctId } : {}), ...(reservationId ? { reservationId } : {}) } },
        ...outLines.map(rec => ({ col: "saleLines", rec })), ...payRows.map(rec => ({ col: "payments", rec })),
        audit({ saleId: draftId, action: correctId ? "created as correction" : "created", reason: correctId ? `Corrects ${old.ref}` : "" }),
        ...(correctId ? [audit({ saleId: correctId, action: "cancelled", reason: `Corrected: replaced by ${refClean}` })] : [])
      ], correctId && rawOld ? [{ col: "sales", rec: { ...rawOld, status: "cancelled", cancel: { reason: `Corrected: replaced by ${refClean}`, by: user.uid, byName: user.displayName, at: now } } }] : [], user.uid);
      toast(correctId ? "Correction saved. The old sale was reversed." : "Sale saved.");
      const id = draftId;
      setDraftId(uuid()); setRef(newSaleRef()); setCart([]); setPays([]); setReservationId(""); setCustomerName(""); setGuidedCategory(""); setGuidedFilters({}); setSelectedProducts([]); setQ("");
      onSaved(id);
    } catch (e) { setErr(e.message || "Could not save the sale."); } finally { saving.current = false; setBusy(false); }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      {correctId && <Notice tone="warn">Correcting sale {old?.ref}. The replacement sale, transferred payments, cancellation and audit history are saved together.</Notice>}
      <div className="panel">
        <h3>Find spare parts by category</h3>
        <div className="form">
          <Field label="1. Choose category"><select value={guidedCategory} onChange={e => { setGuidedCategory(e.target.value); setGuidedFilters({}); setSelectedProducts([]); }}><option value="">Select a category</option>{productCategories.map(c => <option key={c}>{c}</option>)}</select></Field>
          {guidedCategory && guidedFields.map(fd => <Field key={fd.key} label={fd.label}><select value={guidedFilters[fd.key] || ""} onChange={e => { setGuidedFilters(v => ({ ...v, [fd.key]: e.target.value })); setSelectedProducts([]); }}><option value="">All {fd.label.toLowerCase()}s</option>{fd.values.map(v => <option key={v}>{v}</option>)}</select></Field>)}
        </div>
        {guidedCategory && <>
          <p className="muted">2. Select the matching products. Stock quantity is shown beside each item.</p>
          {guidedMatches.length === 0 ? <Empty text="No products match this category and these options." /> : <Table><thead><tr><th></th><th>Product</th><th>Details</th><th className="num">Price</th><th className="num">Available</th></tr></thead><tbody>
            {guidedMatches.map(p => { const stock = idx.stock.get(p.id) || 0; const disabled = stock <= 0 && !isAdmin; return <tr key={p.id}><td><input type="checkbox" checked={selectedProducts.includes(p.id)} disabled={disabled} onChange={() => toggleSelected(p.id)} aria-label={`Select ${p.name}`} /></td><td>{p.name}<div className="muted">{p.code}</div></td><td>{Object.values(p.attrs || {}).filter(Boolean).join(" · ") || "—"}</td><td className="num">{money(p.sellPrice)}</td><td className="num"><Badge tone={stock <= 0 ? "bad" : stock <= st.lowStock ? "warn" : "ok"}>{stock}</Badge></td></tr>; })}
          </tbody></Table>}
          <div className="row end" style={{ marginTop: 10 }}><button className="btn accent" disabled={!selectedProducts.length} onClick={addSelectedProducts}>Add selected ({selectedProducts.length})</button></div>
        </>}
      </div>

      <div className="panel">
        <h3>Or search directly</h3>
        <Field label="Find a product or bicycle (name, code or frame number)"><input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. tyre 26, TYR-0001, frame number" autoFocus /></Field>
        {(results.categories.length > 0 || results.parts.length > 0 || results.bikes.length > 0) && (
          <Table><tbody>
            {results.categories.map(c => (
              <tr key={`category-${c.id || c.name}`} className="click" onClick={() => {
                setGuidedCategory(c.name);
                setGuidedFilters({});
                setSelectedProducts([]);
                setQ("");
              }}>
                <td><strong>{c.name}</strong><div className="muted">Category · open product filters</div></td>
                <td></td>
                <td><span className="muted">Category</span></td>
              </tr>
            ))}
            {results.parts.map(p => { const s = idx.stock.get(p.id) || 0; const blocked = s <= 0 && !isAdmin; return (
              <tr key={p.id} className={blocked ? "" : "click"} onClick={() => !blocked && addPart(p)}><td>{p.name}<div className="muted">{p.code} · {p.category}</div></td><td className="num">{money(p.sellPrice)}</td><td>{s <= 0 ? <Badge tone="bad">{blocked ? "Out of stock" : "Out of stock · admin override"}</Badge> : <Badge tone={s <= st.lowStock ? "warn" : "ok"}>{s} in stock</Badge>}</td></tr>); })}
            {results.bikes.map(b => { const inf = idx.bikes.get(b.id); return <tr key={b.id} className="click" onClick={() => addBike(b)}><td>{b.brand} {b.model}<div className="muted">Frame {b.frameNo} · bicycle</div></td><td className="num">{money(b.sellPrice)}</td><td><Badge tone={inf?.status === "Reserved" ? "warn" : "ok"}>{inf?.status}</Badge></td></tr>; })}
          </tbody></Table>
        )}
      </div>

      <div className="panel">
        <h3>Items</h3>
        {lines.length === 0 ? <Empty text="Search above and tap an item to add it." /> : lines.map(l => (
          <div className="cart-line" key={l.key}>
            <div>{l.name}<div className="muted">{l.code} · {money(l.unitPrice)} each{l.kind === "part" && l.qty > l.stock ? " · above stock" : ""}</div></div>
            <input type="number" min="1" value={l.qty} disabled={l.kind === "bike"} onChange={e => setLine(l.key, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label="Quantity" />
            <div><input type="number" min="0" value={l.discount} onChange={e => setLine(l.key, { discount: e.target.value })} aria-label="Discount in UGX" />{!isAdmin && <small className="muted">Max {money(l.max)}</small>}</div>
            <b className="right">{money(l.net)}</b>
            <button className="icon-btn" onClick={() => setCart(c => c.filter(x => x.key !== l.key))} aria-label="Remove item"><Trash2 size={17} /></button>
          </div>
        ))}
        {lines.length > 0 && <small className="muted">Columns: item · quantity · discount (UGX) · line total</small>}
        {heldRes && <Field label="Reservation on this bicycle"><select value={reservationId} onChange={e => setReservationId(e.target.value)}><option value="">Sell to someone else (deposit refund will remain pending)</option><option value={heldRes.id}>Sell to {heldRes.buyerName || "reservation holder"} and apply their {money(heldRes.depositAmount)} deposit</option></select></Field>}
        {heldRes && !reservationId && <Notice tone="warn">This sale is to someone other than the reservation holder. The reservation will be marked as displaced, but no refund will be assumed or recorded. An administrator must record the actual refund.</Notice>}
      </div>

      <div className="panel">
        <div className="row between"><h3>Payment</h3><button className="btn ghost sm" onClick={() => setPays(p => [...p, { id: uuid(), method: PAY_METHODS[0], amount: String(Math.max(0, balance)) , kind: "sale" }])}><Plus size={15} /> Add payment</button></div>
        {deposit && !carriedDeposit && <p className="muted">Deposit applied: {money(deposit.depositAmount)} ({deposit.depositMethod})</p>}
        {pays.map(p => (
          <div className="row" key={p.id} style={{ marginBottom: 8 }}>
            <select style={{ maxWidth: 200 }} value={p.method} disabled={p.kind === "deposit"} onChange={e => setPays(a => a.map(x => (x.id === p.id ? { ...x, method: e.target.value } : x)))}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</select>
            <input style={{ maxWidth: 170 }} type="number" min="1" value={p.amount} onChange={e => setPays(a => a.map(x => (x.id === p.id ? { ...x, amount: e.target.value } : x)))} aria-label="Payment amount" />
            <button className="icon-btn" onClick={() => setPays(a => a.filter(x => x.id !== p.id))} aria-label="Remove payment"><Trash2 size={17} /></button>
          </div>
        ))}
        {pays.length === 0 && <p className="muted">No payment yet. Add one for cash, MTN Mobile Money or Airtel Money. Split and partial payments are allowed.</p>}
        {balance > 0 && <Field label="Customer name (required for credit sale)" full><input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Enter the customer's name" /></Field>}
        <div className="row between" style={{ marginTop: 10 }}>
          <div className="row">{isAdmin ? <Field label="Sale reference (editable by administrator)"><input value={ref} onChange={e => setRef(e.target.value)} /></Field> : <span className="muted">Reference {ref}</span>}</div>
          <div className="totals"><span className="muted">Total</span><b>{money(total)}</b><span>Paid {money(paidRows)} · Balance <b style={{ fontSize: "1rem", color: balance > 0 ? "var(--warn)" : "var(--ok)" }}>{money(Math.max(0, balance))}</b></span></div>
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="row end" style={{ marginTop: 10 }}><button className="btn accent" disabled={busy || !lines.length} onClick={submit}>{busy ? "Saving…" : correctId ? "Save correction" : "Complete sale"}</button></div>
      </div>
    </div>
  );
}

function History({ onOpen }) {
  const { idx, isAdmin } = useData();
  const [q, setQ] = useState(""); const [status, setStatus] = useState("all"); const [pay, setPay] = useState("all");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [archived, setArchived] = useState(false); const [limit, setLimit] = useState(50);
  const rows = useMemo(() => idx.salesView.filter(s => {
    if (!archived && s.archived) return false;
    if (status !== "all" && s.status !== status) return false;
    if (pay !== "all" && (s.status === "cancelled" || s.payStatus !== pay)) return false;
    const d = s.createdAt.slice(0, 10); if (from && d < from) return false; if (to && d > to) return false;
    const t = norm(q); return !t || norm(`${s.ref} ${s.customerName || ""}`).includes(t) || s.lines.some(l => norm(`${l.name} ${l.code}`).includes(t));
  }), [idx, q, status, pay, from, to, archived]);
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="panel"><div className="form">
        <Field label="Search reference, customer or item"><input value={q} onChange={e => setQ(e.target.value)} /></Field>
        <div className="grid c2"><Field label="Sale status"><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></Field><Field label="Payment"><select value={pay} onChange={e => setPay(e.target.value)}><option value="all">All</option><option>Unpaid</option><option>Partial</option><option>Paid</option></select></Field></div>
        <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        {isAdmin && <label className="row"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Include archived records</label>}
      </div></div>
      {rows.length === 0 ? <Empty text="No sales match these filters." /> : <Table>
        <thead><tr><th>Reference</th><th>Date</th><th className="num">Items</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th>By</th></tr></thead>
        <tbody>{rows.slice(0, limit).map(s => <tr key={s.id} className="click" onClick={() => onOpen(s.id)}>
          <td>{s.ref}</td><td className="nowrap">{fmtDT(s.createdAt)}</td><td className="num">{s.items}</td><td className="num">{money(s.total)}</td><td className="num">{money(s.paid)}</td><td className="num">{money(s.balance)}</td>
          <td>{s.status === "cancelled" ? <Badge tone="bad">Cancelled</Badge> : <Badge tone={payTone(s.payStatus)}>{s.payStatus}</Badge>}</td><td>{s.createdByName}</td></tr>)}</tbody>
      </Table>}
      {rows.length > limit && <button className="btn ghost" onClick={() => setLimit(l => l + 50)}>Show more ({rows.length - limit} left)</button>}
    </div>
  );
}
