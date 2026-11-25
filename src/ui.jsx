import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export const NavCtx = createContext({ page: "sales", params: {}, go: () => {} });
export const useNav = () => useContext(NavCtx);

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => { const k = e => e.key === "Escape" && onClose?.(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, full, children }) => (
  <label className={`field ${full ? "full" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);
export const Badge = ({ tone = "muted", children }) => <span className={`badge ${tone}`}>{children}</span>;
export const Empty = ({ text }) => <div className="empty">{text}</div>;
export const Stat = ({ label, value, sub, tone }) => <div className={`stat ${tone || ""}`}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
export const Notice = ({ tone = "info", children }) => <div className={`notice ${tone}`}>{children}</div>;

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = "ok") => {
    const id = Math.random();
    setItems(i => [...i, { id, text, tone }]);
    setTimeout(() => setItems(i => i.filter(x => x.id !== id)), 4200);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" aria-live="polite">{items.map(t => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div></ToastCtx.Provider>;
}

// Searchable dropdown. items: [{ value, label, sub, disabled }]
export function Picker({ items, value, onChange, placeholder = "Search…" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const sel = items.find(i => i.value === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter(i => `${i.label} ${i.sub || ""}`.toLowerCase().includes(s)) : items).slice(0, 40);
  }, [items, q]);
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  return (
    <div className="picker" ref={ref}>
      <input value={open ? q : sel ? sel.label : ""} placeholder={placeholder} onFocus={() => { setOpen(true); setQ(""); }} onChange={e => { setQ(e.target.value); setOpen(true); }} />
      {open && <div className="picker-list">
        {shown.length === 0 && <div className="picker-empty">No match</div>}
        {shown.map(i => <button type="button" key={i.value} disabled={i.disabled} onClick={() => { onChange(i.value); setOpen(false); }}><span>{i.label}</span>{i.sub && <small>{i.sub}</small>}</button>)}
      </div>}
    </div>
  );
}

// Optional image: resized in the browser and stored as a small data URL (no paid storage service needed).
export function ImagePicker({ value, onChange }) {
  const pick = e => {
    const file = e.target.files?.[0]; if (!file) return;
    const img = new Image();
    img.onload = () => {
      const max = 480, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      onChange(c.toDataURL("image/jpeg", 0.72)); URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };
  return (
    <div className="imgpick">
      {value ? <img src={value} alt="" /> : <div className="imgph">No image</div>}
      <div><input type="file" accept="image/*" onChange={pick} />{value && <button type="button" className="btn ghost sm" onClick={() => onChange("")}>Remove</button>}</div>
    </div>
  );
}

export const Table = ({ children }) => <div className="tablewrap"><table>{children}</table></div>;
export const confirmBox = msg => window.confirm(msg);
