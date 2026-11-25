import React, { useEffect, useState } from "react";
import { Lock, LogOut, Menu, Moon, Sun } from "lucide-react";
import { AuthProvider, useAuth } from "./auth.jsx";
import { DataProvider, useData } from "./store.jsx";
import { NavCtx, ToastProvider, Notice } from "./ui.jsx";
import { NAV_ADMIN, NAV_USER } from "./constants.js";
import { firebaseConfigured } from "./firebase.js";
import Search from "./pages/Search.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Sales from "./pages/Sales.jsx";
import Inventory from "./pages/Inventory.jsx";
import Purchases from "./pages/Purchases.jsx";
import Bicycles from "./pages/Bicycles.jsx";
import Balances from "./pages/Balances.jsx";
import Reports from "./pages/Reports.jsx";
import Staff from "./pages/Staff.jsx";
import Devices from "./pages/Devices.jsx";
import Conflicts from "./pages/Conflicts.jsx";
import Backup from "./pages/Backup.jsx";
import Settings from "./pages/Settings.jsx";
import StockView from "./pages/StockView.jsx";

const PAGES = { dashboard: Dashboard, sales: Sales, stock: StockView, inventory: Inventory, purchases: Purchases, bicycles: Bicycles, balances: Balances, reports: Reports, staff: Staff, devices: Devices, conflicts: Conflicts, backup: Backup, settings: Settings };

function applyTheme(t) { if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

function Shell() {
  const auth = useAuth();
  const { isAdmin, sync, openConflicts, st } = useData();
  const nav = isAdmin ? NAV_ADMIN : NAV_USER;
  const [route, setRoute] = useState({ page: isAdmin ? "dashboard" : "sales", params: {} });
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("llbc.theme") || "system");
  const [pw, setPw] = useState(""); const [pwErr, setPwErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { applyTheme(theme); localStorage.setItem("llbc.theme", theme); }, [theme]);

  const go = (page, params = {}) => { setRoute({ page, params, at: Date.now() }); setOpen(false); };
  const Page = PAGES[route.page] || Sales;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const label = { online: "Online", offline: "Offline", syncing: "Syncing…", failed: "Sync failed" }[sync.state] || "Online";

  async function unlock(e) {
    e.preventDefault(); setBusy(true); setPwErr("");
    const ok = await auth.unlock(pw).catch(() => false);
    setBusy(false);
    if (ok) setPw(""); else setPwErr("Wrong password.");
  }

  return (
    <NavCtx.Provider value={{ ...route, go }}>
      <div className="app">
        <header className="top">
          <button className="icon-btn menu-btn" onClick={() => setOpen(o => !o)} aria-label="Menu"><Menu size={20} /></button>
          <div className="brand"><img src="./logo.svg" alt="" /><span>L.L Bicycle Center</span></div>
          <Search />
          <div className="spacer" />
          <span className={`sync ${sync.state}`} title={sync.error || (sync.pending ? `${sync.pending} change(s) waiting to sync` : "All changes synced")}>{label}{sync.pending > 0 ? ` · ${sync.pending}` : ""}</span>
          <button className="icon-btn" onClick={() => setTheme(dark ? "light" : "dark")} aria-label="Toggle light and dark theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button className="icon-btn" onClick={auth.lock} aria-label="Lock screen" title="Lock"><Lock size={18} /></button>
          <button className="icon-btn" onClick={auth.signOut} aria-label="Sign out" title={`Sign out ${auth.user.displayName}`}><LogOut size={18} /></button>
        </header>
        <nav className={`side ${open ? "open" : ""}`}>
          {nav.map(([key, text]) => (
            <button key={key} className={route.page === key ? "on" : ""} onClick={() => go(key)}>
              <span>{text}</span>{key === "conflicts" && openConflicts > 0 && <span className="badge bad">{openConflicts}</span>}
            </button>
          ))}
          <div className="muted" style={{ padding: "14px 12px", fontSize: ".8rem" }}>{auth.user.displayName}<br />{auth.user.role === "admin" ? "Administrator" : "Sales attendant"}</div>
        </nav>
        <main className="main">
          {!firebaseConfigured && <Notice tone="warn">Demo mode: Firebase is not configured. Data stays in this browser only and roles are not secure.</Notice>}
          <Page key={route.page + (route.at || "")} />
        </main>
      </div>
      {auth.locked && (
        <div className="lock"><form onSubmit={unlock}>
          <img src="./logo.svg" alt="" width="48" height="48" />
          <h3>Locked</h3><span className="muted">{auth.user.displayName}, enter your password to continue.</span>
          <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" />
          {pwErr && <span style={{ color: "var(--bad)" }}>{pwErr}</span>}
          <button className="btn accent" disabled={busy || !pw}>Unlock</button>
        </form></div>
      )}
    </NavCtx.Provider>
  );
}

function PendingScreen({ auth }) {
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const pending = auth.status === "pending";
  async function approve() { setBusy(true); setErr(""); try { await auth.approveThisDevice(); } catch (e) { setErr(`${e.code || ""} ${e.message || e}`.trim()); } setBusy(false); }
  return (
    <div className="login"><div className="login-card">
      <img src="./logo.svg" alt="" /><h3>{pending ? "Waiting for approval" : "Device deactivated"}</h3>
      <p className="muted">{pending ? "This device is new. The administrator must approve it before it can open business data. This screen updates by itself once approved." : "The administrator deactivated this device."}</p>
      {auth.deviceError && <Notice tone="warn">Could not register this device: {auth.deviceError}</Notice>}
      {pending && auth.user?.role === "admin" && <button className="btn accent" disabled={busy} onClick={approve}>{busy ? "Approving…" : "Approve this device (administrator)"}</button>}
      {err && <Notice tone="bad">{err}. If this says permission-denied, publish firestore.rules and check that your users document has role "admin" and active true.</Notice>}
      <button className="btn ghost" onClick={auth.signOut}>Sign out</button>
    </div></div>
  );
}

function Gate() {
  const auth = useAuth();
  if (auth.status === "loading") return <div className="login"><div className="login-card"><img src="./logo.svg" alt="" /><span className="muted">Loading…</span></div></div>;
  if (auth.status === "signedout") return <Login />;
  if (auth.status === "pending" || auth.status === "revoked") {
    return (
      <PendingScreen auth={auth} />
    );
  }
  return <DataProvider><Shell /></DataProvider>;
}

export default function App() {
  return <AuthProvider><ToastProvider><Gate /></ToastProvider></AuthProvider>;
}
