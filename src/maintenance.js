// Daily local snapshot and archiving of old settled records.
import { dumpAll, getAll, getMeta, put, del, setMeta } from "./db.js";
import { updateDoc } from "./records.js";
import { nowISO, ymd } from "./util.js";

export async function runDailyBackup() {
  const today = ymd(new Date());
  if ((await getMeta("lastBackup")) === today) return false;
  const dump = await dumpAll({ includeQueue: true });
  await put("backups", { id: today, createdAt: nowISO(), kind: "automatic", json: JSON.stringify(dump) }, { silent: true });
  const all = (await getAll("backups")).filter(x => x.kind === "automatic").sort((a, b) => b.id.localeCompare(a.id));
  for (const old of all.slice(7)) await del("backups", old.id, { silent: true }); // keep 7 daily snapshots; never delete recovery snapshots here
  await setMeta("lastBackup", today);
  return true;
}

// Marks settled sales older than the configured period as archived. Archived records stay stored and searchable.
export async function archiveOld(data, idx, st, user) {
  if (!(st.archiveAfterDays > 0)) return 0;
  const cutoff = new Date(Date.now() - st.archiveAfterDays * 86400000).toISOString();
  const raw = new Map(data.sales.map(s => [s.id, s]));
  let n = 0;
  for (const s of idx.salesView) {
    if (n >= 200) break;
    const r = raw.get(s.id);
    if (!r || r.archived || s.createdAt >= cutoff) continue;
    if (s.status === "cancelled" || s.payStatus === "Paid") { await updateDoc("sales", { ...r, archived: true }, user.uid); n++; }
  }
  return n;
}
