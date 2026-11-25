// Two-way synchronisation between IndexedDB and Cloud Firestore.
// New groups are committed through one Firestore transaction so linked records
// (for example a corrected sale and its replacement) cannot be half-applied.
import {
  collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, Timestamp, where
} from "firebase/firestore";
import { db, firebaseConfigured } from "./firebase.js";
import { SYNCED, del, get, getAll, getMeta, put, putMany, setMeta, touch, writeGroup } from "./db.js";
import { createGroup, setKicker } from "./records.js";
import { indexKey, newSaleRef, nowISO, uuid } from "./util.js";

let status = { state: typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline", pending: 0, failed: 0, lastSync: null, initialPullDone: false, error: "" };
const subs = new Set();
export const getStatus = () => status;
export const subscribeStatus = fn => { subs.add(fn); return () => subs.delete(fn); };
function setStatus(p) { status = { ...status, ...p }; subs.forEach(f => f(status)); }

let ctx = null, busy = false, again = false, debounce = null, unsubs = [], interval = null;
const TRANSIENT = ["unavailable", "deadline-exceeded", "network-request-failed", "cancelled", "timeout", "aborted", "resource-exhausted"];
const isTransient = e => TRANSIENT.includes(e?.code) || /offline|network|timed out|temporarily unavailable/i.test(e?.message || "");
const withTimeout = (p, ms = 20000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: "timeout", message: "The request timed out." }), ms))]);

const toCloud = r => { const { _dirty, _base, _idx, syncedAt, ...rest } = r; return { ...JSON.parse(JSON.stringify(rest)), syncedAt: serverTimestamp() }; };
const plain = r => { const { _dirty, _base, _idx, ...rest } = r || {}; return JSON.parse(JSON.stringify(rest)); };
const sameData = (a, b) => {
  const clean = x => {
    const { rev, syncedAt, _dirty, _base, _idx, ...rest } = x || {};
    return JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]]));
  };
  return clean(a) === clean(b);
};

async function refreshCounts() {
  const q = await getAll("queue");
  setStatus({ pending: q.filter(i => i.status === "pending").length, failed: q.filter(i => i.status !== "pending").length });
}

// Rebase any later queued update after the preceding version has reached cloud.
async function rebasePendingUpdates(col, id, cloudRev) {
  const queue = await getAll("queue");
  for (const item of queue) {
    const updates = item.updates || [];
    let changed = false;
    const next = updates.map(u => {
      if (u.col !== col || u.rec?.id !== id) return u;
      changed = true;
      return { ...u, rec: { ...u.rec, _base: cloudRev, _dirty: true } };
    });
    if (changed) await put("queue", { ...item, updates: next, ver: (item.ver || 0) + 1, status: "pending" }, { silent: true });
  }
}

async function markGroupApplied(applied, item) {
  for (const { col, rec, cloudRev, key } of applied) {
    const cur = await get(col, rec.id);
    if (!cur) continue;
    const unchanged = (cur.rev || 0) === (rec.rev || 0);
    const next = { ...cur, _base: cloudRev, _dirty: !unchanged, _idx: key || undefined };
    if (unchanged) next.rev = cloudRev;
    await put(col, next, { silent: true });
    if (!unchanged) await rebasePendingUpdates(col, rec.id, cloudRev);
  }
  if (applied.length) touch([...new Set(applied.map(x => x.col))]);
}

