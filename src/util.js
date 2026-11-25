// Small shared helpers: money, dates, ids, unique-key normalisation.
export const num = n => Math.round(Number(n) || 0).toLocaleString("en-US");
export const money = n => `UGX ${num(n)}`;
// crypto.randomUUID only exists on HTTPS or localhost, so fall back to getRandomValues (works everywhere).
export const uuid = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
export const nowISO = () => new Date().toISOString();
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const rand = (n = 4) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPHA[b % ALPHA.length]).join("");
const p2 = n => String(n).padStart(2, "0");
export const ymd = d => { const x = new Date(d); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`; };
export const newSaleRef = () => `S-${ymd(new Date()).slice(2).replace(/-/g, "")}-${rand(4)}`;
export const fmtDT = iso => iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtD = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const toLocalInput = iso => { const d = iso ? new Date(iso) : new Date(); return `${ymd(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const fromLocalInput = v => v ? new Date(v).toISOString() : nowISO();
export const norm = s => String(s ?? "").trim().toLowerCase();
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const startOfWeek = (d = new Date()) => { const x = startOfDay(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; };
export const startOfMonth = (d = new Date()) => { const x = startOfDay(d); x.setDate(1); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

// Keys for the refIndex collection, which makes codes, sale references and frame numbers unique across devices.
const enc = s => encodeURIComponent(norm(s)).replace(/\./g, "%2E");
export function indexKey(col, rec) {
  if (!rec) return null;
  if (col === "products" && rec.code) return `prod_${enc(rec.code)}`;
  if (col === "sales" && rec.ref) return `sale_${enc(rec.ref)}`;
  if (col === "bicycles" && rec.frameNo) return `frame_${enc(rec.frameNo)}`;
  return null;
}

export function deviceId() {
  let id = localStorage.getItem("llbc.deviceId");
  if (!id) { id = uuid(); localStorage.setItem("llbc.deviceId", id); }
  return id;
}
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Unknown OS";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const kind = /Mobi|Android|iPhone/i.test(ua) ? "Phone" : "PC";
  return `${kind} · ${os} · ${br}`;
}
export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export const errText = e => (e && (e.message || e.code)) ? String(e.message || e.code) : String(e || "Unknown error");
