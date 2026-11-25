import React, { useEffect, useState } from "react";
import { dumpAll, getAll } from "../db.js";
import { runDailyBackup } from "../maintenance.js";
import { bicyclesSheet, downloadXlsx, inventorySheet, profitSheet, purchasesSheet, salesSheet, stamp } from "../exports.js";
import { useData } from "../store.jsx";
import { Notice, Table, useToast } from "../ui.jsx";
import { downloadBlob, fmtDT } from "../util.js";

export default function Backup() {
  const { data, idx } = useData(); const toast = useToast();
  const [list, setList] = useState([]);
  const refresh = async () => setList((await getAll("backups")).sort((a, b) => b.id.localeCompare(a.id)));
  useEffect(() => { refresh(); }, []);
  const x = (name, rows) => downloadXlsx({ [name]: rows }, `${name.toLowerCase().replace(/ /g, "-")}-${stamp()}.xlsx`);
  return (
    <div className="page">
      <div className="page-head"><h2>Backup and export</h2></div>
      <Notice tone="info">Your data lives in Firestore and on each device. Daily snapshots below are kept on this device (last 7 days). Recovery snapshots also preserve unsynchronised records before a revoked session is cleared. Download a backup regularly and keep it somewhere safe.</Notice>
      <div className="panel"><h3>Excel exports</h3><div className="row">
        <button className="btn" onClick={() => x("Inventory", inventorySheet(data, idx))}>Inventory</button>
        <button className="btn" onClick={() => x("Purchases", purchasesSheet(data))}>Purchases</button>
        <button className="btn" onClick={() => x("Sales", salesSheet(idx))}>Sales</button>
        <button className="btn" onClick={() => x("Bicycles", bicyclesSheet(data, idx))}>Bicycle records</button>
        <button className="btn" onClick={() => x("Profit report", profitSheet(idx))}>Profit report</button>
      </div></div>
      <div className="panel"><h3>Full backup</h3><div className="row">
        <button className="btn accent" onClick={async () => { downloadBlob(new Blob([JSON.stringify(await dumpAll({ includeQueue: true }))], { type: "application/json" }), `ll-bicycle-backup-${stamp()}.json`); toast("Backup downloaded."); }}>Download backup (JSON)</button>
        <button className="btn ghost" onClick={async () => { await runDailyBackup(); await refresh(); toast("Daily snapshot is up to date."); }}>Create today's snapshot</button>
      </div></div>
      <h3>Automatic daily snapshots</h3>
      <Table><thead><tr><th>Day</th><th>Created</th><th>Size</th><th /></tr></thead><tbody>
        {list.length === 0 && <tr><td colSpan="4" className="muted">No snapshots yet. The first one is created when the administrator opens the app.</td></tr>}
        {list.map(b => <tr key={b.id}><td>{b.id}</td><td>{fmtDT(b.createdAt)}</td><td>{Math.round(b.json.length / 1024)} KB</td><td><button className="btn ghost sm" onClick={() => downloadBlob(new Blob([b.json], { type: "application/json" }), `ll-bicycle-snapshot-${b.id}.json`)}>Download</button></td></tr>)}</tbody></Table>
    </div>
  );
}