// Atomic create/update group. Queue records contain immutable snapshots so a
// later edit cannot silently change the payload of an earlier queued operation.
async function pushGroup(item) {
  let creates = item.creates || [];
  let updates = item.updates || [];
  if (item.kind === "create" && !creates.length) {
    creates = [];
    for (const d of item.docs || []) { const r = await get(d.col, d.id); if (r) creates.push({ col: d.col, rec: r }); }
  }
  if (item.kind === "update" && !updates.length) {
    const r = await get(item.col, item.docId);
    if (r) updates = [{ col: item.col, rec: r }];
  }
  if (!creates.length && !updates.length) return { ok: true };
  const applied = [];
  const refs = new Map();
  const keyFor = ref => `${ref.path}`;
  const addRef = ref => { refs.set(keyFor(ref), ref); return ref; };
  const createRows = creates.map(x => ({ ...x, ref: addRef(doc(db, x.col, x.rec.id)), key: indexKey(x.col, x.rec) }));
  const updateRows = updates.map(x => ({ ...x, ref: addRef(doc(db, x.col, x.rec.id)), key: indexKey(x.col, x.rec), oldKey: x.rec._idx }));
  const indexRefs = new Map();
  for (const row of [...createRows, ...updateRows]) {
    if (row.key) indexRefs.set(row.key, addRef(doc(db, "refIndex", row.key)));
    if (row.oldKey && row.oldKey !== row.key) indexRefs.set(row.oldKey, addRef(doc(db, "refIndex", row.oldKey)));
  }

  try {
    await withTimeout(runTransaction(db, async tx => {
      applied.length = 0; // Firestore may retry the transaction callback.
      const docSnaps = new Map();
      for (const [path, ref] of refs) docSnaps.set(path, await tx.get(ref));

      const indexSnaps = new Map();
      for (const [key, ref] of indexRefs) indexSnaps.set(key, await tx.get(ref));

      // Detect duplicate keys inside this group before any write is staged.
      const groupKeys = new Map();
      for (const row of createRows) if (row.key) {
        const existing = groupKeys.get(row.key);
        if (existing && existing !== row.rec.id) throw { code: "dup-index", key: row.key, col: row.col, rec: row.rec };
        groupKeys.set(row.key, row.rec.id);
      }

      const toCreate = [];
      for (const row of createRows) {
        const snap = docSnaps.get(row.ref.path);
        if (snap.exists()) {
          if (!sameData(snap.data(), row.rec)) throw { code: "edit-conflict", col: row.col, rec: row.rec, cloud: snap.data() };
          applied.push({ col: row.col, rec: row.rec, cloudRev: snap.data().rev || 1, key: row.key });
          continue;
        }
        if (row.key) {
          const ix = indexSnaps.get(row.key);
          if (ix?.exists() && ix.data().id !== row.rec.id) throw { code: "dup-index", key: row.key, col: row.col, rec: row.rec };
        }
        toCreate.push(row);
      }

      const toUpdate = [];
      for (const row of updateRows) {
        const snap = docSnaps.get(row.ref.path);
        if (!snap.exists()) throw { code: "missing", col: row.col, rec: row.rec };
        const cloud = snap.data();
        if (sameData(cloud, row.rec)) {
          applied.push({ col: row.col, rec: row.rec, cloudRev: cloud.rev || 1, key: row.key });
          continue;
        }
        if ((cloud.rev || 0) !== (row.rec._base || 0)) throw { code: "edit-conflict", col: row.col, rec: row.rec, cloud };
        if (row.key && row.key !== row.oldKey) {
          const ix = indexSnaps.get(row.key);
          if (ix?.exists() && ix.data().id !== row.rec.id) throw { code: "dup-index", key: row.key, col: row.col, rec: row.rec };
        }
        toUpdate.push({ ...row, cloudRev: cloud.rev || 1 });
      }

      // All reads are complete; stage writes now.
      for (const row of toCreate) {
        tx.set(row.ref, { ...toCloud(row.rec), rev: 1 });
        if (row.key) {
          const ix = indexSnaps.get(row.key);
          if (!ix?.exists()) tx.set(indexRefs.get(row.key), { col: row.col, id: row.rec.id, at: serverTimestamp() });
        }
        applied.push({ col: row.col, rec: row.rec, cloudRev: 1, key: row.key });
      }
      for (const row of toUpdate) {
        const nextRev = row.cloudRev + 1;
        tx.set(row.ref, { ...toCloud(row.rec), rev: nextRev });
        if (row.key && row.key !== row.oldKey) {
          const ix = indexSnaps.get(row.key);
          if (!ix?.exists()) tx.set(indexRefs.get(row.key), { col: row.col, id: row.rec.id, at: serverTimestamp() });
          const oldIx = row.oldKey ? indexSnaps.get(row.oldKey) : null;
          if (oldIx?.exists()) tx.delete(indexRefs.get(row.oldKey));
        }
        applied.push({ col: row.col, rec: row.rec, cloudRev: nextRev, key: row.key });
      }
    }));
  } catch (e) {
    if (isTransient(e)) return { retry: true, error: e };
    if (e?.code === "edit-conflict") return { conflict: { rec: e.rec, cloud: e.cloud, col: e.col } };
    if (e?.code === "dup-index") return { duplicate: { key: e.key, rec: e.rec, col: e.col } };
    return { fail: true, error: e };
  }
  await markGroupApplied(applied, item);
  return { ok: true };
}

