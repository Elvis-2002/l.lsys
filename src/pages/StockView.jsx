import React, { useMemo, useState } from "react";
import { useData } from "../store.jsx";
import { Badge, Empty, Field, Table } from "../ui.jsx";
import { norm } from "../util.js";

export default function StockView() {
  const { data, idx, st } = useData();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [availability, setAvailability] = useState("all");
  const rows = useMemo(() => data.products.filter(p => {
    if (p.archived) return false;
    if (category !== "All" && p.category !== category) return false;
    const qty = idx.stock.get(p.id) || 0;
    if (availability === "in" && qty <= 0) return false;
    if (availability === "out" && qty > 0) return false;
    if (availability === "low" && (qty > st.lowStock || qty <= 0)) return false;
    return !q || norm(`${p.name} ${p.code} ${p.category} ${Object.values(p.attrs || {}).join(" ")}`).includes(norm(q));
  }).sort((a,b) => a.name.localeCompare(b.name)), [data.products, idx.stock, category, availability, q, st.lowStock]);
  return <div className="page"><div className="page-head"><h2>View stock</h2></div>
    <div className="panel"><div className="form">
      <Field label="Search products"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Name, code or details" /></Field>
      <Field label="Category"><select value={category} onChange={e=>setCategory(e.target.value)}><option>All</option>{st.categories.map(c=><option key={c.name}>{c.name}</option>)}</select></Field>
      <Field label="Stock status"><select value={availability} onChange={e=>setAvailability(e.target.value)}><option value="all">All stock</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select></Field>
    </div></div>
    {rows.length ? <Table><thead><tr><th>Product</th><th>Category</th><th>Details</th><th className="num">Quantity available</th><th>Status</th></tr></thead><tbody>{rows.map(p=>{const qty=idx.stock.get(p.id)||0;return <tr key={p.id}><td><b>{p.name}</b><div className="muted">{p.code}</div></td><td>{p.category}</td><td>{Object.entries(p.attrs||{}).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(" · ")||"—"}</td><td className="num">{qty}</td><td>{qty<=0?<Badge tone="bad">Out of stock</Badge>:qty<=st.lowStock?<Badge tone="warn">Low</Badge>:<Badge tone="ok">Available</Badge>}</td></tr>})}</tbody></Table> : <Empty text="No matching stock records." />}
  </div>;
}
