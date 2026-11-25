import React, { useMemo, useState } from "react";
import { useData } from "../store.jsx";
import { downloadXlsx, stamp } from "../exports.js";
import { Empty, Field, Notice, Stat, Table } from "../ui.jsx";
import { PAY_METHODS } from "../constants.js";
import { fmtDT, money, num, ymd, startOfMonth } from "../util.js";

export default function Reports() {
  const { data, idx, st } = useData();
  const [from, setFrom] = useState(ymd(startOfMonth())); const [to, setTo] = useState(ymd(new Date()));
  const [product, setProduct] = useState(""); const [category, setCategory] = useState(""); const [who, setWho] = useState(""); const [method, setMethod] = useState("");
  const attendants = useMemo(() => [...new Map(idx.salesView.map(s => [s.createdBy, s.createdByName])).entries()], [idx]);
  const rows = useMemo(() => {
    const eligible = idx.salesView.filter(s => !who || s.createdBy === who);

    // A payment-method report is a cash-received ledger, not a filter that
    // repeats the full sale value for every tender used on a split sale.
    if (method) {
      return eligible.flatMap(s => s.payments.filter(p => {
        const day = ymd(p.at || s.createdAt);
        return p.method === method && Number(p.amount) > 0 && (!from || day >= from) && (!to || day <= to);
      }).map(p => ({
        day: ymd(p.at || s.createdAt), ref: s.ref, at: p.at || s.createdAt,
        item: `Payment received · ${p.method}`, qty: 0, revenue: Number(p.amount), cost: null, profit: null,
        who: s.createdByName, cat: "Payments", paymentId: p.id, saleStatus: s.status
      }))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    }

    const out = [];
    for (const s of eligible) {
      if (s.status !== "completed") continue;
      const saleDay = ymd(s.createdAt);
      if ((from && saleDay < from) || (to && saleDay > to)) continue;
      for (const l of s.lines) {
        const p = l.kind === "part" ? idx.productById.get(l.productId) : null;
        const cat = l.kind === "bike" ? "Bicycles" : p?.category || "";
        if (product && (l.productId || l.bikeId) !== product) continue;
        if (category && cat !== category) continue;
        const revenue = l.qty * l.unitPrice - (l.discount || 0);
        const cost = idx.lineCostById.get(l.id) ?? null;
        out.push({ day: ymd(s.createdAt), ref: s.ref, at: s.createdAt, item: l.name, qty: l.qty, revenue, cost, profit: cost == null ? null : revenue - cost, who: s.createdByName, cat });
      }
    }
    return out;
  }, [idx, from, to, product, category, who, method]);

  const daily = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const d = m.get(r.day) || { day: r.day, revenue: 0, items: 0, profit: 0, profitKnown: true };
      d.revenue += r.revenue;
      d.items += r.qty;
      if (r.profit == null) d.profitKnown = false; else d.profit += r.profit;
      m.set(r.day, d);
    }
    return [...m.values()].sort((a, b) => b.day.localeCompare(a.day));
  }, [rows]);
  const totalRevenue = rows.reduce((t, r) => t + r.revenue, 0);
  const totalItems = rows.reduce((t, r) => t + (r.qty || 0), 0);
  const totalProfit = rows.every(r => r.profit != null) ? rows.reduce((t, r) => t + r.profit, 0) : null;
  const salesCount = new Set(rows.map(r => r.ref)).size;
  const items = [...data.products.map(p => [p.id, `${p.code} · ${p.name}`]), ...data.bicycles.map(b => [b.id, `${b.brand} ${b.model} · ${b.frameNo}`])];

  const exportRows = method
    ? rows.map(r => ({ Date: fmtDT(r.at), Reference: r.ref, "Sale status": r.saleStatus, "Payment method": method, "Amount received (UGX)": r.revenue, Attendant: r.who }))
    : rows.map(r => ({ Date: fmtDT(r.at), Reference: r.ref, Item: r.item, Category: r.cat, Quantity: r.qty, "Revenue (UGX)": r.revenue, "Cost (UGX)": r.cost ?? "Unknown", "Profit (UGX)": r.profit ?? "Unknown", Attendant: r.who }));
  const dailyExport = daily.map(d => ({ Date: d.day, [method ? "Amount received (UGX)" : "Revenue (UGX) difference"]: d.revenue, ...(method ? {} : { "Items sold": d.items, "Profit (UGX)": d.profitKnown ? d.profit : "Unknown" }) }));

  return (
    <div className="page">
      <div className="page-head"><h2>Sales and profit reports</h2><button className="btn ghost" onClick={() => downloadXlsx({ "Daily summary": dailyExport, Details: exportRows }, `sales-report-${stamp()}.xlsx`)}>Export to Excel</button></div>
      <div className="panel"><div className="form">
        <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label="Product or bicycle"><select value={product} disabled={!!method} onChange={e => setProduct(e.target.value)}><option value="">All</option>{items.map(([id, t]) => <option key={id} value={id}>{t}</option>)}</select></Field>
        <Field label="Category"><select value={category} disabled={!!method} onChange={e => setCategory(e.target.value)}><option value="">All</option>{[...(st.categories || []).map(c => c.name), "Bicycles"].map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Attendant"><select value={who} onChange={e => setWho(e.target.value)}><option value="">All</option>{attendants.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Field>
        <Field label="Payment method"><select value={method} onChange={e => setMethod(e.target.value)}><option value="">All sales (line revenue)</option>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
      </div></div>
      {method && <Notice tone="info">Showing actual money received through {method}. Product/category filters are disabled because a payment can cover multiple sale lines. Profit is not attributed to individual payment methods.</Notice>}
      <div className="grid c3">
        <Stat label={method ? "Amount received" : "Revenue"} value={money(totalRevenue)} />
        <Stat label={method ? "Sales with this payment" : "Items sold"} value={method ? num(salesCount) : num(totalItems)} />
        <Stat label="Profit" value={method ? "Not allocated" : totalProfit == null ? "Unknown cost" : money(totalProfit)} sub={method ? "Payment method does not determine item cost" : "Revenue minus recorded cost"} />
      </div>
      <h3>Daily summary</h3>
      {daily.length === 0 ? <Empty text="No records match these filters." /> : <Table><thead><tr><th>Date</th><th className="num">{method ? "Amount received" : "Revenue"}</th>{!method && <><th className="num">Items sold</th><th className="num">Profit</th></>}</tr></thead><tbody>{daily.map(d => <tr key={d.day}><td>{d.day}</td><td className="num">{money(d.revenue)}</td>{!method && <><td className="num">{num(d.items)}</td><td className="num">{d.profitKnown ? money(d.profit) : "Unknown"}</td></>}</tr>)}</tbody></Table>}
      <h3>{method ? "Payment receipts" : "Sale lines"}</h3>
      {rows.length > 0 && <Table><thead>{method ? <tr><th>Date</th><th>Reference</th><th>Sale status</th><th>Payment method</th><th className="num">Amount received</th><th>Attendant</th></tr> : <tr><th>Date</th><th>Reference</th><th>Item</th><th className="num">Qty</th><th className="num">Revenue</th><th className="num">Profit</th><th>Attendant</th></tr>}</thead><tbody>{rows.slice(0, 300).map((r, i) => method ? <tr key={r.paymentId || i}><td className="nowrap">{fmtDT(r.at)}</td><td>{r.ref}</td><td>{r.saleStatus}</td><td>{method}</td><td className="num">{money(r.revenue)}</td><td>{r.who}</td></tr> : <tr key={i}><td className="nowrap">{fmtDT(r.at)}</td><td>{r.ref}</td><td>{r.item}</td><td className="num">{r.qty}</td><td className="num">{money(r.revenue)}</td><td className="num">{r.profit == null ? "Unknown" : money(r.profit)}</td><td>{r.who}</td></tr>)}</tbody></Table>}
      {rows.length > 300 && <p className="muted">Showing the first 300 records. Export to Excel for all {rows.length}.</p>}
    </div>
  );
}
