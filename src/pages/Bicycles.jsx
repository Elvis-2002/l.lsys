import React, { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "../auth.jsx";
import { useData } from "../store.jsx";
import { commitGroup, createGroup, updateDoc } from "../records.js";
import { Badge, Empty, Field, ImagePicker, Modal, Notice, Table, useNav, useToast } from "../ui.jsx";
import { BIKE_TYPES, CONDITIONS, PAY_METHODS } from "../constants.js";
import { fmtD, fmtDT, money, norm, nowISO, uuid, ymd } from "../util.js";

const tone = s => (s === "Available" ? "ok" : s === "Reserved" ? "warn" : "muted");

export default function Bicycles() {
  const { data, idx } = useData();
  const nav = useNav();
  const [q, setQ] = useState(""); const [status, setStatus] = useState("All"); const [archived, setArchived] = useState(false);
  const [form, setForm] = useState(null); const [detail, setDetail] = useState(nav.params.focus || null);
  const rows = useMemo(() => data.bicycles.filter(b => {
    if (!archived && b.archived) return false;
    if (status !== "All" && idx.bikes.get(b.id)?.status !== status) return false;
    const s = norm(q); return !s || norm(`${b.brand} ${b.model} ${b.frameNo} ${b.colour} ${b.type}`).includes(s);
  }).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")), [data.bicycles, q, status, archived, idx]);
  const count = s => data.bicycles.filter(b => !b.archived && idx.bikes.get(b.id)?.status === s).length;
  return (
    <div className="page">
      <div className="page-head"><h2>Bicycles</h2><button className="btn accent" onClick={() => setForm({})}><Plus size={16} /> Add bicycle</button></div>
      <div className="grid c3"><div className="stat"><span>Available</span><b>{count("Available")}</b></div><div className="stat"><span>Reserved</span><b>{count("Reserved")}</b></div><div className="stat"><span>Sold</span><b>{count("Sold")}</b></div></div>
      <div className="panel"><div className="form">
        <Field label="Search brand, model, frame number, colour"><input value={q} onChange={e => setQ(e.target.value)} /></Field>
        <Field label="Status"><select value={status} onChange={e => setStatus(e.target.value)}><option>All</option><option>Available</option><option>Reserved</option><option>Sold</option></select></Field>
        <label className="row"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived</label>
      </div></div>
      {rows.length === 0 ? <Empty text="No bicycles to show. Each bicycle is tracked by its unique frame or serial number." /> : (
        <Table><thead><tr><th>Bicycle</th><th>Frame / serial</th><th>Type</th><th>Condition</th><th className="num">Selling price</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map(b => { const inf = idx.bikes.get(b.id); return (
            <tr key={b.id} className="click" onClick={() => setDetail(b.id)}>
              <td><div className="row" style={{ flexWrap: "nowrap" }}>{b.imageUrl && <img className="thumb" src={b.imageUrl} alt="" />}<span>{b.brand} {b.model}<div className="muted">{b.colour}</div></span></div></td>
              <td>{b.frameNo}</td><td>{b.type}</td><td>{b.condition}</td><td className="num">{money(b.sellPrice)}</td>
              <td><Badge tone={tone(inf?.status)}>{inf?.status}</Badge>{b.archived && <> <Badge>Archived</Badge></>}</td>
              <td><button className="btn ghost sm" onClick={e => { e.stopPropagation(); setForm(b); }}>Edit</button></td>
            </tr>); })}</tbody></Table>
      )}
      {form && <BikeForm bike={form.id ? form : null} onClose={() => setForm(null)} />}
      {detail && <BikeDetail bikeId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function BikeForm({ bike, onClose }) {
  const { user } = useAuth(); const { data, idx } = useData(); const toast = useToast();
  const cost = bike ? data.bicycleCosts.find(c => c.id === bike.id) : null;
  const [f, setF] = useState(() => bike ? { ...bike, sellPrice: String(bike.sellPrice), buyPrice: String(cost?.buyPrice ?? ""), supplier: cost?.supplier || "", purchaseDate: cost?.purchaseDate || "" } : { brand: "", model: "", frameNo: "", type: BIKE_TYPES[0], colour: "", condition: "New", buyPrice: "", sellPrice: "", purchaseDate: ymd(new Date()), supplier: "", imageUrl: "", description: "" });
  const [err, setErr] = useState("");
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const sold = bike && idx.bikes.get(bike.id)?.status === "Sold";
  async function save() {
    const frameNo = f.frameNo.trim();
    if (!f.brand.trim() || !f.model.trim()) return setErr("Brand and model are required.");
    if (!frameNo) return setErr("The frame or serial number is required.");
    if (data.bicycles.some(b => b.id !== bike?.id && norm(b.frameNo) === norm(frameNo))) return setErr("A bicycle with this frame or serial number already exists.");
    const sell = Math.round(Number(f.sellPrice)), buy = Math.round(Number(f.buyPrice));
    if (f.sellPrice === "" || !(sell >= 0)) return setErr("Enter the selling price.");
    if (f.buyPrice === "" || !(buy >= 0)) return setErr("Enter the buying price.");
    const rec = { id: bike?.id || uuid(), brand: f.brand.trim(), model: f.model.trim(), frameNo, type: f.type, colour: f.colour.trim(), condition: f.condition, sellPrice: sell, imageUrl: f.imageUrl || "", description: f.description || "", archived: !!bike?.archived, createdAt: bike?.createdAt || nowISO() };
    const costRec = { id: rec.id, buyPrice: buy, supplier: f.supplier.trim(), purchaseDate: f.purchaseDate };
    const now = nowISO();
    if (bike) {
      const history = data.bicycleCostHistory.filter(h => h.bicycleId === bike.id);
      const creates = [];
      const updates = [{ col: "bicycles", rec: { ...bike, ...rec } }];
      if (cost) {
        updates.push({ col: "bicycleCosts", rec: { ...cost, ...costRec } });
        if (Number(cost.buyPrice) !== buy) {
          // Preserve the previous price as the starting historical value before changing it.
          if (!history.length) creates.push({ col: "bicycleCostHistory", rec: { id: uuid(), bicycleId: bike.id, buyPrice: Number(cost.buyPrice) || 0, effectiveAt: cost.purchaseDate || bike.createdAt || now, source: "baseline" } });
          creates.push({ col: "bicycleCostHistory", rec: { id: uuid(), bicycleId: bike.id, buyPrice: buy, effectiveAt: now, source: "price change" } });
        }
      } else {
        creates.push({ col: "bicycleCosts", rec: costRec });
        creates.push({ col: "bicycleCostHistory", rec: { id: uuid(), bicycleId: bike.id, buyPrice: buy, effectiveAt: costRec.purchaseDate || now, source: "baseline" } });
      }
      await commitGroup(creates, updates, user.uid);
    } else {
      await createGroup([
        { col: "bicycles", rec }, { col: "bicycleCosts", rec: costRec },
        { col: "bicycleCostHistory", rec: { id: uuid(), bicycleId: rec.id, buyPrice: buy, effectiveAt: costRec.purchaseDate || now, source: "initial purchase" } }
      ], user.uid);
    }
    toast(bike ? "Bicycle updated. Historical buying costs are preserved." : "Bicycle added."); onClose();
  }
  return (
    <Modal wide title={bike ? "Edit bicycle" : "Add bicycle"} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn accent" onClick={save}>Save bicycle</button></>}>
      <div className="form">
        <Field label="Brand"><input value={f.brand} onChange={e => set("brand", e.target.value)} /></Field>
        <Field label="Model"><input value={f.model} onChange={e => set("model", e.target.value)} /></Field>
        <Field label="Frame / serial number" hint="Must be unique."><input value={f.frameNo} onChange={e => set("frameNo", e.target.value)} /></Field>
        <Field label="Bicycle type"><input list="biketypes" value={f.type} onChange={e => set("type", e.target.value)} /></Field>
        <datalist id="biketypes">{BIKE_TYPES.map(t => <option key={t} value={t} />)}</datalist>
        <Field label="Colour"><input value={f.colour} onChange={e => set("colour", e.target.value)} /></Field>
        <Field label="Condition"><select value={f.condition} onChange={e => set("condition", e.target.value)}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Buying price (UGX)"><input type="number" min="0" value={f.buyPrice} onChange={e => set("buyPrice", e.target.value)} /></Field>
        <Field label="Selling price (UGX)" hint={sold ? "This bicycle is sold. Changing the price does not change past sales." : "A new price applies immediately."}><input type="number" min="0" value={f.sellPrice} onChange={e => set("sellPrice", e.target.value)} /></Field>
        <Field label="Purchase date"><input type="date" value={f.purchaseDate} onChange={e => set("purchaseDate", e.target.value)} /></Field>
        <Field label="Supplier"><input value={f.supplier} onChange={e => set("supplier", e.target.value)} /></Field>
        <Field label="Description and specifications" full><textarea value={f.description} onChange={e => set("description", e.target.value)} /></Field>
        <Field label="Image (optional)" full><ImagePicker value={f.imageUrl} onChange={v => set("imageUrl", v)} /></Field>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {bike && !sold && <button className="btn ghost" onClick={async () => { await updateDoc("bicycles", { ...bike, archived: !bike.archived }, user.uid); toast(bike.archived ? "Bicycle restored." : "Bicycle archived."); onClose(); }}>{bike.archived ? "Restore bicycle" : "Archive bicycle"}</button>}
    </Modal>
  );
}

function BikeDetail({ bikeId, onClose }) {
  const { user } = useAuth(); const { data, idx } = useData();
  const nav = useNav(); const toast = useToast();
  const b = idx.bikeById.get(bikeId); const inf = idx.bikes.get(bikeId);
  const cost = data.bicycleCosts.find(c => c.id === bikeId);
  const [reserve, setReserve] = useState(null); const [err, setErr] = useState("");
  if (!b) return null;
  async function saveReservation() {
    if (!reserve.buyerName.trim()) return setErr("Enter the name of the person reserving.");
    const dep = Math.round(Number(reserve.amount));
    if (reserve.amount === "" || !(dep >= 0)) return setErr("Enter the deposit amount (0 is allowed; there is no minimum).");
    await createGroup([{ col: "reservations", rec: { id: uuid(), bikeId, buyerName: reserve.buyerName.trim(), buyerPhone: reserve.buyerPhone.trim(), depositAmount: dep, depositMethod: reserve.method, depositAt: nowISO(), status: "active", createdAt: nowISO(), createdBy: user.uid, createdByName: user.displayName } }], user.uid);
    setReserve(null); setErr(""); toast("Bicycle reserved.");
  }
  async function recordRefund(r) {
    const outstanding = Number(r.refundOutstanding ?? Math.max(0, Number(r.depositAmount) - Number(r.refunded || 0)));
    if (outstanding <= 0) return toast("There is no deposit refund outstanding.", "bad");
    const input = window.prompt(`Actual deposit refund paid (maximum UGX ${outstanding}):`, String(outstanding));
    if (input === null) return;
    const amt = Math.round(Number(input));
    if (!(amt > 0) || amt > outstanding) return toast("Enter a positive amount no greater than the outstanding refund.", "bad");
    const method = window.prompt(`Refund method: ${PAY_METHODS.join(", ")}`, r.depositMethod || PAY_METHODS[0]);
    if (method === null) return;
    if (!PAY_METHODS.includes(method)) return toast("Choose Cash, MTN Mobile Money or Airtel Money.", "bad");
    const at = nowISO();
    const rawReservation = data.reservations.find(x => x.id === r.id);
    const updates = rawReservation?.status === "active" ? [{ col: "reservations", rec: { ...rawReservation, status: "cancelled", cancelledAt: at, cancelledBy: user.uid, cancelledByName: user.displayName } }] : [];
    await commitGroup([{ col: "refunds", rec: { id: uuid(), reservationId: r.id, bikeId, saleId: inf.sale?.id || null, amount: amt, method, at, by: user.uid, byName: user.displayName, kind: "reservation deposit refund" } }], updates, user.uid);
    toast(amt === outstanding ? "Deposit refund recorded in full." : "Partial deposit refund recorded.");
  }
  async function cancelReservation(r) {
    const outstanding = Number(r.refundOutstanding ?? r.depositAmount ?? 0);
    const input = window.prompt(`Cancel this reservation. Enter the amount actually refunded now (maximum UGX ${outstanding}; enter 0 if not refunded yet):`, String(outstanding));
    if (input === null) return;
    const amt = Math.round(Number(input));
    if (!(amt >= 0) || amt > outstanding) return toast("Enter a valid refund amount no greater than the outstanding deposit.", "bad");
    let method = r.depositMethod || PAY_METHODS[0];
    if (amt > 0) {
      const choice = window.prompt(`Refund method: ${PAY_METHODS.join(", ")}`, method);
      if (choice === null) return;
      if (!PAY_METHODS.includes(choice)) return toast("Choose Cash, MTN Mobile Money or Airtel Money.", "bad");
      method = choice;
    }
    const at = nowISO();
    const creates = amt > 0 ? [{ col: "refunds", rec: { id: uuid(), reservationId: r.id, bikeId, amount: amt, method, at, by: user.uid, byName: user.displayName, kind: "reservation deposit refund" } }] : [];
    await commitGroup(creates, [{ col: "reservations", rec: { ...r, status: "cancelled", cancelledAt: at, cancelledBy: user.uid, cancelledByName: user.displayName } }], user.uid);
    toast(amt === outstanding ? "Reservation cancelled and deposit refund recorded." : "Reservation cancelled. Any remaining deposit refund is still outstanding.");
  }
  return (
    <Modal wide title={`${b.brand} ${b.model}`} onClose={onClose} footer={<>
      {inf.status !== "Sold" && !b.archived && <button className="btn accent" onClick={() => { onClose(); nav.go("sales", { tab: "new", bikeId: b.id }); }}>Sell this bicycle</button>}
      {inf.active && <button className="btn ghost" onClick={() => { onClose(); nav.go("sales", { tab: "new", bikeId: b.id, reservationId: inf.active.id }); }}>Sell to reservation holder</button>}
      {inf.status === "Available" && !b.archived && <button className="btn ghost" onClick={() => { setReserve({ buyerName: "", buyerPhone: "", amount: "", method: PAY_METHODS[0] }); setErr(""); }}>Reserve</button>}
    </>}>
      <div className="row between"><div className="row"><Badge tone={tone(inf.status)}>{inf.status}</Badge>{b.archived && <Badge>Archived</Badge>}</div>{b.imageUrl && <img className="thumb" style={{ width: 84, height: 84 }} src={b.imageUrl} alt="" />}</div>
      <dl className="kv"><dt>Frame / serial</dt><dd>{b.frameNo}</dd><dt>Type</dt><dd>{b.type}</dd><dt>Colour</dt><dd>{b.colour || "—"}</dd><dt>Condition</dt><dd>{b.condition}</dd><dt>Selling price</dt><dd>{money(b.sellPrice)}</dd>
        <dt>Buying price</dt><dd>{money(cost?.buyPrice)}</dd><dt>Supplier</dt><dd>{cost?.supplier || "—"}</dd><dt>Purchase date</dt><dd>{cost?.purchaseDate ? fmtD(cost.purchaseDate) : "—"}</dd>
        {b.description && <><dt>Description</dt><dd>{b.description}</dd></>}</dl>
      {inf.sale && <Notice tone="ok">Sold on {fmtDT(inf.sale.createdAt)} (sale {inf.sale.ref}) for {money(inf.sale.total)}. Profit: <b>{inf.profit == null ? "Unknown cost" : money(inf.profit)}</b>.</Notice>}
      {reserve && <div className="panel"><div className="form">
        <Field label="Reserved for (name)"><input value={reserve.buyerName} onChange={e => setReserve({ ...reserve, buyerName: e.target.value })} /></Field>
        <Field label="Phone (optional)"><input value={reserve.buyerPhone} onChange={e => setReserve({ ...reserve, buyerPhone: e.target.value })} /></Field>
        <Field label="Deposit (UGX)"><input type="number" min="0" value={reserve.amount} onChange={e => setReserve({ ...reserve, amount: e.target.value })} /></Field>
        <Field label="Deposit paid by"><select value={reserve.method} onChange={e => setReserve({ ...reserve, method: e.target.value })}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
      </div>{err && <Notice tone="bad">{err}</Notice>}<div className="row end"><button className="btn ghost" onClick={() => setReserve(null)}>Close</button><button className="btn" onClick={saveReservation}>Save reservation</button></div></div>}
      <h3>Reservations</h3>
      {inf.reservations.length === 0 ? <p className="muted">No reservations for this bicycle.</p> : <Table><thead><tr><th>Reserved for</th><th>Made</th><th className="num">Deposit</th><th>Status</th><th className="num">Refund</th><th /></tr></thead><tbody>
        {inf.reservations.map(r => <tr key={r.id}><td>{r.buyerName}<div className="muted">{r.buyerPhone}</div></td><td>{fmtDT(r.createdAt)}</td><td className="num">{money(r.depositAmount)}<div className="muted">{r.depositMethod}</div></td><td>{r.state}{r.refundOutstanding > 0 && r.state !== "Active" && <div className="muted">Refund due: {money(r.refundOutstanding)}</div>}</td><td className="num">{r.refunded > 0 ? <>{money(r.refunded)}<div className="muted">Actual refund recorded</div></> : "—"}</td><td>{r.state === "Active" && <button className="btn ghost sm" onClick={() => cancelReservation(r)}>Cancel</button>}{r.refundOutstanding > 0 && r.state !== "Active" && <button className="btn ghost sm" onClick={() => recordRefund(r)}>Record refund</button>}</td></tr>)}</tbody></Table>}
      <p className="muted">A reservation does not lock the bicycle. When it is displaced by another sale, its deposit is marked as refundable but is not assumed to have been paid back. An administrator must record each actual refund.</p>
    </Modal>
  );
}
