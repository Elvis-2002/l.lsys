import React, { useEffect, useState } from "react";
import { collection, doc, getDocs, updateDoc as fsUpdate } from "firebase/firestore";
import { db, firebaseConfigured } from "../firebase.js";
import { deviceId } from "../util.js";
import { Badge, Empty, Notice, Table, useToast } from "../ui.jsx";
import { errText, fmtDT } from "../util.js";

const tone = s => (s === "approved" ? "ok" : s === "pending" ? "warn" : "bad");
export default function Devices() {
  const toast = useToast();
  const [rows, setRows] = useState([]); const [err, setErr] = useState("");
  const load = async () => { try { const s = await getDocs(collection(db, "devices")); setRows(s.docs.map(d => d.data()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))); setErr(""); } catch (e) { setErr("Devices need an internet connection. " + errText(e)); } };
  useEffect(() => { if (firebaseConfigured) load(); }, []);
  if (!firebaseConfigured) return <div className="page"><h2>Devices</h2><Notice tone="warn">Device management needs Firebase.</Notice></div>;
  const set = async (d, status) => {
    if (status === "revoked" && d.deviceId === deviceId() && !window.confirm("This is the device you are using. Deactivate it anyway?")) return;
    await fsUpdate(doc(db, "devices", d.id), { status }); toast(status === "approved" ? "Device approved." : "Device deactivated. It loses access when it next goes online."); load();
  };
  return (
    <div className="page">
      <div className="page-head"><h2>Devices</h2><button className="btn ghost" onClick={load}>Refresh</button></div>
      {err && <Notice tone="warn">{err}</Notice>}
      <p className="muted">New devices wait here until you approve them. Deactivate lost or unauthorised devices; they are signed out when they reconnect. Unsynchronised records are first saved into a device-local recovery snapshot when browser storage is available.</p>
      {rows.length === 0 ? <Empty text="No devices registered yet." /> : <Table><thead><tr><th>Device</th><th>User</th><th>First seen</th><th>Last seen</th><th>Status</th><th /></tr></thead><tbody>
        {rows.map(d => <tr key={d.id}><td>{d.label}{d.deviceId === deviceId() && <> <Badge tone="info">This device</Badge></>}</td><td>{d.userName}<div className="muted">{d.email}</div></td><td>{fmtDT(d.createdAt)}</td><td>{fmtDT(d.lastSeen)}</td><td><Badge tone={tone(d.status)}>{d.status}</Badge></td>
          <td className="nowrap">{d.status !== "approved" && <button className="btn sm" onClick={() => set(d, "approved")}>{d.status === "pending" ? "Approve" : "Reactivate"}</button>} {d.status !== "revoked" && <button className="btn ghost sm" onClick={() => set(d, "revoked")}>Deactivate</button>}</td></tr>)}</tbody></Table>}
    </div>
  );
}
