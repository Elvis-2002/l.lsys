import React, { useMemo, useState } from "react";
import { useData } from "../store.jsx";
import { Badge, Empty, Stat, Table } from "../ui.jsx";
import { fmtD, money } from "../util.js";
import SaleDetail, { payTone } from "./SaleDetail.jsx";

export default function Balances() {
  const { idx } = useData();
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => idx.salesView.filter(s => s.status === "completed" && s.balance > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [idx]);
  const total = rows.reduce((t, s) => t + s.balance, 0);
  return (
    <div className="page">
      <div className="page-head"><h2>Outstanding balances</h2></div>
      <div className="grid c3"><Stat label="Total still owed" value={money(total)} tone={total ? "warn" : ""} /><Stat label="Sales with a balance" value={rows.length} /></div>
      {rows.length === 0 ? <Empty text="No outstanding balances. Every completed sale is fully paid." /> : (
        <Table><thead><tr><th>Sale reference</th><th>Customer</th><th>Date</th><th className="num">Original amount</th><th className="num">Amount paid</th><th className="num">Remaining balance</th><th>Payment status</th></tr></thead>
          <tbody>{rows.map(s => <tr key={s.id} className="click" onClick={() => setOpen(s.id)}><td>{s.ref}</td><td>{s.customerName || "—"}</td><td>{fmtD(s.createdAt)}</td><td className="num">{money(s.total)}</td><td className="num">{money(s.paid)}</td><td className="num"><b>{money(s.balance)}</b></td><td><Badge tone={payTone(s.payStatus)}>{s.payStatus}</Badge></td></tr>)}</tbody></Table>
      )}
      {open && <SaleDetail saleId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
