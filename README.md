# L.L Bicycle Center Management System (v1.0)

React + Vite PWA, IndexedDB (local-first), Firebase Authentication, Cloud Firestore, hosted on GitHub Pages. Amounts are in UGX.

## 1. Run it

```bash
npm ci
npm test          # business-logic tests (FIFO, profit, payments, discounts, reservations, conflicts)
npm run dev
npm run build     # verify the production bundle before deploying
```
Without a `.env` the app starts in **demo mode** (local only, no real security) so you can try every screen.

## 2. Connect Firebase (once)

1. Firebase console: enable **Authentication > Email/Password** and create **Firestore**.
2. Copy `.env.example` to `.env` and fill in your web app config (project id is already `l-l-sys` in `.firebaserc`).
3. Back up the current Firestore data, then deploy the updated security rules: `npx firebase-tools deploy --only firestore:rules`. Do not use the repaired payment/refund flows against the old rules.
4. Create the administrator **by hand, once**: add a user in Authentication, then in Firestore create `users/<that uid>` with
   `{ email, displayName, role: "admin", active: true }`. After that, create attendants from the **Staff** page.
5. First sign-in on the administrator's first device is approved automatically. Every other device waits in **Devices** for approval.

## 3. Deploy to GitHub Pages

Push to `main`. Add the six `VITE_FIREBASE_*` values as repository secrets and set Pages source to "GitHub Actions". The workflow in `.github/workflows/deploy.yml` tests, builds and publishes. The build uses a relative base, so it works under `https://user.github.io/repo/`.

## 4. How the spec is covered

| Spec area | Where |
|---|---|
| Roles, attendant opens in Sales | `App.jsx`, `Sales.jsx` |
| Products, administrator-created categories and configurable product details, unique codes, archive, price history | `Settings.jsx`, `Inventory.jsx`, `logic.js`, `refIndex` unique keys |
| Purchases create separate batches, FIFO, actual-cost profit | `Purchases.jsx`, `logic.js` |
| Stock alerts, manual adjustments with reason | `Dashboard.jsx`, `Inventory.jsx` |
| Multi-item sales, duplicate-submit protection, corrections, cancellations with audit | `Sales.jsx`, `SaleDetail.jsx` |
| Discount limits | `Settings.jsx`, `logic.js` (`maxDiscount`), rules (`discountOk`) |
| Cash / MTN / Airtel, split and partial payments, balances | `Sales.jsx`, `Balances.jsx` |
| Individual bicycles, reservations, refunds, sale and profit | `Bicycles.jsx` |
| Dashboard, reports, XLSX export, backups, archiving | `Dashboard.jsx`, `Reports.jsx`, `Backup.jsx`, `maintenance.js` |
| Staff, devices, activity log, manual Lock | `Staff.jsx`, `Devices.jsx`, `auth.jsx` |
| Offline-first sync, conflict flagging, status indicator | `db.js`, `records.js`, `sync.js`, `Conflicts.jsx` |
| Global search, light/dark theme, UGX with commas | `Search.jsx`, `styles.css`, `util.js` |

### Category setup

* The category list starts empty: there are no preset categories such as tyres or inner tubes. The administrator creates the categories used by the shop.
* Each category has its own code prefix and configurable product-detail fields. For each field, enter comma-separated choices for a dropdown or leave choices blank for free text.
* Category names, prefixes and fields can be edited. Deleting a category that already has products requires choosing a replacement category; product records are reassigned together with the settings save so they are not orphaned.

### Design decisions you should know about

* **Discount rule (was open in the spec):** limits apply **per sale line**. Default is "both must be met" (the stricter limit wins); the administrator can switch to "either is enough" in Settings.
* **Stock is derived, not stored as a counter.** Remaining quantity of each batch = received - sold (completed sales) - removed. Cancelling a sale returns stock automatically, and two offline devices can never overwrite each other's stock count.
* **Buying prices never reach attendants:** costs live in admin-only collections (`batchCosts`, `purchases`, `bicycleCosts`); sales carry only batch ids, and profit is computed on the administrator's device.
* **Selling prices and discounts are enforced by the security rules** per sale line, so an attendant cannot forge a price even with a modified client.
* **Reservations** track the deposit separately from actual refunds. If a bicycle is sold to someone else or a reservation is cancelled, the outstanding deposit is shown as refundable; it is not marked refunded until an administrator records the amount and method actually paid back.


## 5. Repair notes in this package

* Local multi-record changes and their queue entries are written in one IndexedDB transaction; matching Firestore operations are sent as one transaction.
* Failed queue items are retained. Discarding requires an internet connection and restores updated records from Firestore before removing unsynced creates.
* Sale cancellation and replacement are grouped together; cancellation no longer adds an extra `updatedAt` field that conflicts with the attendant rule.
* Additional payments update the sale's `paidTotal` in the same Firestore transaction as the payment record, with a server-side balance cap. Legacy sales are migrated by the administrator device after the initial cloud pull.
* Split-payment reports total the actual tender records, rather than repeating the full sale total for each method.
* Reservation deposits are not treated as refunds. Refunds are append-only records entered when an administrator confirms the amount and payment method.
* Bicycle buying-cost history preserves the cost effective at the sale date. Older bicycles without history receive a baseline using the recorded purchase date, or bicycle creation date when the purchase date is missing.
* Revoked-device recovery snapshots include pending queue records. Daily backup cleanup does not delete those recovery snapshots.
* The service worker only deletes caches belonging to this application.

## 6. Known limits (please read)

* **Rules and synchronisation have not been verified against your live Firebase project or the Firebase Emulator.** The automated logic tests pass and all 29 JavaScript/JSX source files pass syntax parsing. A production build could not be completed in this environment because the supplied dependency folder does not contain Rollup's Linux binary. Run `npm ci` and `npm run build` on your Windows PC or GitHub Actions before deployment, then test the Firestore rules on a Firebase test project before going live.
* **Device approval is enforced by the app, not fully by Firestore rules.** Plain Firebase Auth cannot tell the rules which device made a request. A deactivated device is signed out when it reconnects; unsynchronised local data is first copied to a device-local recovery snapshot when browser storage is available. A technical person with valid credentials could still query Firestore directly. Closing this fully needs a trusted backend that issues per-device claims.
* **Negative stock cannot be fully blocked by rules** (rules cannot add up batches). The app blocks it on each device; if two offline devices sell the last units, the problem is detected after sync and appears in **Conflicts** for the administrator.
* **Password reset** sends a reset email (Spark plan has no admin SDK). Use real attendant email addresses.
* **Daily backup** is a snapshot stored on the administrator's device (last 7 days) plus manual JSON/XLSX downloads. Firestore scheduled backups need a paid plan.
* A price change made while an attendant is offline can still make that attendant's old-price sale get rejected on sync; it remains in the local queue as a recoverable failed change and appears under Conflicts for the administrator.
* Opening stock must be entered as a purchase or an increase adjustment, with a cost, so profit is correct.
* Cached cost data stays in the administrator's browser. Give attendants their own browser profile or device.
* `public/logo.svg` is a placeholder; replace it with the shop's real logo (same file name).
