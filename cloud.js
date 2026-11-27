// Cloud sync for the ledger: Firebase sign-in, staff roles and Firestore with offline saving.
// Paste your web app config from the Firebase console (Project settings > Your apps).
// These values are not secrets; the Firestore rules protect the data.
const CONFIG = {
  apiKey: "AIzaSyAiv6m8gBi033mC_edSpOY0747bMqOSlCY",
  authDomain: "l-l-sys.firebaseapp.com",
  projectId: "l-l-sys",
  appId: "1:485891874975:web:615501ee240afa9fb302aa"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { writesFor, deletesFor, mergeAll } from "./sync-logic.js";

const box = document.getElementById("cloud");
const say = (html) => { box.innerHTML = html; };
const BASE = "shops/main/";
const SEEN = "ll_cloud_seen_v1";
const lock = (on) => document.body.classList.toggle("locked", on);

if (!CONFIG.apiKey || CONFIG.apiKey.startsWith("PASTE")) {
  say('<span style="color:var(--mut)">Saving on this device only. Add your Firebase config in cloud.js to turn on logins and sync.</span>');
} else {
  lock(true);
  const app = initializeApp(CONFIG);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  let role = null, raw = {}, unsubs = [], loaded = {}, need = [], pending = false;
  const A = () => window.LLApp;
  const fail = (e) => say('<span class="low">Could not sync: ' + (e.code || e.message) + '</span>');

  window.LLCloud = {
    put(c, o) { if (role) writesFor(c, o, role).forEach(([p, d, opt]) => setDoc(doc(db, BASE + p), d, opt || {}).catch(fail)); },
    del(c, id) { if (role === "admin") deletesFor(c, id).forEach(p => deleteDoc(doc(db, BASE + p)).catch(() => {})); }
  };

  function formView() {
    lock(true);
    say('<input id="cm" type="email" placeholder="Email" autocomplete="username"><input id="cp" type="password" placeholder="Password" autocomplete="current-password"><button class="btn pri" id="cin">Sign in</button><span id="cerr" class="low"></span>');
    document.getElementById("cin").onclick = async () => {
      try { await signInWithEmailAndPassword(auth, document.getElementById("cm").value.trim(), document.getElementById("cp").value); }
      catch (e) { document.getElementById("cerr").textContent = "Sign-in failed. Check the email and password."; }
    };
  }
  function status() {
    const u = auth.currentUser; if (!u || !role) return;
    const txt = !navigator.onLine ? "Offline. Entries are saved here and will sync when you are back online." : pending ? "Waiting to sync" : "Synced";
    say('<span>' + txt + ' · ' + (role === "admin" ? "Admin" : "Attendant") + ' · ' + u.email + '</span><button class="btn" id="cout">Sign out</button>');
    document.getElementById("cout").onclick = () => signOut(auth);
  }
  addEventListener("online", status); addEventListener("offline", status);

  function firstUpload() {
    // First sign-in on this device: send anything only stored here up to the cloud (administrators only).
    if (role !== "admin" || localStorage.getItem(SEEN)) return;
    const App = A(), ids = (arr) => new Set((arr || []).map(x => String(x.id)));
    const have = { products: ids(raw.products), bikes: ids(raw.bikes), entries: new Set([...ids(raw.entries), ...ids(raw.expenses)]) };
    ["products", "bikes", "entries"].forEach(c => (App.S[c] || []).forEach(x => { if (!have[c].has(String(x.id))) window.LLCloud.put(c, x); }));
    localStorage.setItem(SEEN, "1");
  }

  function apply() {
    const App = A(); if (!App) return;
    const m = mergeAll(raw);
    App.S.products = m.products; App.S.bikes = m.bikes; App.S.entries = m.entries;
    App.save(); App.saveP(); App.saveB();
    status();
    const ae = document.activeElement;
    if (!(ae && ae.closest && ae.closest("#view") && /INPUT|SELECT|TEXTAREA/.test(ae.tagName))) App.render();
  }

  function watch(c) {
    return onSnapshot(collection(db, BASE + c), snap => {
      raw[c] = snap.docs.map(d => d.data());
      pending = snap.metadata.hasPendingWrites;
      if (!loaded[c]) { loaded[c] = true; if (!need.every(n => loaded[n])) return; firstUpload(); }
      else if (!need.every(n => loaded[n])) return;
      apply();
    }, fail);
  }

  onAuthStateChanged(auth, async user => {
    unsubs.forEach(f => f()); unsubs = []; role = null; raw = {}; loaded = {};
    if (!user) { formView(); return; }
    say("Checking your account…");
    try { const s = await getDoc(doc(db, BASE + "staff/" + user.uid)); role = s.exists() ? (s.data().role === "admin" ? "admin" : "attendant") : null; }
        catch (e) { role = null; window.LLErr = e.code || e.message; }
    if (!role) {
      lock(true);
           say('<span class="low">This account is not set up for the ledger yet. Ask the owner to add it.<br>UID: ' + user.uid + '<br>Error: ' + (window.LLErr || "none, document not found") + '</span><button class="btn" id="cout">Sign out</button>');
      document.getElementById("cout").onclick = () => signOut(auth);
      return;
    }
    lock(false); A().setRole(role);
    need = ["products", "bikes", "entries"].concat(role === "admin" ? ["costs", "expenses"] : []);
    say("Loading…");
    unsubs = need.map(watch);
  });
}
