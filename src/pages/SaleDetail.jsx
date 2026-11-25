import React, { useState } from "react";
import { useAuth } from "../auth.jsx";
import { useData } from "../store.jsx";
import { commitGroup } from "../records.js";
import { Badge, Field, Modal, Notice, Table, useNav, useToast } from "../ui.jsx";
import { PAY_METHODS } from "../constants.js";
import { fmtDT, money, norm, nowISO, uuid } from "../util.js";

export const payTone = s => (s === "Paid" ? "ok" : s === "Partial" ? "warn" : "bad");

export default function SaleDetail({ saleId, onClose }) {
  const { user } = useAuth();
  const { data, idx, isAdmin } = useData();
  const nav = useNav(); const toast = useToast();
  const [mode, setMode] = useState(null); // "pay" | "cancel"
  const [amount, setAmount] = useState(""); const [method, setMethod] = useState(PAY_METHODS[0]); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const s = idx.saleById.get(saleId);
  const raw = data.sales.find(x => x.id === saleId);
  if (!s || !raw) return <Modal title="Sale not found" onClose={onClose}><p>This sale is not on this device yet.</p></Modal>;
  const cancelled = s.status === "cancelled";
  const audit = data.saleAudit.filter(a => a.saleId === saleId).sort((a, b) => a.at.localeCompare(b.at));
  const logAudit = (action, extra = {}) => ({ col: "saleAudit", rec: { id: uuid(), saleId, action, by: user.uid, byName: user.displayName, at: nowISO(), ...extra } });

  async function pay() {
    const n = Math.round(Number(amount));
    if (!(n > 0)) return setErr("Enter an amount greater than 0.");
    if (n > s.balance) return setErr(`The amount is more than the remaining balance (${money(s.balance)}).`);
    if (!Number.isFinite(Number(raw.total)) || raw.paidTotal === undefined) return setErr("This older sale is being updated for secure payment tracking. Ask the administrator to sync this device, then try again.");
    setBusy(true);
    try {
      const paymentId = uuid();
      await commitGroup(
        [{ col: "payments", rec: { id: paymentId, saleId, amount: n, method, at: nowISO(), kind: "extra" } }],
        [{ col: "sales", rec: { ...raw, paidTotal: s.paid + n, lastPaymentId: paymentId, lastPaymentAmount: n } }],
        user.uid
      );
      setMode(null); setAmount(""); setErr(""); toast(n === s.balance ? "Balance cleared. Sale is fully paid." : "Payment recorded.");
    } catch (e) { setErr(e?.message || "Could not record payment."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!reason.trim()) return setErr("A cancellation reason is required.");
    setBusy(true);
    try {
      const at = nowISO();
      await commitGroup([logAudit("cancelled", { reason: reason.trim() })], [
        { col: "sales", rec: { ...raw, status: "cancelled", cancel: { reason: reason.trim(), by: user.uid, byName: user.displayName, at } } }
      ], user.uid);
      setMode(null); toast("Sale cancelled. Stock returned to inventory.");
    } catch (e) { setErr(e?.message || "Could not cancel sale."); }
    finally { setBusy(false); }
  }
  async function editRef() {
    const next = window.prompt("New sale reference", s.ref)?.trim();
    if (!next || next === s.ref) return;
    if (data.sales.some(x => x.id !== s.id && norm(x.ref) === norm(next))) return toast("That reference is already used.", "bad");
    try {
      await commitGroup([logAudit("reference edited", { reason: "Reference changed", changes: { from: s.ref, to: next } })], [
        { col: "sales", rec: { ...raw, ref: next } }
      ], user.uid);
      toast("Reference updated.");
    } catch (e) { toast(e?.message || "Could not update reference.", "bad"); }
  }

  return (
    <Modal wide title={`Sale ${s.ref}`} onClose={onClose} footer={<>
      {!cancelled && s.balance > 0 && <button className="btn accent" onClick={() => { setMode("pay"); setErr(""); setAmount(String(s.balance)); }}>Add payment</button>}
      {!cancelled && <button className="btn ghost" onClick={() => { onClose(); nav.go("sales", { tab: "new", correct: s.id }); }}>Correct sale</button>}
      {!cancelled && <button className="btn danger" onClick={() => { setMode("cancel"); setErr(""); }}>Cancel sale</button>}
      {isAdmin && <button className="btn ghost" onClick={editRef}>Edit reference</button>}
    </>}>
      <div className="row between">
        <div className="row"><Badge tone={cancelled ? "bad" : "ok"}>{cancelled ? "Cancelled" : "Completed"}</Badge>{!cancelled && <Badge tone={payTone(s.payStatus)}>{s.payStatus}</Badge>}{raw.archived && <Badge>Archived</Badge>}</div>
        <span className="muted">{fmtDT(s.createdAt)} · {s.createdByName}</span>
      </div>
      {s.customerName && <p><b>Credit customer:</b> {s.customerName}</p>}
      {cancelled && <Notice tone="bad">Cancelled by {raw.cancel?.byName} on {fmtDT(raw.cancel?.at)}. Reason: {raw.cancel?.reason}{s.paid > 0 && ` · ${money(s.paid)} was paid and may need to be refunded to the buyer.`}</Notice>}
      <Table>
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Line total</th>{isAdmin && <th className="num">Cost</th>}</tr></thead>
        <tbody>{s.lines.map(l => {
          const cost = isAdmin ? idx.lineCostById.get(l.id) : null;
          return <tr key={l.id}><td>{l.name}<div className="muted">{l.code}{l.kind === "bike" ? " · bicycle" : ""}{(l.alloc || []).some(a => a.override) ? " · stock override" : ""}</div></td><td className="num">{l.qty}</td><td className="num">{money(l.unitPrice)}</td><td className="num">{l.discount ? money(l.discount) : "—"}</td><td className="num">{money(l.qty * l.unitPrice - (l.discount || 0))}</td>{isAdmin && <td className="num">{cost === null || cost === undefined ? "Unknown" : money(cost)}</td>}</tr>;
        })}</tbody>
      </Table>
      <div className="grid c3">
        <div className="kv" style={{ gridTemplateColumns: "1fr auto" }}><span className="muted">Original amount</span><b>{money(s.total)}</b><span className="muted">Amount paid</span><b>{money(s.paid)}</b><span className="muted">Remaining balance</span><b>{money(s.balance)}</b></div>
        {isAdmin && <div className="kv" style={{ gridTemplateColumns: "1fr auto" }}><span className="muted">Cost of goods</span><b>{s.cost == null ? "Unknown" : money(s.cost)}</b><span className="muted">Profit</span><b>{s.profit == null ? "Not available" : money(s.profit)}</b></div>}
      </div>
      <h3>Payments</h3>
      {s.payments.length ? <Table><thead><tr><th>Date and time</th><th>Method</th><th className="num">Amount</th></tr></thead><tbody>{s.payments.map(p => <tr key={p.id}><td>{fmtDT(p.at)}</td><td>{p.method}{p.kind === "deposit" ? " (reservation deposit)" : ""}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></Table> : <p className="muted">No payment recorded yet.</p>}
      {mode === "pay" && <div className="panel"><div className="form"><Field label="Amount (UGX)"><input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} /></Field><Field label="Method"><select value={method} onChange={e => setMethod(e.target.value)}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field></div>{err && <p style={{ color: "var(--bad)" }}>{err}</p>}<div className="row end"><button className="btn ghost" onClick={() => setMode(null)}>Close</button><button className="btn" disabled={busy} onClick={pay}>Save payment</button></div></div>}
      {mode === "cancel" && <div className="panel"><Field label="Reason for cancelling (required)"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>{err && <p style={{ color: "var(--bad)" }}>{err}</p>}<div className="row end"><button className="btn ghost" onClick={() => setMode(null)}>Keep sale</button><button className="btn danger" disabled={busy} onClick={cancel}>Cancel this sale</button></div></div>}
      <h3>History of changes</h3>
      <Table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Reason</th></tr></thead><tbody>
        {audit.length === 0 && <tr><td colSpan="4" className="muted">No changes recorded.</td></tr>}
        {audit.map(a => <tr key={a.id}><td>{fmtDT(a.at)}</td><td>{a.byName}</td><td>{a.action}{a.changes ? `: ${a.changes.from} → ${a.changes.to}` : ""}{a.note ? ` (${a.note})` : ""}</td><td>{a.reason || "—"}</td></tr>)}
      </tbody></Table>
    </Modal>
  );
}