// Legacy queue handlers retained so projects created by earlier releases can sync.
async function pushCreate(item) { return pushGroup(item); }
async function pushUpdate(item) { return pushGroup(item); }

async function raiseConflict(kind, item, info) {
  if (ctx.user.role !== "admin") return false;
  const id = kind === "edit-conflict" ? `edit:${info.col}:${info.rec.id}` : `dup:${info.key}`;
  if (await get("syncConflicts", id)) return true;
  const titles = { "edit-conflict": "Two devices changed the same record", "dup-index": "Duplicate code or reference" };
  await createGroup([{ col: "syncConflicts", rec: {
    id, kind, col: info.col, docId: info.rec.id, status: "open", createdAt: nowISO(),
    title: titles[kind],
    detail: kind === "edit-conflict" ? `A ${info.col} record was edited on this device and on another device. Choose which version to keep.` : `A new ${info.col} record could not be saved because its code, reference or frame number already exists on another device.`,
    local: plain(info.rec), cloud: info.cloud ? JSON.parse(JSON.stringify({ ...info.cloud, syncedAt: null })) : null, queueId: item.id
  } }], ctx.user.uid);
  return true;
}

export async function syncNow() {
  if (!ctx || !firebaseConfigured) return;
  if (!navigator.onLine) { setStatus({ state: "offline" }); await refreshCounts(); return; }
  if (busy) { again = true; return; }
  busy = true; setStatus({ state: "syncing", error: "" });
  let transient = false;
  try {
    const items = (await getAll("queue")).filter(i => i.status === "pending" && (ctx.user.role === "admin" || i.actor === ctx.user.uid)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const queued of items) {
      // A preceding group may have reached cloud and rebased this queued update.
      // Always reload the latest queue snapshot instead of using the stale list copy.
      const item = await get("queue", queued.id);
      if (!item || item.status !== "pending") continue;
      let res;
      try {
        res = item.kind === "create" ? await pushCreate(item) : item.kind === "update" ? await pushUpdate(item) : await pushGroup(item);
      } catch (e) { res = isTransient(e) ? { retry: true, error: e } : { fail: true, error: e }; }
      if (res.ok) {
        const now = await get("queue", item.id);
        if (now && now.ver === item.ver) await del("queue", item.id, { silent: true });
      } else if (res.retry) {
        transient = true; setStatus({ error: res.error?.message || res.error?.code || "Temporary synchronisation problem" }); break;
      } else if (res.conflict) {
        const raised = await raiseConflict("edit-conflict", item, res.conflict);
        await put("queue", { ...item, status: "conflict", error: "Edited on two devices", conflictKey: `edit:${res.conflict.col}:${res.conflict.rec.id}` }, { silent: true });
        if (!raised) setStatus({ error: "Edit conflict – ask the administrator to resolve it" });
      } else if (res.duplicate) {
        const { rec, col, key } = res.duplicate;
        if (col === "sales" && ctx.user.role !== "admin") {
          const nextRef = newSaleRef();
          const creates = (item.creates || []).map(x => x.col === "sales" && x.rec.id === rec.id ? { ...x, rec: { ...x.rec, ref: nextRef } } : x);
          await put("sales", { ...(await get("sales", rec.id)), ref: nextRef }, { silent: true });
          await put("queue", { ...item, creates, ver: (item.ver || 0) + 1, status: "pending" }, { silent: true });
          transient = true; again = true; touch(["sales", "queue"]);
        } else {
          await raiseConflict("dup-index", item, res.duplicate);
          await put("queue", { ...item, status: "conflict", error: "Duplicate code or reference", conflictKey: `dup:${key}` }, { silent: true });
        }
      } else {
        await put("queue", { ...item, status: "failed", error: res.error?.message || res.error?.code || "Rejected by security rules" }, { silent: true });
      }
    }
  } catch (e) { transient = true; setStatus({ error: e?.message || String(e) }); }
  busy = false;
  await refreshCounts();
  touch(["queue"]);
  const failed = status.failed > 0;
  setStatus({ state: !navigator.onLine ? "offline" : transient ? "failed" : failed ? "failed" : "online", lastSync: nowISO() });
  if (again) { again = false; setTimeout(syncNow, 300); }
}

