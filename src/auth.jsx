import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { EmailAuthProvider, browserSessionPersistence, onAuthStateChanged, reauthenticateWithCredential, setPersistence, signInWithEmailAndPassword, signOut as fbSignOut } from "firebase/auth";
import { doc, getDoc, onSnapshot, setDoc, updateDoc as fsUpdate } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "./firebase.js";
import { dumpAll, getMeta, put, setMeta, wipeAll } from "./db.js";
import { createGroup } from "./records.js";
import { startSync, stopSync, syncNow } from "./sync.js";
import { deviceId, deviceLabel, errText, nowISO, uuid } from "./util.js";

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

// ---- password check for the manual Lock screen (works offline; the hash lives only in this browser session) ----
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPassword(pw, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 }, key, 256);
  return `${b64(salt)}:${b64(bits)}`;
}
async function verifyPassword(pw, stored) { const [salt] = stored.split(":"); return (await hashPassword(pw, unb64(salt))) === stored; }

const LOCK_FLAG = "llbc.locked", LOCK_HASH = "llbc.lockhash";

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null, demo: false, error: "" });
  const [locked, setLocked] = useState(sessionStorage.getItem(LOCK_FLAG) === "1");
  const justSignedIn = useRef(false);
  const userRef = useRef(null);
  userRef.current = state.user;

  const logActivity = useCallback(async (type, user = userRef.current) => {
    if (!user || user.uid.startsWith("demo-")) return;
    await createGroup([{ col: "activity", rec: { id: uuid(), uid: user.uid, name: user.displayName, role: user.role, type, at: nowISO(), deviceId: deviceId() } }], user.uid);
  }, []);

  async function ensureLocalOwner(uid) {
    const owner = await getMeta("localOwner");
    if (owner && owner !== uid) {
      try {
        const snapshot = await dumpAll({ includeQueue: true });
        await put("backups", { id: `account-switch-${Date.now()}`, createdAt: nowISO(), kind: "account-switch-recovery", pendingCount: (snapshot.queue || []).length, json: JSON.stringify(snapshot) }, { silent: true });
        await wipeAll({ preserveBackups: true });
      } catch (e) {
        throw new Error("This browser contains local records for another account and could not safely archive them. Sign in to the original account or free device storage before switching accounts.");
      }
    }
    await setMeta("localOwner", uid);
  }

  async function ensureDevice(user, profile) {
    const id = `${user.uid}_${deviceId()}`;
    const ref = doc(db, "devices", id);
    try {
      const snap = await getDoc(ref);
      let status;
      if (!snap.exists()) {
        // The very first device of the administrator is approved automatically so the shop is never locked out.
        const first = user.role === "admin" && !profile.deviceBootstrapped;
        status = first ? "approved" : "pending";
        await setDoc(ref, { id, uid: user.uid, deviceId: deviceId(), userName: user.displayName, email: user.email, role: user.role, label: deviceLabel(), status, createdAt: nowISO(), lastSeen: nowISO() });
        if (first) await fsUpdate(doc(db, "users", user.uid), { deviceBootstrapped: true });
      } else {
        status = snap.data().status;
        const seen = snap.data().lastSeen || "";
        if (status === "approved" && nowISO().slice(0, 10) !== seen.slice(0, 10)) fsUpdate(ref, { lastSeen: nowISO() }).catch(() => null);
      }
      await setMeta(`device:${id}`, status);
      return { id, status };
    } catch (e) {
      const cached = await getMeta(`device:${id}`);
      return { id, status: cached || "pending", offline: true, error: errText(e) };
    }
  }

  async function bootstrap(fbUser) {
    let profile = null;
    try {
      const snap = await getDoc(doc(db, "users", fbUser.uid));
      profile = snap.exists() ? snap.data() : null;
      if (profile) await setMeta(`profile:${fbUser.uid}`, profile);
    } catch (e) { profile = (await getMeta(`profile:${fbUser.uid}`)) || null; }
    if (!profile || !["admin", "user"].includes(profile.role)) {
      await fbSignOut(auth);
      setState({ status: "signedout", user: null, demo: false, error: "This account has no role in the system. Ask the administrator to set it up." });
      return;
    }
    if (profile.active === false) {
      await fbSignOut(auth);
      setState({ status: "signedout", user: null, demo: false, error: "This account has been deactivated." });
      return;
    }
    const user = { uid: fbUser.uid, email: fbUser.email, displayName: profile.displayName || fbUser.email, role: profile.role };
    await ensureLocalOwner(user.uid);
    const device = await ensureDevice(user, profile);
    setState({ status: device.status === "approved" ? "ready" : device.status === "revoked" ? "revoked" : "pending", user, demo: false, error: "", deviceDocId: device.id, deviceError: device.error || "" });
    if (justSignedIn.current) { justSignedIn.current = false; logActivity("login", user); }
  }

  useEffect(() => {
    if (!firebaseConfigured) { setState({ status: "signedout", user: null, demo: true, error: "" }); return; }
    setPersistence(auth, browserSessionPersistence).catch(() => null);
    return onAuthStateChanged(auth, fbUser => {
      if (!fbUser) { setState(s => (s.demo ? s : { status: "signedout", user: null, demo: false, error: s.error })); return; }
      bootstrap(fbUser).catch(e => setState({ status: "signedout", user: null, demo: false, error: errText(e) }));
    });
  }, []);

  // Watch this device and account: revoking a device or deactivating the account takes effect as soon as it is online.
  useEffect(() => {
    if (!state.user || state.demo || !state.deviceDocId) return;
    const stopDev = onSnapshot(doc(db, "devices", state.deviceDocId), snap => {
      const st = snap.data()?.status;
      if (!st) return;
      if (st === "revoked") { forceSignOut("This device was deactivated by the administrator."); }
      else setState(s => (s.status === "pending" && st === "approved" ? { ...s, status: "ready" } : s));
    }, () => null);
    const stopUser = onSnapshot(doc(db, "users", state.user.uid), snap => {
      if (snap.exists() && snap.data().active === false) forceSignOut("This account has been deactivated.");
    }, () => null);
    return () => { stopDev(); stopUser(); };
  }, [state.user?.uid, state.deviceDocId, state.demo]);

  useEffect(() => {
    if (state.status === "ready" && !state.demo && state.user) { startSync(state.user); return () => stopSync(); }
  }, [state.status, state.user?.uid, state.demo]);

  async function forceSignOut(message) {
    stopSync();
    // Preserve a device-local recovery package (including queued changes) before
    // clearing business data. A revoked/offline device must not silently destroy
    // sales that had not yet reached Firestore.
    try {
      const snapshot = await dumpAll({ includeQueue: true });
      const pendingCount = (snapshot.queue || []).length;
      await put("backups", { id: `recovery-${Date.now()}`, createdAt: nowISO(), kind: "revocation-recovery", pendingCount, json: JSON.stringify(snapshot) }, { silent: true });
      await wipeAll({ preserveBackups: true });
    } catch (e) {
      // Keep local records intact if recovery storage fails; sign out without wiping.
      console.error("Local recovery snapshot failed; local records were retained.", e);
    }
    sessionStorage.clear();
    await fbSignOut(auth).catch(() => null);
    setLocked(false);
    setState({ status: "signedout", user: null, demo: false, error: message });
  }

  const api = {
    ...state, locked,
    async signIn(email, password) {
      justSignedIn.current = true;
      try {
        await setPersistence(auth, browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email.trim(), password);
        if (crypto.subtle) sessionStorage.setItem(LOCK_HASH, await hashPassword(password)); // not available on plain http; unlock then checks the password online
        sessionStorage.removeItem(LOCK_FLAG); setLocked(false);
      } catch (e) {
        justSignedIn.current = false;
        const code = e?.code || "";
        const msg = code.includes("network") ? "No internet connection. The first sign-in on a device needs internet." : code.includes("invalid") || code.includes("wrong-password") || code.includes("user-not-found") ? "Wrong email or password." : errText(e);
        setState(s => ({ ...s, error: msg })); throw new Error(msg);
      }
    },
    async signOut() {
      try { await logActivity("logout"); if (navigator.onLine) await Promise.race([syncNow(), new Promise(r => setTimeout(r, 4000))]); } catch (_) { /* queued for later */ }
      stopSync(); sessionStorage.removeItem(LOCK_FLAG); sessionStorage.removeItem(LOCK_HASH); setLocked(false);
      if (!state.demo) await fbSignOut(auth).catch(() => null);
      setState({ status: "signedout", user: null, demo: state.demo, error: "" });
    },
    // Lets the administrator approve the device they are signed in on (the rules only allow this for a real admin account).
    async approveThisDevice() {
      const id = state.deviceDocId, ref = doc(db, "devices", id), u = state.user;
      const snap = await getDoc(ref);
      if (!snap.exists()) await setDoc(ref, { id, uid: u.uid, deviceId: deviceId(), userName: u.displayName, email: u.email, role: u.role, label: deviceLabel(), status: "pending", createdAt: nowISO(), lastSeen: nowISO() });
      await fsUpdate(ref, { status: "approved" });
      await setMeta(`device:${id}`, "approved");
      setState(s => ({ ...s, status: "ready", deviceError: "" }));
    },
    enterDemo(role) {
      setState({ status: "ready", demo: true, error: "", user: { uid: `demo-${role}`, email: `${role}@demo.local`, displayName: role === "admin" ? "Demo administrator" : "Demo attendant", role } });
    },
    lock() { sessionStorage.setItem(LOCK_FLAG, "1"); setLocked(true); logActivity("lock"); },
    async unlock(password) {
      const stored = sessionStorage.getItem(LOCK_HASH);
      let ok = false;
      if (state.demo) ok = true;
      else if (stored) ok = await verifyPassword(password, stored);
      else if (auth.currentUser) { try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(state.user.email, password)); ok = true; } catch (_) { ok = false; } }
      if (ok) { sessionStorage.removeItem(LOCK_FLAG); setLocked(false); logActivity("unlock"); }
      return ok;
    }
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
