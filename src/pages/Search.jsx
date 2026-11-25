import React, { useMemo, useState } from "react";
import { Search as Icon } from "lucide-react";
import { useData } from "../store.jsx";
import { Badge, Modal, useNav } from "../ui.jsx";
import { money, norm } from "../util.js";
import SaleDetail from "./SaleDetail.jsx";

export default function Search() {
  const { data, idx, isAdmin } = useData();
  const nav = useNav();
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false);
  const [sale, setSale] = useState(null); const [quick, setQuick] = useState(null);
  const s = norm(q);
  const res = useMemo(() => {
    if (s.length < 2) return null;
    const products = data.products.filter(p => norm(`${p.name} ${p.code}`).includes(s)).slice(0, 6);
    const bikes = data.bicycles.filter(b => norm(`${b.frameNo} ${b.brand} ${b.model}`).includes(s)).slice(0, 6);
    const sales = data.sales.filter(x => norm(x.ref).includes(s)).slice(0, 6);
    return { products, bikes, sales };
  }, [s, data.products, data.bicycles, data.sales]);
  const none = res && !res.products.length && !res.bikes.length && !res.sales.length;
  const close = () => { setOpen(false); setQ(""); };
  return (
    <div className="search">
      <div style={{ position: "relative" }}>
        <Icon size={16} style={{ position: "absolute", left: 9, top: 11, opacity: .7 }} />
        <input style={{ paddingLeft: 30 }} placeholder="Search product, frame number or sale reference" value={q} onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); }} aria-label="Global search" />
      </div>
      {open && res && (
        <div className="search-results">
          {none && <div className="empty">Nothing found for “{q}”.</div>}
          {res.products.length > 0 && <h4>Spare parts</h4>}
          {res.products.map(p => <button key={p.id} onClick={() => { close(); isAdmin ? nav.go("inventory", { focus: p.id }) : setQuick({ type: "product", p }); }}><span>{p.code} · {p.name}</span><span>{idx.stock.get(p.id) || 0} in stock</span></button>)}
          {res.bikes.length > 0 && <h4>Bicycles</h4>}
          {res.bikes.map(b => <button key={b.id} onClick={() => { close(); isAdmin ? nav.go("bicycles", { focus: b.id }) : setQuick({ type: "bike", b }); }}><span>{b.brand} {b.model} · {b.frameNo}</span><Badge tone={idx.bikes.get(b.id)?.status === "Sold" ? "muted" : "ok"}>{idx.bikes.get(b.id)?.status}</Badge></button>)}
          {res.sales.length > 0 && <h4>Sales</h4>}
          {res.sales.map(x => <button key={x.id} onClick={() => { close(); setSale(x.id); }}><span>{x.ref}</span><span>{money(idx.saleById.get(x.id)?.total)}</span></button>)}
        </div>
      )}
      {sale && <SaleDetail saleId={sale} onClose={() => setSale(null)} />}
      {quick && (
        <Modal title={quick.type === "product" ? quick.p.name : `${quick.b.brand} ${quick.b.model}`} onClose={() => setQuick(null)}>
          {quick.type === "product"
            ? <dl className="kv"><dt>Code</dt><dd>{quick.p.code}</dd><dt>Category</dt><dd>{quick.p.category}</dd><dt>Selling price</dt><dd>{money(quick.p.sellPrice)}</dd><dt>In stock</dt><dd>{idx.stock.get(quick.p.id) || 0}</dd></dl>
            : <dl className="kv"><dt>Frame / serial</dt><dd>{quick.b.frameNo}</dd><dt>Type</dt><dd>{quick.b.type}</dd><dt>Colour</dt><dd>{quick.b.colour}</dd><dt>Selling price</dt><dd>{money(quick.b.sellPrice)}</dd><dt>Status</dt><dd>{idx.bikes.get(quick.b.id)?.status}</dd></dl>}
        </Modal>
      )}
    </div>
  );
}