const laterThan = (a, b) => !b || a.seconds > b.seconds || (a.seconds === b.seconds && a.nanoseconds > b.nanoseconds);
async function attachPull(col) {
  const cur = await getMeta(`cursor:${col}`);
  const q = query(collection(db, col), where("syncedAt", ">", cur ? new Timestamp(cur.s, cur.n) : new Timestamp(0, 0)));
  let first = true;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const unsubscribe = onSnapshot(q, async snap => {
    try {
      const incoming = []; let max = null;
      snap.docChanges().forEach(ch => {
        if (ch.type === "removed") return;
        const d = ch.doc.data();
        if (!d.syncedAt || typeof d.syncedAt.toMillis !== "function") return;
        if (laterThan(d.syncedAt, max)) max = d.syncedAt;
        incoming.push({ ...d, syncedAt: d.syncedAt.toMillis() });
      });
      if (incoming.length) {
        const locals = await Promise.all(incoming.map(d => get(col, d.id)));
        const fresh = incoming.map((d, i) => (locals[i]?._dirty ? null : { ...d, _dirty: false, _base: d.rev || 0, _idx: indexKey(col, d) })).filter(Boolean);
        await putMany(col, fresh);
      }
      if (max) await setMeta(`cursor:${col}`, { s: max.seconds, n: max.nanoseconds });
      setStatus({ lastSync: nowISO() });
      if (first) { first = false; resolveReady(); }
    } catch (e) {
      if (first) { first = false; rejectReady(e); }
      setStatus({ state: "failed", error: `${col}: ${e?.message || e}` });
    }
  }, err => {
    if (first) { first = false; rejectReady(err); }
    setStatus({ state: "failed", error: `${col}: ${err.code || err.message}` });
  });
  return { unsubscribe, ready };
}

export async function startSync(user) {
  stopSync();
  if (!firebaseConfigured) return;
  ctx = { user };
  setStatus({ state: navigator.onLine ? "syncing" : "offline", initialPullDone: false, error: "" });
  setKicker(() => { clearTimeout(debounce); debounce = setTimeout(syncNow, 600); });
  const handles = [];
  for (const [col, cfg] of Object.entries(SYNCED)) {
    if (cfg.admin && user.role !== "admin") continue;
    try {
      const h = await attachPull(col);
      handles.push(h); unsubs.push(h.unsubscribe);
    } catch (e) { setStatus({ state: "failed", error: `${col}: ${e?.message || e}` }); }
  }
  const outcomes = await Promise.allSettled(handles.map(h => h.ready));
  const ready = outcomes.every(x => x.status === "fulfilled");
  setStatus({ initialPullDone: ready, lastSync: ready ? nowISO() : status.lastSync, state: navigator.onLine ? (ready ? "online" : "failed") : "offline" });

  const on = () => { setStatus({ state: "online" }); syncNow(); };
  const off = () => setStatus({ state: "offline" });
  window.addEventListener("online", on); window.addEventListener("offline", off);
  unsubs.push(() => { window.removeEventListener("online", on); window.removeEventListener("offline", off); });
  interval = setInterval(syncNow, 30000);
  await refreshCounts();
  syncNow();
}
export function stopSync() {
  unsubs.forEach(u => { try { u(); } catch (_) { /* already closed */ } });
  unsubs = []; clearInterval(interval); clearTimeout(debounce); ctx = null; busy = false; again = false; setKicker(() => {});
}

