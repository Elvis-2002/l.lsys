import React, { useEffect, useState } from "react";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut as fbSignOut } from "firebase/auth";
import { collection, doc, getDocs, setDoc, updateDoc as fsUpdate } from "firebase/firestore";
import { auth, accountAuth, db, firebaseConfigured } from "../firebase.js";
import { useAuth } from "../auth.jsx";
import { useData } from "../store.jsx";
import { Badge, Field, Modal, Notice, Table, useToast } from "../ui.jsx";
import { errText, fmtDT, nowISO } from "../util.js";

export default function Staff() {
  const { user } = useAuth(); const { data } = useData(); const toast = useToast();
  const [users, setUsers] = useState([]); const [err, setErr] = useState(""); const [form, setForm] = useState(null); const [busy, setBusy] = useState(false);
  const load = async () => { try { const s = await getDocs(collection(db, "users")); setUsers(s.docs.map(d => ({ id: d.id, ...d.data() }))); setErr(""); } catch (e) { setErr("Staff accounts need an internet connection. " + errText(e)); } };
  useEffect(() => { if (firebaseConfigured) load(); }, []);
  if (!firebaseConfigured) return <div className="page"><h2>Staff</h2><Notice tone="warn">Staff accounts need Firebase. Configure it in .env first.</Notice></div>;

  async function create() {
    const { name, email, password } = form;
    if (!name.trim() || !email.trim()) return setErr("Enter the attendant name and email.");
    if (password.length < 6) return setErr("The password must have at least 6 characters.");
    setBusy(true); setErr("");
    try {
      const cred = await createUserWithEmailAndPassword(accountAuth, email.trim(), password);
      await setDoc(doc(db, "users", cred.user.uid), { email: email.trim(), displayName: name.trim(), role: "user", active: true, createdAt: nowISO(), createdBy: user.uid });
      await fbSignOut(accountAuth);
      toast("Attendant account created."); setForm(null); load();
    } catch (e) { setErr(e.code === "auth/email-already-in-use" ? "That email already has an account." : errText(e)); }
    setBusy(false);
  }
  const toggle = async u => { await fsUpdate(doc(db, "users", u.id), { active: u.active === false }); toast(u.active === false ? "Account reactivated." : "Account deactivated. Access ends as soon as the device is online."); load(); };
  const reset = async u => { if (!window.confirm(`Send a password reset email to ${u.email}?`)) return; try { await sendPasswordResetEmail(auth, u.email); toast("Password reset email sent."); } catch (e) { toast(errText(e), "bad"); } };
  const names = new Map(users.map(u => [u.id, u.displayName]));
  return (
    <div className="page">
      <div className="page-head"><h2>Staff accounts</h2><button className="btn accent" onClick={() => { setForm({ name: "", email: "", password: "" }); setErr(""); }}>Add attendant</button></div>
      {err && !form && <Notice tone="warn">{err}</Notice>}
      <Table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>
        {users.map(u => <tr key={u.id}><td>{u.displayName}</td><td>{u.email}</td><td>{u.role === "admin" ? "Administrator" : "Sales attendant"}</td><td><Badge tone={u.active === false ? "bad" : "ok"}>{u.active === false ? "Deactivated" : "Active"}</Badge></td>
          <td className="nowrap">{u.role === "user" && <><button className="btn ghost sm" onClick={() => toggle(u)}>{u.active === false ? "Reactivate" : "Deactivate"}</button> <button className="btn ghost sm" onClick={() => reset(u)}>Reset password</button></>}</td></tr>)}</tbody></Table>
      <h3>Sign-in and sign-out activity</h3>
      <Table><thead><tr><th>When</th><th>Account</th><th>Activity</th></tr></thead><tbody>
        {[...data.activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100).map(a => <tr key={a.id}><td>{fmtDT(a.at)}</td><td>{a.name || names.get(a.uid) || a.uid}</td><td>{a.type}</td></tr>)}</tbody></Table>
      {form && <Modal title="Add sales attendant" onClose={() => setForm(null)} footer={<><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn accent" disabled={busy} onClick={create}>Create account</button></>}>
        <div className="form"><Field label="Full name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="Email" hint="Use a real email so password reset works."><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field><Field label="Temporary password" full><input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field></div>
        {err && <Notice tone="bad">{err}</Notice>}
      </Modal>}
    </div>
  );
}
