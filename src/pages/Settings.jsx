import React, { useEffect, useState } from "react";
import { useAuth } from "../auth.jsx";
import { useData } from "../store.jsx";
import { archiveOld } from "../maintenance.js";
import { commitGroup } from "../records.js";
import { syncNow } from "../sync.js";
import { Field, Notice, useToast } from "../ui.jsx";
import { fmtDT, money, nowISO, norm } from "../util.js";
import Inventory from "./Inventory.jsx";
import Bicycles from "./Bicycles.jsx";
import Balances from "./Balances.jsx";
import Staff from "./Staff.jsx";
import Devices from "./Devices.jsx";
import Backup from "./Backup.jsx";

export default function Settings() {
  const { user } = useAuth(); const { data, idx, st, sync, loaded } = useData(); const toast = useToast();
  const [f, setF] = useState({ lowStock: st.lowStock, discountPct: st.discountPct, discountFixed: st.discountFixed, discountRule: st.discountRule, archiveAfterDays: st.archiveAfterDays, autoBackup: st.autoBackup });
  const [theme, setTheme] = useState(localStorage.getItem("llbc.theme") || "system");
  const [categories, setCategories] = useState(st.categories || []);
  const [categoryName, setCategoryName] = useState("");
  const [categoryPrefix, setCategoryPrefix] = useState("");
  const [categoryRenames, setCategoryRenames] = useState({});
  const [categoryMoves, setCategoryMoves] = useState({});
  const [section, setSection] = useState("general");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (loaded) {
      setF({ lowStock: st.lowStock, discountPct: st.discountPct, discountFixed: st.discountFixed, discountRule: st.discountRule, archiveAfterDays: st.archiveAfterDays, autoBackup: st.autoBackup });
      // Keep the category editor aligned with the saved settings record.
      // Do not clear it here: saving categories updates `st`, and clearing on
      // that update made the saved categories disappear from Settings again.
      setCategories(Array.isArray(st.categories) ? st.categories : []);
    }
  }, [loaded, st]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function save() {
    if (saving) return;
    if (!loaded) return toast("Settings are still loading. Try again after the page finishes loading.", "bad");
    if (categories.some(c => !c.name.trim() || !/^[A-Z0-9]{2,6}$/.test(c.prefix || ""))) return toast("Every category needs a name and a 2–6 character code prefix.", "bad");
    if (new Set(categories.map(c => norm(c.name))).size !== categories.length || new Set(categories.map(c => c.prefix)).size !== categories.length) return toast("Category names and code prefixes must be unique.", "bad");
    const rec = { id: "main", categories, lowStock: Math.max(0, Math.floor(Number(f.lowStock) || 0)), discountPct: Math.max(0, Math.min(100, Number(f.discountPct) || 0)), discountFixed: Math.max(0, Math.floor(Number(f.discountFixed) || 0)), discountRule: f.discountRule, archiveAfterDays: Math.max(0, Math.floor(Number(f.archiveAfterDays) || 0)), autoBackup: !!f.autoBackup, updatedBy: user.displayName, updatedAt: nowISO() };
    const cur = data.settings.find(s => s.id === "main");
    const categoryMap = { ...categoryRenames, ...categoryMoves };
    const resolveCategory = original => {
      let value = original; const seen = new Set();
      while (categoryMap[value] && !seen.has(value)) { seen.add(value); value = categoryMap[value]; }
      return value;
    };
    const invalidTarget = Object.keys(categoryMap).some(source => {
      const target = resolveCategory(source);
      return target !== source && !categories.some(c => c.name === target);
    });
    if (invalidTarget) return toast("A category reassignment points to a category that no longer exists. Choose a valid replacement.", "bad");
    const productUpdates = data.products
      .map(p => ({ p, category: resolveCategory(p.category) }))
      .filter(x => x.category !== x.p.category)
      .map(({ p, category }) => ({ col: "products", rec: { ...p, category } }));
    const updates = [...(cur ? [{ col: "settings", rec: { ...cur, ...rec } }] : []), ...productUpdates];
    const creates = cur ? [] : [{ col: "settings", rec }];
    setSaving(true);
    try {
      await commitGroup(creates, updates, user.uid);
      setCategoryRenames({}); setCategoryMoves({});
      toast(productUpdates.length ? `Settings saved locally. Updated ${productUpdates.length} product categorisation(s).` : "Settings saved locally.");
      // Cloud upload runs separately; report its status in the Sync panel.
    } catch (error) {
      console.error("L.L Bicycle Center settings save failed:", error);
      toast(`Could not save settings: ${error?.message || String(error)}`, "bad");
    } finally {
      setSaving(false);
    }
  }
  function addCategory() {
    const name = categoryName.trim(); const prefix = categoryPrefix.trim().toUpperCase();
    if (!name || !/^[A-Z0-9]{2,6}$/.test(prefix)) return toast("Enter a category name and a 2–6 character code prefix.", "bad");
    if (categories.some(c => norm(c.name) === norm(name) || c.prefix === prefix)) return toast("That category name or code prefix is already in use.", "bad");
    setCategories(rows => [...rows, { name, prefix, single: name, fields: [] }]); setCategoryName(""); setCategoryPrefix("");
  }
  function updateCategory(index, patch) {
    const current = categories[index];
    if (patch.name && patch.name !== current.name) {
      setCategoryRenames(prev => {
        const original = Object.keys(prev).find(k => prev[k] === current.name) || current.name;
        return { ...prev, [original]: patch.name };
      });
      if (!patch.single && current.single === current.name) patch = { ...patch, single: patch.name };
    }
    setCategories(rows => rows.map((c, i) => i === index ? { ...c, ...patch } : c));
  }
  function productsInCategory(categoryName) {
    return data.products.filter(p => p.category === categoryName || categoryRenames[p.category] === categoryName);
  }
  function deleteCategory(index) {
    const c = categories[index];
    const used = productsInCategory(c.name);
    if (used.length) {
      const target = categoryMoves[c.name];
      if (!target || !categories.some(x => x.name === target && x.name !== c.name)) return toast("Choose another category for the products before deleting this one.", "bad");
      setCategoryMoves(prev => ({ ...prev, [c.name]: target }));
    }
    setCategories(rows => rows.filter((_, i) => i !== index));
  }
  function addField(index) { const c = categories[index]; updateCategory(index, { fields: [...(c.fields || []), { key: `option_${Date.now()}`, label: "New option", options: [] }] }); }
  function updateField(ci, fi, patch) { const c = categories[ci]; const fields = c.fields.map((f, i) => i === fi ? { ...f, ...patch } : f); updateCategory(ci, { fields }); }

  if (section === "products") return <div className="page"><div className="page-head"><h2>Settings · Products & stock</h2><button className="btn ghost" onClick={() => setSection("general")}>Back to settings</button></div><Inventory /></div>;
  if (section === "bicycles") return <div className="page"><div className="page-head"><h2>Settings · Bicycles</h2><button className="btn ghost" onClick={() => setSection("general")}>Back to settings</button></div><Bicycles /></div>;
  if (section === "balances") return <div className="page"><div className="page-head"><h2>Settings · Credit balances</h2><button className="btn ghost" onClick={() => setSection("general")}>Back to settings</button></div><Balances /></div>;
  if (section === "staff") return <div className="page"><div className="page-head"><h2>Settings · Staff & roles</h2><button className="btn ghost" onClick={() => setSection("general")}>Back to settings</button></div><Staff /></div>;
  if (section === "devices") return <div className="page"><div className="page-head"><h2>Settings · Devices</h2><button className="btn ghost" onClick={() => setSection("general")}>Back to settings</button></div><Devices /></div>;
  if (section === "backup") return <div className="page"><div className="page-head"><h2>Settings · Backup & export</h2><button className="btn ghost" onClick={() => setSection("general")}>Back to settings</button></div><Backup /></div>;

  return (
    <div className="page">
      <div className="page-head"><h2>Settings</h2><button className="btn accent" disabled={!loaded || saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button></div>
      <div className="panel"><h3>Manage shop data</h3><p className="muted">These tools are kept inside Settings so the main navigation stays simple.</p><div className="row" style={{flexWrap:"wrap"}}>{[["products","Products & stock"],["bicycles","Bicycles"],["balances","Credit balances"],["staff","Staff & roles"],["devices","Devices"],["backup","Backup & export"]].map(([key,label])=><button className="btn ghost" key={key} onClick={()=>setSection(key)}>{label}</button>)}</div></div>
      <div className="panel"><h3>Product categories and options</h3>
        <p className="muted">Start with a blank list and create only the categories your shop uses. Nothing is preselected. You can rename categories, change their code prefixes, add or remove product details, and delete categories. If a category already has products, move them to another category before deleting it. Leave option values empty for free-text entry; enter comma-separated values to create a selection list.</p>
        <div className="form"><Field label="New category"><input value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="e.g. Brake pads" /></Field><Field label="Product code prefix"><input value={categoryPrefix} onChange={e => setCategoryPrefix(e.target.value.toUpperCase())} placeholder="e.g. BRP" maxLength={6} /></Field></div>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={addCategory}>Add category</button>
        {categories.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No categories created yet. Add your first category above, for example any name you choose.</p>}
        {categories.map((c, ci) => {
          const used = productsInCategory(c.name).length;
          return <div className="subpanel" key={`${c.name}-${ci}`} style={{ marginTop: 12, padding: 12, border: "1px solid var(--line)", borderRadius: 10 }}>
          <div className="form"><Field label="Category name"><input value={c.name} onChange={e => updateCategory(ci, { name: e.target.value })} /></Field><Field label="Code prefix"><input value={c.prefix} onChange={e => updateCategory(ci, { prefix: e.target.value.toUpperCase() })} /></Field></div>
          <h4>Product details</h4>
          {(c.fields || []).map((fd, fi) => <div className="form" key={fd.key} style={{ alignItems: "end", marginBottom: 8 }}><Field label="Detail name"><input value={fd.label} onChange={e => updateField(ci, fi, { label: e.target.value })} /></Field><Field label="Selectable values (comma-separated; blank = type manually)"><input value={(fd.options || []).join(", ")} onChange={e => updateField(ci, fi, { options: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} placeholder="e.g. Front, Rear" /></Field><button className="btn ghost sm" onClick={() => updateCategory(ci, { fields: c.fields.filter((_, i) => i !== fi) })}>Remove</button></div>)}
          <button className="btn ghost sm" onClick={() => addField(ci)}>Add detail</button>
          {used > 0 && <Field label={`Move ${used} existing product(s) to before deleting`}><select value={categoryMoves[c.name] || ""} onChange={e => setCategoryMoves(prev => ({ ...prev, [c.name]: e.target.value }))}><option value="">Choose replacement category</option>{categories.filter(x => x.name !== c.name).map(x => <option key={x.name} value={x.name}>{x.name}</option>)}</select></Field>}
          <button className="btn danger sm" style={{ marginTop: 8 }} onClick={() => deleteCategory(ci)}>Delete category</button>
        </div>})}
        <p className="muted" style={{ marginTop: 10 }}>All category edits, renames, deletions and product reassignment are applied together when you click Save settings.</p>
      </div>
      <div className="panel"><h3>Stock alerts</h3><div className="form"><Field label="Minimum stock quantity (all products)" hint="Alerts appear at or below this number and at zero."><input type="number" min="0" value={f.lowStock} onChange={e => set("lowStock", e.target.value)} /></Field></div></div>
      <div className="panel"><h3>Discounts and negotiated prices</h3>
        <div className="form">
          <Field label="Percentage limit (% of the line value)"><input type="number" min="0" max="100" step="0.5" value={f.discountPct} onChange={e => set("discountPct", e.target.value)} /></Field>
          <Field label="Fixed limit (UGX per line)"><input type="number" min="0" value={f.discountFixed} onChange={e => set("discountFixed", e.target.value)} /></Field>
          <Field label="How the two limits combine" full><select value={f.discountRule} onChange={e => set("discountRule", e.target.value)}><option value="both">Both must be met (the stricter limit applies)</option><option value="either">Either is enough (the larger limit applies)</option></select></Field>
        </div>
        <p className="muted">Example on a {money(100000)} line: {f.discountRule === "both" ? `attendants can give up to ${money(Math.min(Math.floor(100000 * (Number(f.discountPct) || 0) / 100), Number(f.discountFixed) || 0))}` : `attendants can give up to ${money(Math.max(Math.floor(100000 * (Number(f.discountPct) || 0) / 100), Number(f.discountFixed) || 0))}`}. Attendants cannot change any selling price. Administrators are not limited.</p>
      </div>
      <div className="panel"><h3>Backup and archiving</h3><div className="form">
        <label className="row"><input type="checkbox" checked={f.autoBackup} onChange={e => set("autoBackup", e.target.checked)} /> Create a daily snapshot on this device</label>
        <Field label="Archive settled sales after (days, 0 = never)" hint="Archived records are kept forever and can be shown in Sales history."><input type="number" min="0" value={f.archiveAfterDays} onChange={e => set("archiveAfterDays", e.target.value)} /></Field>
      </div><button className="btn ghost" style={{ marginTop: 10 }} onClick={async () => toast(`${await archiveOld(data, idx, st, user)} record(s) archived.`)}>Run archiving now</button></div>
      <div className="panel"><h3>Appearance</h3><Field label="Theme"><select value={theme} onChange={e => { setTheme(e.target.value); localStorage.setItem("llbc.theme", e.target.value); if (e.target.value === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = e.target.value; }}><option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></Field></div>
      <div className="panel"><h3>Synchronisation</h3>
        <p>Status: <b>{sync.state}</b> · waiting to send: {sync.pending} · problems: {sync.failed} · last sync: {fmtDT(sync.lastSync)}</p>
        {sync.error && <Notice tone="warn">{sync.error}</Notice>}
        <button className="btn ghost" onClick={syncNow}>Sync now</button></div>
    </div>
  );
}