// ---- helpers used by the conflict screen ----
function fromCloud(col, snap) {
  if (!snap?.exists()) return null;
  const d = snap.data();
  return { ...d, syncedAt: d.syncedAt?.toMillis ? d.syncedAt.toMillis() : d.syncedAt || null, _dirty: false, _base: d.rev || 0, _idx: indexKey(col, d) };
}
export async function resolveEditConflict(conflict, keep) {
  const item = await get("queue", conflict.queueId);
  const cur = await get(conflict.col, conflict.docId);
  if (keep === "cloud") {
    // A conflict can belong to a multi-record transaction. Discard the entire
    // local group by restoring updated docs and removing its unsynced creates.
    if (item) await discardQueueItem(item.id);
    else if (conflict.cloud) await put(conflict.col, fromCloud(conflict.col, { exists: () => true, data: () => conflict.cloud }));
  } else {
    if (!cur) throw new Error("The local version is missing. Restore from backup before resolving this conflict.");
    const cloudRev = conflict.cloud?.rev || 0;
    const local = { ...cur, _base: cloudRev, rev: cloudRev + 1, _dirty: true, _idx: conflict.cloud ? indexKey(conflict.col, conflict.cloud) : cur._idx };
    const queue = item ? {
      ...item,
      updates: (item.updates || []).map(u => u.col === conflict.col && u.rec?.id === conflict.docId ? { ...u, rec: local } : u),
      status: "pending", error: "", ver: (item.ver || 0) + 1
    } : {
      id: `conflict-keep-local:${uuid()}`, kind: "group", creates: [],
      updates: [{ col: conflict.col, rec: local }], actor: ctx?.user?.uid,
      createdAt: nowISO(), status: "pending", ver: 1
    };
    await writeGroup([{ store: conflict.col, value: local }], [queue]);
  }
  syncNow();
}
export async function retryQueueItem(id) {
  const i = await get("queue", id);
  if (i) { await put("queue", { ...i, status: "pending", error: "", ver: (i.ver || 0) + 1 }); syncNow(); }
}
export async function discardQueueItem(id) {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Connect to the internet before discarding a change. The cloud copy must be restored first.");
  const item = await get("queue", id);
  if (!item) return;
  const creates = item.creates || (item.docs || []);
  const updates = item.updates || (item.kind === "update" ? [{ col: item.col, rec: { id: item.docId } }] : []);
  // Restore updated documents from Firestore before removing the local queue entry.
  for (const u of updates) {
    const snap = await getDoc(doc(db, u.col, u.rec.id));
    if (!snap.exists()) throw new Error(`Cannot discard: the cloud copy of ${u.col}/${u.rec.id} is missing. Keep this change and contact the administrator.`);
    await put(u.col, fromCloud(u.col, snap));
  }
  // For new records, preserve any copy that already reached cloud; otherwise remove the unsynced local copy.
  for (const c of creates) {
    const idValue = c.rec?.id || c.id;
    const snap = await getDoc(doc(db, c.col, idValue));
    if (snap.exists()) await put(c.col, fromCloud(c.col, snap));
    else await del(c.col, idValue);
  }
  await del("queue", id);
  await refreshCounts();
  touch(["queue"]);
}
