
import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "../auth.jsx";
import { useData } from "../store.jsx";
import { createGroup } from "../records.js";
import { Empty, Field, Modal, Notice, Picker, Table, useToast } from "../ui.jsx";
import {
  fmtDT,
  fromLocalInput,
  money,
  nowISO,
  toLocalInput,
  uuid,
  norm
} from "../util.js";

export default function Purchases() {
  const { data } = useData();
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState(null);

  const rows = [...data.purchases].sort((a, b) =>
    (b.receivedAt || "").localeCompare(a.receivedAt || "")
  );

  return (
    <div className="page">
      <div className="page-head">
        <h2>Stock purchases</h2>
        <button className="btn accent" onClick={() => setForm(true)}>
          <Plus size={16} /> Record purchase
        </button>
      </div>

      {rows.length === 0 ? (
        <Empty text="No purchases recorded yet. Every purchase creates its own stock batch." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Invoice / ref</th>
              <th>Received by</th>
              <th className="num">Items</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr
                key={p.id}
                className="click"
                onClick={() => setOpen(p)}
              >
                <td className="nowrap">{fmtDT(p.receivedAt)}</td>
                <td>{p.invoiceNo || "—"}</td>
                <td>{p.receivedBy}</td>
                <td className="num">
                  {(p.lines || []).reduce((t, l) => t + Number(l.qty || 0), 0)}
                </td>
                <td className="num">{money(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {form && <PurchaseForm onClose={() => setForm(false)} />}

      {open && (
        <Modal title="Purchase details" onClose={() => setOpen(null)}>
          <p className="muted">
            {fmtDT(open.receivedAt)} · Invoice {open.invoiceNo || "—"} ·
            Received by {open.receivedBy}
          </p>

          <Table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Qty</th>
                <th className="num">Cost each</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {(open.lines || []).map(l => (
                <tr key={l.batchId}>
                  <td>{l.code} · {l.name}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{money(l.unitCost)}</td>
                  <td className="num">{money(l.qty * l.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <b className="right">Total {money(open.total)}</b>
        </Modal>
      )}
    </div>
  );
}

function PurchaseForm({ onClose }) {
  const { user } = useAuth();
  const { data, st } = useData();
  const toast = useToast();

  const [invoiceNo, setInvoiceNo] = useState("");
  const [at, setAt] = useState(toLocalInput());
  const [by, setBy] = useState(user.displayName || "");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const [lines, setLines] = useState([
    { key: uuid(), productId: "", qty: "", unitCost: "" }
  ]);

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // Only active products can receive new purchase batches.
  // Include category and all configured attributes in the search label.
  const items = useMemo(() => {
    return data.products
      .filter(p => {
        if (p.archived) return false;

        if (
          categoryFilter !== "All" &&
          p.category !== categoryFilter
        ) {
          return false;
        }

        return true;
      })
      .map(p => {
        const attributes = Object.values(p.attrs || {})
          .filter(Boolean)
          .join(" ");

        return {
          value: p.id,
          label: [
            p.code,
            p.name,
            p.category,
            attributes
          ].filter(Boolean).join(" · ")
        };
      });
  }, [data.products, categoryFilter]);

  const set = (key, patch) => {
    setLines(ls =>
      ls.map(l => l.key === key ? { ...l, ...patch } : l)
    );
  };

  const total = lines.reduce(
    (t, l) =>
      t +
      (Number(l.qty) || 0) *
      (Number(l.unitCost) || 0),
    0
  );

  async function save() {
    if (saving) return;

    if (!by.trim()) {
      return setErr("Enter who received the stock.");
    }

    if (!at) {
      return setErr("Enter the date and time received.");
    }

    const valid = lines.filter(
      l => l.productId || l.qty !== "" || l.unitCost !== ""
    );

    if (!valid.length) {
      return setErr("Add at least one product.");
    }

    const id = uuid();
    const receivedAt = fromLocalInput(at);
    const outLines = [];

    for (const [i, l] of valid.entries()) {
      const p = data.products.find(x => x.id === l.productId);

      const qty = Number(l.qty);
      const unitCost = Number(l.unitCost);

      if (!p || p.archived) {
        return setErr(`Line ${i + 1}: choose an active product.`);
      }

      if (!Number.isInteger(qty) || qty <= 0) {
        return setErr(`Line ${i + 1}: quantity must be a whole number above 0.`);
      }

      if (
        l.unitCost === "" ||
        !Number.isFinite(unitCost) ||
        unitCost < 0
      ) {
        return setErr(`Line ${i + 1}: enter a valid buying price per unit.`);
      }

      outLines.push({
        productId: p.id,
        code: p.code,
        name: p.name,
        qty,
        unitCost: Math.round(unitCost),
        batchId: `${id}_${i}`
      });
    }

    setSaving(true);
    setErr("");

    try {
      const purchaseTotal = outLines.reduce(
        (t, l) => t + l.qty * l.unitCost,
        0
      );

      await createGroup(
        [
          {
            col: "purchases",
            rec: {
              id,
              supplier: "",
              invoiceNo: invoiceNo.trim(),
              receivedAt,
              receivedBy: by.trim(),
              lines: outLines,
              total: purchaseTotal,
              createdBy: user.uid,
              createdAt: nowISO()
            }
          },

          ...outLines.map(l => ({
            col: "batchStock",
            rec: {
              id: l.batchId,
              productId: l.productId,
              qty: l.qty,
              receivedAt,
              source: "purchase",
              purchaseId: id
            }
          })),

          ...outLines.map(l => ({
            col: "batchCosts",
            rec: {
              id: l.batchId,
              productId: l.productId,
              unitCost: l.unitCost
            }
          }))
        ],
        user.uid
      );

      toast("Purchase recorded. New stock batches created.");
      onClose();
    } catch (error) {
      console.error("Purchase save failed:", error);
      setErr(
        `Could not record purchase: ${error?.message || String(error)}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      wide
      title="Record purchase"
      onClose={onClose}
      footer={
        <>
          <b style={{ marginRight: "auto" }}>
            Total {money(total)}
          </b>

          <button
            className="btn ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>

          <button
            className="btn accent"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save purchase"}
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Invoice / reference number">
          <input
            value={invoiceNo}
            onChange={e => setInvoiceNo(e.target.value)}
          />
        </Field>

        <Field label="Date and time received">
          <input
            type="datetime-local"
            value={at}
            onChange={e => setAt(e.target.value)}
          />
        </Field>

        <Field label="Received by">
          <input
            value={by}
            onChange={e => setBy(e.target.value)}
          />
        </Field>
      </div>

      <h3>Products received</h3>

      <Field label="Filter products by category">
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
        >
          <option value="All">All categories</option>

          {(st.categories || []).map(c => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      {items.length === 0 && (
        <Notice tone="warn">
          No active products found in this category.
          Create the product under Settings → Products & stock first.
        </Notice>
      )}

      {lines.map(l => (
        <div
          className="cart-line"
          style={{ gridTemplateColumns: "1fr 100px 130px 34px" }}
          key={l.key}
        >
          <Picker
            items={items}
            value={l.productId}
            onChange={v => set(l.key, { productId: v })}
            placeholder="Search code, name, category or details"
          />

          <input
            type="number"
            min="1"
            step="1"
            placeholder="Qty"
            value={l.qty}
            onChange={e => set(l.key, { qty: e.target.value })}
            aria-label="Quantity"
          />

          <input
            type="number"
            min="0"
            step="1"
            placeholder="Cost each"
            value={l.unitCost}
            onChange={e => set(l.key, { unitCost: e.target.value })}
            aria-label="Buying price per unit"
          />

          <button
            className="icon-btn"
            onClick={() =>
              setLines(ls =>
                ls.length > 1
                  ? ls.filter(x => x.key !== l.key)
                  : ls
              )
            }
            aria-label="Remove line"
          >
            <Trash2 size={17} />
          </button>
        </div>
      ))}

      <button
        className="btn ghost sm"
        style={{ justifySelf: "start" }}
        onClick={() =>
          setLines(ls => [
            ...ls,
            { key: uuid(), productId: "", qty: "", unitCost: "" }
          ])
        }
      >
        <Plus size={15} /> Add product line
      </button>

      {err && <Notice tone="bad">{err}</Notice>}
    </Modal>
  );
}
