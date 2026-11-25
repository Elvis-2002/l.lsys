import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SYNCED, getAll, onChange } from "./db.js";
import { buildIndex, detectIssues, settingsOf } from "./logic.js";
import { getStatus, subscribeStatus } from "./sync.js";
import { useAuth } from "./auth.jsx";
import { createGroup, updateDoc } from "./records.js";
import { nowISO } from "./util.js";
import { archiveOld, runDailyBackup } from "./maintenance.js";

const Ctx = createContext(null);
export const useData = () => useContext(Ctx);
export const useSyncStatus = () => useSyncExternalStore(subscribeStatus, getStatus);

const empty = () => Object.fromEntries([...Object.keys(SYNCED), "queue"].map(k => [k, []]));
const INTEGRITY = ["oversold", "bike-double", "dup-ref", "dup-code", "dup-frame"];

export function DataProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [data, setData] = useState(empty);
  const [loaded, setLoaded] = useState(false);
  const names = useMemo(() => [...Object.entries(SYNCED).filter(([, c]) => isAdmin || !c.admin).map(([k]) => k), "queue"], [isAdmin]);

  useEffect(() => {
    let live = true;
    const load = async list => {
      const rows = await Promise.all(list.map(async n => [n, await getAll(n)]));
      if (live) setData(prev => { const next = { ...prev }; rows.forEach(([n, r]) => { next[n] = r; }); return next; });
    };
    load(names).then(() => live && setLoaded(true));
    const off = onChange(changed => { const rel = changed.filter(c => names.includes(c)); if (rel.length) load(rel); });
    return () => { live = false; off(); };
  }, [names]);

  const idx = useMemo(() => buildIndex(data, { admin: isAdmin }), [data, isAdmin]);
  const st = useMemo(() => settingsOf(data), [data.settings]);
  const sync = useSyncStatus();

  // Migrate older sales once the administrator has completed the initial cloud pull.
  // The total and paidTotal fields are required for Firestore to enforce atomic payment caps.
  const migratedSales = useRef(false);
  useEffect(() => {
    if (!isAdmin || !loaded || !sync.initialPullDone || migratedSales.current) return;
    // Wait until the remote listener has populated at least one sale; the
    // change notification can arrive just after initialPullDone is raised.
    if (data.sales.length === 0) return;
    const legacy = data.sales.filter(s => s.total === undefined || s.paidTotal === undefined);
    if (!legacy.length) { migratedSales.current = true; return; }
    migratedSales.current = true;
    (async () => {
      for (const raw of legacy) {
        const sale = idx.saleById.get(raw.id);
        if (!sale) continue;
        await updateDoc("sales", { ...raw, total: sale.total, paidTotal: sale.paid }, user.uid);
      }
    })().catch(() => { migratedSales.current = false; });
  }, [isAdmin, loaded, sync.initialPullDone, data.sales, idx, user]);

  // Establish a historical baseline for bicycles that existed before cost history
  // was introduced. Use the purchase date when present, otherwise the bicycle's
  // creation date; never silently create a new baseline on every load.
  const migratedBicycleCosts = useRef(false);
  useEffect(() => {
    if (!isAdmin || !loaded || !sync.initialPullDone || migratedBicycleCosts.current) return;
    if (data.bicycles.length === 0 || data.bicycleCosts.length === 0) return;
    migratedBicycleCosts.current = true;
    (async () => {
      const known = new Set(data.bicycleCostHistory.map(x => x.bicycleId));
      const bicyclesById = new Map(data.bicycles.map(x => [x.id, x]));
      const baselines = data.bicycleCosts.filter(c => !known.has(c.id)).map(c => {
        const bike = bicyclesById.get(c.id);
        return { col: "bicycleCostHistory", rec: {
          id: `legacy-cost-${c.id}`, bicycleId: c.id,
          buyPrice: Number(c.buyPrice) || 0,
          effectiveAt: c.purchaseDate || bike?.createdAt || nowISO(),
          source: "legacy baseline (best available date)"
        } };
      });
      if (baselines.length) await createGroup(baselines, user.uid);
    })().catch(() => { migratedBicycleCosts.current = false; });
  }, [isAdmin, loaded, sync.initialPullDone, data.bicycles, data.bicycleCosts, data.bicycleCostHistory, user]);

  // Administrator device: turn detected integrity problems into conflict records the admin can resolve.
  const timer = useRef(null);
  useEffect(() => {
    if (!isAdmin || !loaded || !sync.initialPullDone || !sync.lastSync || sync.state === "syncing") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const issues = detectIssues(data, idx);
      const existing = new Map(data.syncConflicts.map(c => [c.id, c]));
      for (const i of issues) {
        if (!existing.has(i.id)) await createGroup([{ col: "syncConflicts", rec: { id: i.id, kind: i.kind, title: i.title, detail: i.detail, refs: i.refs || {}, status: "open", createdAt: nowISO() } }], user.uid);
        else if (existing.get(i.id).status === "cleared") await updateDoc("syncConflicts", { ...existing.get(i.id), status: "open", detail: i.detail }, user.uid);
      }
      const ids = new Set(issues.map(i => i.id));
      for (const c of data.syncConflicts) if (INTEGRITY.includes(c.kind) && c.status === "open" && !ids.has(c.id)) await updateDoc("syncConflicts", { ...c, status: "cleared" }, user.uid);
    }, 10000);
    return () => clearTimeout(timer.current);
  }, [data, idx, isAdmin, loaded, sync.lastSync, sync.state]);

  // Administrator device: daily local snapshot and archiving of old settled sales.
  const ranMaint = useRef(false);
  useEffect(() => {
    if (!isAdmin || !loaded || ranMaint.current || !sync.initialPullDone || !sync.lastSync) return;
    ranMaint.current = true;
    if (st.autoBackup) runDailyBackup().catch(() => null);
    archiveOld(data, idx, st, user).catch(() => null);
  }, [isAdmin, loaded, sync.lastSync]); // eslint-disable-line

  return <Ctx.Provider value={{ data, idx, st, isAdmin, user, loaded, sync, openConflicts: data.syncConflicts.filter(c => c.status === "open").length }}>{children}</Ctx.Provider>;
}
