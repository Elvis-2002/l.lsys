# L.L Ledger: GitHub Pages + Firebase, with admin and attendant logins

1. Firebase console > Authentication > turn on Email/Password. Add one user per person (owner, attendants).
2. Firestore Database must exist. Open `cloud.js`, paste `apiKey` and `appId` from Project settings > Your apps > Web app.
3. Give each person a role. In Firestore create: collection `shops` > document `main` > collection `staff` > document whose ID is that person's User UID (copy it from Authentication). Fields: `role` = `admin` or `attendant`, and `name`.
4. Rules: put the contents of `firestore.rules` in Firestore > Rules and publish. If this is the same project as the old L.L system, MERGE the `match /shops/main/...` blocks into the existing rules instead; publishing this file alone replaces the old rules.
5. GitHub: put these files in the root of a repository, then Settings > Pages > Deploy from branch > main / root.
6. Open the Pages link on each phone and use "Add to Home Screen". It then opens offline.

What attendants can do: record sales (parts and bicycles), search products and bicycles, see stock. They cannot see buying costs, profit, expenses, week/month reports or backups, and cannot delete or edit anything.
What the admin can do: everything, including adding bicycles and products, restocking, expenses, reports and backups.

Without step 2 the ledger still works as one device-only ledger with full access.
