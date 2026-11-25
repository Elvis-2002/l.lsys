import React, { useState } from "react";
import { useAuth } from "../auth.jsx";
import { firebaseConfigured } from "../firebase.js";
import { Notice } from "../ui.jsx";

export default function Login() {
  const auth = useAuth();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await auth.signIn(email, password); } catch (ex) { setErr(ex.message); }
    setBusy(false);
  }
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="./logo.svg" alt="" />
        <div><h2>L.L Bicycle Center</h2><span className="muted">Inventory and sales</span></div>
        {!firebaseConfigured && <Notice tone="warn">Firebase is not configured, so only local demo mode is available. Demo roles are not secure.</Notice>}
        {auth.error && <Notice tone="bad">{auth.error}</Notice>}
        {firebaseConfigured && <>
          <label className="field"><span>Email</span><input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="field"><span>Password</span><input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          {err && <span style={{ color: "var(--bad)" }}>{err}</span>}
          <button className="btn accent" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <small className="muted">The first sign-in on a device, and every sign-in after the device restarts, needs internet.</small>
        </>}
        {!firebaseConfigured && <div className="row"><button type="button" className="btn" onClick={() => auth.enterDemo("admin")}>Demo: administrator</button><button type="button" className="btn ghost" onClick={() => auth.enterDemo("user")}>Demo: attendant</button></div>}
      </form>
    </div>
  );
}
