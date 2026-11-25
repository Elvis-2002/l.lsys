import React, { useMemo } from "react";
import { useData } from "../store.jsx";
import { lowStockProducts } from "../logic.js";
import { Badge, Notice, Stat, Table, useNav } from "../ui.jsx";
import { addMonths, addDays, money, num, startOfDay, startOfMonth, startOfWeek } from "../util.js";

function Compare({ title, now, prev, nowLabel, prevLabel }) {
  const max = Math.max(now, prev, 1);
  return (
    <div className="panel"><h3>{title}</h3><div className="bars">
      <div className="bar"><span>{nowLabel}</span><i style={{ width: `${(now / max) * 100}%` }} /><b>{money(now)}</b></div>
      <div className="bar"><span>{prevLabel}</span><i className="prev" style={{ width: `${(prev / max) * 100}%` }} /><b>{money(prev)}</b></div>
    </div><small className="muted">{prev > 0 ? `${now >= prev ? "Up" : "Down"} ${Math.abs(Math.round(((now - prev) / prev) * 100))}% compared with the previous period` : "No sales in the previous period yet"}</small></div>
  );
}

export default function Dashboard() {
  const { data, idx, st, openConflicts, sync } = useData();
  const nav = useNav();
  const d = useMemo(() => {
    const done = idx.salesView.filter(s => s.status === "completed");
    const sum = (list, f) => list.reduce((t, s) => t + f(s), 0);
    const between = (a, b) => done.filter(s => { const t = new Date(s.createdAt); return t >= a && t < b; });
    const now = new Date(), day = startOfDay(now), wk = startOfWeek(now), mo = startOfMonth(now);
    const today = between(day, addDays(day, 1));
    const wkPrev = between(addDays(wk, -7), wk), moPrev = between(addMonths(mo, -1), mo);
    const bikes = data.bicycles.filter(b => !b.archived);
    return {
      today: sum(today, s => s.total), items: sum(today, s => s.items),
      profitToday: today.every(s => s.profit != null) ? sum(today, s => s.profit) : null,
      profitAll: done.every(s => s.profit != null) ? sum(done, s => s.profit) : null,
      week: sum(between(wk, addDays(now, 1)), s => s.total), weekPrev: sum(wkPrev, s => s.total),
      month: sum(between(mo, addDays(now, 1)), s => s.total), monthPrev: sum(moPrev, s => s.total),
      stockUnits: data.products.filter(p => !p.archived).reduce((t, p) => t + Math.max(0, idx.stock.get(p.id) || 0), 0),
      avail: bikes.filter(b => idx.bikes.get(b.id)?.status === "Available").length, reserved: bikes.filter(b => idx.bikes.get(b.id)?.status === "Reserved").length,
      owed: sum(done.filter(s => s.balance > 0), s => s.balance), owedCount: done.filter(s => s.balance > 0).length
    };
  }, [data, idx]);
  const low = lowStockProducts(data, idx, st);
  return (
    <div className="page">
      <div className="page-head"><h2>Dashboard</h2></div>
      {openConflicts > 0 && <Notice tone="bad">{openConflicts} record(s) need your decision. <button className="btn sm" onClick={() => nav.go("conflicts")}>Review conflicts</button></Notice>}
      {sync.failed > 0 && <Notice tone="warn">{sync.failed} change(s) on this device could not sync. Open Conflicts to see why.</Notice>}
      <div className="grid auto">
        <Stat label="Total sales today" value={money(d.today)} />
        <Stat label="Items sold today" value={num(d.items)} />
        <Stat label="Profit today" value={d.profitToday == null ? "Unknown cost" : money(d.profitToday)} />
        <Stat label="Total profit" value={d.profitAll == null ? "Unknown cost" : money(d.profitAll)} sub="All completed sales" />
        <Stat label="Spare parts in stock" value={num(d.stockUnits)} sub="Units" />
        <Stat label="Low-stock products" value={low.length} tone={low.length ? "warn" : ""} sub={`At or below ${st.lowStock}`} />
        <Stat label="Available bicycles" value={d.avail} />
        <Stat label="Reserved bicycles" value={d.reserved} />
        <Stat label="Outstanding balances" value={money(d.owed)} sub={`${d.owedCount} sale(s)`} tone={d.owed ? "warn" : ""} />
      </div>
      <div className="grid c2">
        <Compare title="Weekly sales" now={d.week} prev={d.weekPrev} nowLabel="This week" prevLabel="Last week" />
        <Compare title="Monthly sales" now={d.month} prev={d.monthPrev} nowLabel="This month" prevLabel="Last month" />
      </div>
      <div className="panel"><h3>Products needing restock</h3>
        {low.length === 0 ? <p className="muted">All products are above the alert level.</p> : <Table><thead><tr><th>Code</th><th>Product</th><th className="num">In stock</th><th /></tr></thead><tbody>
          {low.sort((a, b) => a.qty - b.qty).slice(0, 15).map(({ p, qty }) => <tr key={p.id} className="click" onClick={() => nav.go("inventory", { focus: p.id })}><td>{p.code}</td><td>{p.name}</td><td className="num">{qty}</td><td>{qty <= 0 ? <Badge tone="bad">Out of stock</Badge> : <Badge tone="warn">Low</Badge>}</td></tr>)}</tbody></Table>}
      </div>
    </div>
  );
}
