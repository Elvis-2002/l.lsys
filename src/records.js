// Local-first write API. Every business change and its sync queue entry are
// committed together in IndexedDB. Group operations are also pushed atomically.
import { get, put, writeGroup, touch } from "./db.js";
import { nowISO, uuid } from "./util.js";

function localVersion(rec, cur = null) {
  if (!cur) return { ...rec, rev: 1, _dirty: true, _base: 0 };
  return {
    ...rec,
    rev: (cur.rev || 0) + 1,
    _dirty: true,
    // Keep the original remote base while an unsynced edit is being coalesced.
    _base: cur._dirty ? (cur._base || 0) : (cur.rev || 0),
    _idx: cur._idx
  };
}

// New records and optional updates form one indivisible local/cloud operation.
export async function commitGroup(items, updates = [], actor) {
  if (!items.length && !updates.length) return;
  const records = [];
  const creates = [];
  const updateSnapshots = [];

  for (const { col, rec } of items) {
    if (!rec?.id) throw new Error(`A new ${col} record is missing its id.`);
    const next = localVersion(rec);
    records.push({ store: col, value: next });
    creates.push({ col, rec: next });
  }
  for (const { col, rec } of updates) {
    if (!rec?.id) throw new Error(`An updated ${col} record is missing its id.`);
    const cur = await get(col, rec.id);
    if (!cur) throw new Error(`Cannot update missing ${col} record`);
    const next = localVersion(rec, cur);
    records.push({ store: col, value: next });
    updateSnapshots.push({ col, rec: next });
  }

  const queue = {
    id: `grp:${uuid()}`,
    kind: "group",
    creates,
    updates: updateSnapshots,
    actor,
    createdAt: nowISO(),
    status: "pending",
    ver: 1
  };
  await writeGroup(records, [queue]);
  kick();
}

export async function createGroup(items, actor) {
  return commitGroup(items, [], actor);
}

// Single-record updates are coalesced into one pending queue item. This avoids
// replaying several stale revisions when a user edits repeatedly while offline.
export async function updateDoc(col, rec, actor) {
  if (!rec?.id) throw new Error(`An updated ${col} record is missing its id.`);
  const cur = await get(col, rec.id);
  if (!cur) throw new Error(`Cannot update missing ${col} record`);
  const next = localVersion(rec, cur);
  const qid = `upd:${col}:${rec.id}`;
  const old = await get("queue", qid);
  const queue = {
    id: qid,
    kind: "group",
    creates: [],
    updates: [{ col, rec: next }],
    actor,
    createdAt: old?.createdAt || nowISO(),
    status: "pending",
    ver: (old?.ver || 0) + 1
  };
  await writeGroup([{ store: col, value: next }], [queue]);
  kick();
}

let kicker = () => {};
export const setKicker = fn => { kicker = fn; };
function kick() { kicker(); }
