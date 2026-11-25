import React, { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "../auth.jsx";
import { useData } from "../store.jsx";
import { allocateFIFO, lowStockProducts } from "../logic.js";
import { createGroup, updateDoc } from "../records.js";
import { Badge, Empty, Field, ImagePicker, Modal, Notice, Table, useNav, useToast } from "../ui.jsx";
import { CONDITIONS, GRADES } from "../constants.js";
import { fmtDT, money, norm, nowISO, uuid } from "../util.js";

function nextCode(category, products, categories = []) {
  const prefix = categories.find(c => c.name === category)?.prefix || "PRD";
  let max = 0;
  for (const p of products) { const m = String(p.code || "").match(new RegExp(`^${prefix}-(\\d+)$`)); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export default function Inventory() {
  const { data, idx, st } = useData();
  const nav = useNav();
  const [q, setQ] = useState(""); const [cat, setCat] = useState("All"); const [onlyLow, setOnlyLow] = useState(false); const [archived, setArchived] = useState(false);
  const [form, setForm] = useState(null); const [adjust, setAdjust] = useState(null); const [detail, setDetail] = useState(nav.params.focus || null);
  const low = useMemo(() => new Set(lowStockProducts(data, idx, st).map(x => x.p.id)), [data, idx, st]);
  const rows = useMemo(() => data.products.filter(p => {
    if (!archived && p.archived) return false;
    if (cat !== "All" && p.category !== cat) return false;
    if (onlyLow && !low.has(p.id)) return false;
    const s = norm(q); return !s || norm(`${p.name} ${p.code} ${Object.values(p.attrs || {}).join(" ")}`).includes(s);
  }).sort((a, b) => a.code.localeCompare(b.code)), [data.products, q, cat, onlyLow, archived, low]);
  const lastCost = p => { const bs = idx.batchesByProduct.get(p.id); return bs?.length ? idx.batchCost.get(bs[bs.length - 1].id) : null; };

  return (
    <div className="page">
      <div className="page-head"><h2>Spare parts</h2><button className="btn accent" disabled={!st.categories.length} onClick={() => setForm({})}><Plus size={16} /> Add product</button></div>
      <div className="panel"><div className="form">
        <Field label="Search name, code or details"><input value={q} onChange={e => setQ(e.target.value)} /></Field>
        <Field label="Category"><select value={cat} onChange={e => setCat(e.target.value)}><option>All</option>{st.categories.map(c => <option key={c.name}>{c.name}</option>)}</select></Field>
        <label className="row"><input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} /> Low or out of stock only</label>
        <label className="row"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived products</label>
      </div></div>
      {!st.categories.length ? <Empty text="No product categories yet. Create your own categories in Settings before adding products." /> : rows.length === 0 ? <Empty text="No products yet. Use Add product, then record a purchase to bring stock in." /> : (
        <Table><thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Grade</th><th className="num">Selling price</th><th className="num">Latest cost</th><th className="num">Stock</th><th /></tr></thead>
          <tbody>{rows.map(p => { const s = idx.stock.get(p.id) || 0; return (
            <tr key={p.id}>
              <td className="nowrap">{p.code}</td>
              <td><div className="row" style={{ flexWrap: "nowrap" }}>{p.imageUrl && <img className="thumb" src={p.imageUrl} alt="" />}<span>{p.name}{p.archived && <> <Badge>Archived</Badge></>}<div className="muted">{[p.attrs?.size, p.attrs?.brand, p.attrs?.colour, p.condition].filter(Boolean).join(" · ")}</div></span></div></td>
              <td>{p.category}</td><td>{p.attrs?.grade || "—"}</td><td className="num">{money(p.sellPrice)}</td><td className="num">{lastCost(p) == null ? "—" : money(lastCost(p))}</td>
              <td className="num">{s} {s <= 0 ? <Badge tone="bad">Out</Badge> : low.has(p.id) ? <Badge tone="warn">Low</Badge> : null}</td>
              <td className="nowrap"><button className="btn ghost sm" onClick={() => setDetail(p.id)}>Details</button> <button className="btn ghost sm" onClick={() => setForm(p)}>Edit</button> <button className="btn ghost sm" onClick={() => setAdjust(p)}>Adjust</button></td>
            </tr>); })}</tbody></Table>
      )}
      {form && <ProductForm product={form.id ? form : null} onClose={() => setForm(null)} />}
      {adjust && <AdjustModal product={adjust} onClose={() => setAdjust(null)} />}
      {detail && <Details productId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ProductForm({ product, onClose }) {
  const { user } = useAuth(); const { data, st } = useData(); const toast = useToast();
  const [f, setF] = useState(() => product ? { ...product, attrs: { ...(product.attrs || {}) }, sellPrice: String(product.sellPrice) } : { category: st.categories[0]?.name || "", condition: "New", attrs: {}, sellPrice: "", name: "", code: "", imageUrl: "" });
  const [err, setErr] = useState("");
  const categoryConfig = st.categories.find(c => c.name === f.category) || { fields: [], single: f.category };
  const fields = categoryConfig.fields || [];
  const code = f.code || nextCode(f.category, data.products, st.categories);
  const setAttr = (k, v) => setF(x => ({ ...x, attrs: { ...x.attrs, [k]: v } }));

  async function save() {
    const price = Math.round(Number(f.sellPrice));
    const finalCode = code.trim();
    const name = f.name.trim() || [categoryConfig.single || f.category, ...fields.map(fd => f.attrs[fd.key])].filter(Boolean).join(" ");
    if (!finalCode) return setErr("Product code is required.");
    if (data.products.some(p => p.id !== product?.id && norm(p.code) === norm(finalCode))) return setErr("This product code is already used. Product codes must be unique.");
    if (!(price >= 0) || f.sellPrice === "") return setErr("Enter the selling price.");
    if (product && norm(product.code) !== norm(finalCode) && !window.confirm(`Change the product code from ${product.code} to ${finalCode}?`)) return;
    const attrs = Object.fromEntries(Object.entries(f.attrs).filter(([, v]) => String(v).trim()));
    const rec = { id: product?.id || uuid(), code: finalCode, name, category: f.category, condition: f.condition, attrs, imageUrl: f.imageUrl || "", sellPrice: price, archived: !!product?.archived, createdAt: product?.createdAt || nowISO() };
    const history = (old, now) => ({ col: "priceHistory", rec: { id: uuid(), productId: rec.id, oldPrice: old, newPrice: now, at: nowISO(), by: user.uid, byName: user.displayName } });
    if (product) {
      await updateDoc("products", { ...product, ...rec }, user.uid);
      if (product.sellPrice !== price) await createGroup([history(product.sellPrice, price)], user.uid);
    } else await createGroup([{ col: "products", rec }, history(0, price)], user.uid);
    toast(product ? "Product updated." : "Product added."); onClose();
  }
  return (
    <Modal wide title={product ? "Edit product" : "Add product"} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn accent" onClick={save}>Save product</button></>}>
      <div className="form">
        <Field label="Category"><select value={f.category} disabled={!!product || !st.categories.length} onChange={e => setF({ ...f, category: e.target.value, attrs: {} })}>{st.categories.map(c => <option key={c.name}>{c.name}</option>)}</select></Field>
        <Field label="Product code" hint={product ? "Changing a code asks for confirmation." : "Generated automatically. You can edit it."}><input value={f.code || (product ? "" : code)} placeholder={code} onChange={e => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Product name" full><input value={f.name} placeholder="Leave blank to build the name from the details below" onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        {fields.map(fd => <Field key={fd.key} label={fd.label}>{fd.options?.length ? <select value={f.attrs[fd.key] || ""} onChange={e => setAttr(fd.key, e.target.value)}><option value="">Choose {fd.label.toLowerCase()}</option>{fd.options.map(v => <option key={v}>{v}</option>)}</select> : <input value={f.attrs[fd.key] || ""} onChange={e => setAttr(fd.key, e.target.value)} />}</Field>)}
        <datalist id="grades">{GRADES.map(g => <option key={g} value={g} />)}</datalist>
        <Field label="Condition" hint="New or used. Japan is a quality grade, not a condition."><select value={f.condition} onChange={e => setF({ ...f, condition: e.target.value })}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Selling price (UGX)" hint={product ? "A new price applies to all remaining stock, including older batches." : undefined}><input type="number" min="0" value={f.sellPrice} onChange={e => setF({ ...f, sellPrice: e.target.value })} /></Field>
        <Field label="Image (optional)" full><ImagePicker value={f.imageUrl} onChange={v => setF({ ...f, imageUrl: v })} /></Field>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {product && <button className="btn ghost" onClick={async () => { await updateDoc("products", { ...product, archived: !product.archived }, user.uid); toast(product.archived ? "Product restored." : "Product archived. Its sales history stays available."); onClose(); }}>{product.archived ? "Restore product" : "Archive product"}</button>}
    </Modal>
  );
}

function AdjustModal({ product, onClose }) {
  const { user } = useAuth(); const { idx } = useData(); const toast = useToast();
  const stock = idx.stock.get(product.id) || 0;
  const bs = idx.batchesByProduct.get(product.id) || [];
  const lastCost = bs.length ? idx.batchCost.get(bs[bs.length - 1].id) || 0 : 0;
  const [dir, setDir] = useState("increase"); const [qty, setQty] = useState(""); const [reason, setReason] = useState(""); const [cost, setCost] = useState(String(lastCost)); const [err, setErr] = useState("");
  async function save() {
    const n = Math.floor(Number(qty));
    if (!(n > 0)) return setErr("Enter a quantity above 0.");
    if (!reason.trim()) return setErr("A reason is required for every manual adjustment.");
    const id = uuid(); const at = nowISO();
    const base = { id, productId: product.id, reason: reason.trim(), at, by: user.uid, byName: user.displayName };
    if (dir === "increase") {
      const batchId = `${id}_b`;
      await createGroup([
        { col: "adjustments", rec: { ...base, change: n, batchId } },
        { col: "batchStock", rec: { id: batchId, productId: product.id, qty: n, receivedAt: at, source: "adjustment", adjustmentId: id } },
        { col: "batchCosts", rec: { id: batchId, productId: product.id, unitCost: Math.max(0, Math.round(Number(cost) || 0)) } }
      ], user.uid);
    } else {
      const alloc = allocateFIFO(product.id, n, idx);
      if (!alloc) return setErr(`You can only remove up to ${stock}. Stock cannot go below 0.`);
      await createGroup([{ col: "adjustments", rec: { ...base, change: -n, alloc } }], user.uid);
    }
    toast("Stock adjusted."); onClose();
  }
  return (
    <Modal title={`Adjust stock: ${product.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn accent" onClick={save}>Save adjustment</button></>}>
      <p className="muted">Current stock: <b>{stock}</b>. This does not record a purchase.</p>
      <div className="form">
        <Field label="Change"><select value={dir} onChange={e => setDir(e.target.value)}><option value="increase">Increase stock</option><option value="decrease">Decrease stock</option></select></Field>
        <Field label="Quantity"><input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} /></Field>
        {dir === "increase" && <Field label="Cost per unit (UGX)" hint="Used for profit when these units are sold." full><input type="number" min="0" value={cost} onChange={e => setCost(e.target.value)} /></Field>}
        <Field label="Reason (required)" full><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
    </Modal>
  );
}

function Details({ productId, onClose }) {
  const { data, idx, st } = useData();
  const p = idx.productById.get(productId);
  const purchaseByBatch = useMemo(() => { const m = new Map(); for (const pu of data.purchases) for (const l of pu.lines || []) m.set(l.batchId, pu); return m; }, [data.purchases]);
  if (!p) return null;
  const bs = idx.batchesByProduct.get(p.id) || [];
  return (
    <Modal wide title={`${p.code} · ${p.name}`} onClose={onClose}>
      <div className="grid c3"><div className="stat"><span>In stock</span><b>{idx.stock.get(p.id) || 0}</b><small>Alert at {st.lowStock} or fewer</small></div><div className="stat"><span>Selling price</span><b>{money(p.sellPrice)}</b></div><div className="stat"><span>Category</span><b style={{ fontSize: "1rem" }}>{p.category}</b></div></div>
      <h3>Stock batches (oldest sold first)</h3>
      {bs.length === 0 ? <p className="muted">No stock received yet.</p> : <Table><thead><tr><th>Received</th><th>Source</th><th>Supplier / invoice</th><th className="num">Received qty</th><th className="num">Left</th><th className="num">Cost each</th></tr></thead><tbody>
        {bs.map(b => { const pu = purchaseByBatch.get(b.id); return <tr key={b.id}><td>{fmtDT(b.receivedAt)}</td><td>{b.source === "adjustment" ? "Adjustment" : "Purchase"}</td><td>{pu ? `${pu.supplier} · ${pu.invoiceNo || "no invoice no."}` : "—"}</td><td className="num">{b.qty}</td><td className="num">{idx.remaining.get(b.id) || 0}</td><td className="num">{money(idx.batchCost.get(b.id) || 0)}</td></tr>; })}</tbody></Table>}
      <h3>Selling price history</h3>
      <Table><thead><tr><th>When</th><th className="num">Previous</th><th className="num">New</th><th>Administrator</th></tr></thead><tbody>
        {data.priceHistory.filter(h => h.productId === p.id).sort((a, b) => b.at.localeCompare(a.at)).map(h => <tr key={h.id}><td>{fmtDT(h.at)}</td><td className="num">{h.oldPrice ? money(h.oldPrice) : "—"}</td><td className="num">{money(h.newPrice)}</td><td>{h.byName}</td></tr>)}</tbody></Table>
      <h3>Manual adjustments</h3>
      <Table><thead><tr><th>When</th><th className="num">Change</th><th>Reason</th><th>By</th></tr></thead><tbody>
        {data.adjustments.filter(a => a.productId === p.id).sort((a, b) => b.at.localeCompare(a.at)).map(a => <tr key={a.id}><td>{fmtDT(a.at)}</td><td className="num">{a.change > 0 ? `+${a.change}` : a.change}</td><td>{a.reason}</td><td>{a.byName}</td></tr>)}</tbody></Table>
    </Modal>
  );
}
