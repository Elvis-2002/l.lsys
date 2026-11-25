import React, { useState } from "react";
import { useAuth } from "../auth.jsx";
import { useData } from "../store.jsx";
import { updateDoc } from "../records.js";
import { discardQueueItem, resolveEditConflict, retryQueueItem } from "../sync.js";
import { get, put } from "../db.js";
import { Badge, Empty, Modal, Notice, Table, useToast } from "../ui.jsx";
import { fmtDT, nowISO } from "../util.js";
import SaleDetail from "./SaleDetail.jsx";

const SKIP = ["rev", "syncedAt", "updatedAt"];
const diffKeys = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !SKIP.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const show = v => (v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function Conflicts() {
  const { user } = useAuth(); const { data } = useData(); const toast = useToast();
  const [sale, setSale] = useState(null); const [dup, setDup] = useState(null); const [value, setValue] = useState("");
  const open = data.syncConflicts.filter(c => c.status === "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closed = data.syncConflicts.filter(c => c.status !== "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  const stuck = data.queue.filter(q => q.status !== "pending" && !data.syncConflicts.some(c => c.status === "open" && c.id === q.conflictKey));
  const mark = async (c, note) => { await updateDoc("syncConflicts", { ...c, status: "resolved", resolution: note, resolvedBy: user.displayName, resolvedAt: nowISO() }, user.uid); toast("Marked as resolved."); };
  async function fixDuplicate() {
    const c = dup; const rec = await get(c.col, c.docId); const field = { products: "code", sales: "ref", bicycles: "frameNo" }[c.col];
    if (!rec || !value.trim()) return;
    const updated = { ...rec, [field]: value.trim() };
    await put(c.col, updated, { silent: true });
    const queued = await get("queue", c.queueId);
    if (queued) {
      const patch = rows => (rows || []).map(x => x.col === c.col && x.rec?.id === rec.id ? { ...x, rec: { ...x.rec, [field]: value.trim() } } : x);
      await put("queue", { ...queued, creates: patch(queued.creates), updates: patch(queued.updates), status: "pending", error: "", ver: (queued.ver || 0) + 1 }, { silent: true });
    }
    await retryQueueItem(c.queueId); await mark(c, `Changed ${field} to ${value.trim()}`); setDup(null); setValue("");
  }
  return (
    <div className="page">
      <div className="page-head"><h2>Conflicts and sync problems</h2></div>
      <p className="muted">Conflicts are never resolved automatically. When two devices change the same record, or the data no longer adds up after merging, it appears here for you to decide.</p>
      {open.length === 0 && stuck.length === 0 && <Empty text="No conflicts. Everything is consistent." />}
      {open.map(c => (
        <div className="panel" key={c.id}>
          <div className="row between"><h3>{c.title}</h3><Badge tone="bad">Open</Badge></div>
          <p>{c.detail}</p>
          {c.kind === "edit-conflict" && <Table><thead><tr><th>Field</th><th>This device</th><th>Other device (cloud)</th></tr></thead><tbody>{diffKeys(c.local, c.cloud || {}).map(k => <tr key={k}><td>{k}</td><td>{show(c.local?.[k])}</td><td>{show(c.cloud?.[k])}</td></tr>)}</tbody></Table>}
          <div className="row" style={{ marginTop: 10 }}>
            {c.kind === "edit-conflict" && <><button className="btn" onClick={async () => { await resolveEditConflict(c, "local"); await mark(c, "Kept this device"); }}>Keep this device version</button><button className="btn ghost" onClick={async () => { await resolveEditConflict(c, "cloud"); await mark(c, "Kept cloud version"); }}>Keep other version</button></>}
            {c.kind === "dup-index" && <button className="btn" onClick={() => { setDup(c); setValue(""); }}>Give it a new value</button>}
            {c.refs?.saleIds?.map(id => <button key={id} className="btn ghost" onClick={() => setSale(id)}>Open sale {data.sales.find(s => s.id === id)?.ref}</button>)}
            {c.kind === "oversold" && <span className="muted">Fix by cancelling the later sale or adding stock with a purchase or adjustment, then mark resolved.</span>}
            {!["edit-conflict", "dup-index"].includes(c.kind) && <button className="btn ghost" onClick={() => { const n = window.prompt("What did you do to resolve it?"); if (n) mark(c, n); }}>Mark as resolved</button>}
          </div>
        </div>
      ))}
      {stuck.length > 0 && <div className="panel"><h3>Changes this device could not send</h3><Table><thead><tr><th>Record</th><th>Reason</th><th /></tr></thead><tbody>
        {stuck.map(q => <tr key={q.id}><td>{q.id}</td><td>{q.error}</td><td className="nowrap"><button className="btn sm" onClick={() => retryQueueItem(q.id)}>Retry</button> <button className="btn ghost sm" onClick={() => window.confirm("Discard this change? It will not reach the cloud.") && discardQueueItem(q.id)}>Discard</button></td></tr>)}</tbody></Table></div>}
      {closed.length > 0 && <><h3>Recently closed</h3><Table><thead><tr><th>Issue</th><th>Status</th><th>Resolution</th><th>When</th></tr></thead><tbody>{closed.map(c => <tr key={c.id}><td>{c.title}</td><td>{c.status}</td><td>{c.resolution || "Cleared by itself"}</td><td>{fmtDT(c.resolvedAt || c.createdAt)}</td></tr>)}</tbody></Table></>}
      {sale && <SaleDetail saleId={sale} onClose={() => setSale(null)} />}
      {dup && <Modal title="Choose a new value" onClose={() => setDup(null)} footer={<button className="btn accent" onClick={fixDuplicate}>Save and retry</button>}><Notice tone="warn">{dup.detail}</Notice><input value={value} onChange={e => setValue(e.target.value)} placeholder="New unique code, reference or frame number" /></Modal>}
    </div>
  );
}
