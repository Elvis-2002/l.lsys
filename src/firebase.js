import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseConfigured = Object.values(config).every(v => v && v !== "replace_me");
const app = firebaseConfigured ? (getApps().find(a => a.name === "[DEFAULT]") || initializeApp(config)) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
// A second Auth instance lets the administrator create attendant accounts without being signed out.
const accountApp = firebaseConfigured ? (getApps().find(a => a.name === "llbc-account-admin") || initializeApp(config, "llbc-account-admin")) : null;
export const accountAuth = accountApp ? getAuth(accountApp) : null;
