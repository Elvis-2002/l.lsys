// IndexedDB: primary local storage. Multi-record business actions and their
// synchronisation queue entries are committed in one IndexedDB transaction.
const DB_NAME = "ll-bicycle-center";
const DB_VERSION = 5;

export const STORES = {
  products: "id", batchStock: "id", batchCosts: "id", purchases: "id", adjustments: "id", priceHistory: "id",
  bicycles: "id", bicycleCosts: "id", bicycleCostHistory: "id", reservations: "id", refunds: "id", sales: "id", saleLines: "id", payments: "id",
  saleAudit: "id", activity: "id", settings: "key", syncConflicts: "id",
  queue: "id", meta: "key", backups: "id"
};
// Collections mirrored in Firestore. Admin-only collections are never pulled to attendant devices.
export const SYNCED = {
  products: {}, batchStock: {}, sales: {}, saleLines: {}, payments: {}, adjustments: {}, saleAudit: {},
  bicycles: {}, reservations: {}, refunds: { admin: true }, settings: {},
  purchases: { admin: true }, batchCosts: { admin: true }, priceHistory: { admin: true },
  bicycleCosts: { admin: true }, bicycleCostHistory: { admin: true }, syncConflicts: { admin: true }, activity: { admin: true }
};

let dbp;
const listeners = new Set();
// Settings is keyed by the stable singleton key "main". Older installations
// already have this object store keyPath, so normalize every write at the DB boundary.
const withStoreKey = (store, value) => store === "settings"
  ? { ...value, key: value?.key || value?.id || "main" }
  : value;
let pending = new Set();
let timer = null;
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function emit(stores) {
  stores.forEach(s => pending.add(s));
  if (timer) return;
  timer = setTimeout(() => { const changed = [...pending]; pending = new Set(); timer = null; listeners.forEach(fn => fn(changed)); }, 30);
}

function open() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is not available in this browser."));
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, keyPath] of Object.entries(STORES)) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Database upgrade is blocked by another open tab. Close other L.L Bicycle Center tabs and reload."));
    });
  }
  return dbp;
}
const run = async (store, mode, fn) => {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Local database transaction was aborted."));
  });
};

export const getAll = store => run(store, "readonly", s => s.getAll()).then(r => r || []);
export const get = (store, id) => run(store, "readonly", s => s.get(id));
export async function put(store, value, { silent } = {}) { await run(store, "readwrite", s => s.put(withStoreKey(store, value))); if (!silent) emit([store]); return value; }
export async function putMany(store, values, { silent } = {}) {
  if (!values.length) return;
  const d = await open();
  await new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite"); const os = tx.objectStore(store);
    values.forEach(v => os.put(withStoreKey(store, v)));
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  if (!silent) emit([store]);
}

// Atomic local commit for multiple collections plus their queue item(s).
// entries: [{ store, value }] and queueEntries: [{...queue record}]
export async function writeGroup(entries, queueEntries = []) {
  const stores = [...new Set([...entries.map(x => x.store), ...(queueEntries.length ? ["queue"] : [])])];
  if (!stores.length) return;
  const d = await open();
  await new Promise((resolve, reject) => {
    const tx = d.transaction(stores, "readwrite");
    for (const item of entries) tx.objectStore(item.store).put(withStoreKey(item.store, item.value));
    for (const item of queueEntries) tx.objectStore("queue").put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Local database transaction was aborted."));
  });
  emit(stores);
}

export async function del(store, id, { silent } = {}) { await run(store, "readwrite", s => s.delete(id)); if (!silent) emit([store]); }
export const getMeta = async key => (await get("meta", key))?.value;
export const setMeta = (key, value) => put("meta", { key, value }, { silent: true });

export async function dumpAll({ includeQueue = false } = {}) {
  const out = {};
  for (const name of Object.keys(STORES)) {
    if (["meta", "backups"].includes(name) || (name === "queue" && !includeQueue)) continue;
    out[name] = await getAll(name);
  }
  return out;
}

// Preserve local recovery snapshots when an account/device is revoked.
export async function wipeAll({ preserveBackups = false } = {}) {
  const d = await open();
  const names = Object.keys(STORES).filter(n => !(preserveBackups && n === "backups"));
  await new Promise((resolve, reject) => {
    const tx = d.transaction(names, "readwrite");
    names.forEach(n => tx.objectStore(n).clear());
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  emit(names);
}
export const touch = emit;
