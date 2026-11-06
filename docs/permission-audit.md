# Permission audit (T22, 6 November 2026)

Rule 3 of CLAUDE.md: any signed-in user reads everything; a write needs the owner, `sales_lead`, `ceo` or `admin`, checked
in code (`assertCanEdit*`) **and** repeated in the `UPDATE`'s `WHERE` (`can_edit_*()` in SQL, which also checks the user is active).
Columns: **Role from DB** = the role is read from `users` for this write (the sign-in cookie can be up to 5 minutes behind,
`ROLE_RECHECK_MS`); **WHERE repeats** = the write's own SQL repeats the check.

## main (this branch)

| Entry point | Who may | Check in code | Role from DB | WHERE repeats |
| --- | --- | --- | --- | --- |
| `signOutAction` | anyone | none needed | n/a | n/a |
| `setSalesFilter` | signed in | `requireUser`; value must be an active rep, else "all" | n/a (a view filter, writes only a cookie) | n/a |
| `saveDealAction` → `saveDeal` (new) | rep, lead, ceo, admin | `assertCanCreate` (active + role in SQL) | yes | n/a (INSERT) |
| `saveDealAction` → `saveDeal` (edit) | owner, lead, ceo, admin | `assertCanEditDeal` | yes (**fixed**: owner hand-over used the cookie role) | yes `can_edit_deal` |
| `lookupCompanies`, `lookupContact`, `lookupParents`, `lookupCode`, `lookupPhone` | signed in | `requireUser` | no (read only) | n/a |
| `moveDealAction` → `moveDeal` | owner, lead, ceo, admin | `assertCanEditDeal` | yes (in `can_edit_deal`) | yes |
| `saveContactAction` → `saveContact` | create: rep, lead, ceo, admin; edit: owner, lead, ceo, admin | `assertCanEditContact` / role query | yes | yes `can_edit_contact` |
| `logActivityAction` → `logActivity` | same as edit contact | `assertCanEditContact` | yes | yes (INSERT … SELECT … WHERE) |
| `saveCompanyAction` → `saveCompany` | same as contact | `assertCanEditCompany` / role query | yes | yes `can_edit_company` |
| `markContactedAction`, `markNotFitAction` | owner, unowned, lead, ceo, admin | `assertCanEditLead` | yes | yes `can_edit_lead` |
| `reassignLeadAction` | lead, ceo, admin | `assertRole` + `assertCanEditLead` | yes (an `EXISTS` on `users` in the UPDATE) | yes |
| `createLead` (Tambah cepat) → `ingestLead` | rep, lead, ceo, admin | active actor with a sales role, checked in the transaction | yes | n/a (INSERT) |
| `loadBellAction`, `markReadAction`, `markAllReadAction`, `unreadCountAction` | the person, own rows | `requireUser` | n/a | yes (`user_id = me`) |
| `saveTargetsAction` | admin, ceo, sales_lead | `runSave` + `assertTargetSetter` | yes (`runSave` reads it) | n/a (global table) |
| `saveRulesAction`, `saveProbabilitiesAction`, `saveDefinitionsAction`, `saveTeamAction`, `addMemberAction`, `saveCatalogAction` | admin, ceo | `runSave` + `assertSettingsOwner` | yes | n/a (global tables) |
| `saveCampaignOwnersAction`, `saveAdSetLinesAction`, `saveAdCodesAction` | admin, ceo, marketing | `runSave` + `assertAdsRole` | yes | n/a; UPDATE matches the value the page showed (stale saves are refused) |
| Sign-in actions on `/masuk` | public | Auth.js; wrong passwords limited (see below) | n/a | n/a |
| `GET /api/auth/*` | public | Auth.js | n/a | n/a |
| `POST /api/v1/ingest/web-form` | the fortu.co.id backend | HMAC signature + timestamp window; 60/min per IP, 300/min in all | n/a | n/a (goes through `ingestLead`) |
| `GET/HEAD /go/wa` | public | none (a link); 20/min per IP, 600/min in all; no personal data in the log | n/a | n/a |
| `GET /pengaturan/ekspor/[what]` | admin, ceo | session, then role read from `users` | yes | n/a (read) |

Not built, so nothing to check: deleting a deal (rule 3 says `ceo`/`admin` only). When it is added it needs `assertRole` and the same role `EXISTS` in the `DELETE`.

### Gaps found and fixed on this branch (each with a test that failed first, `tests/auth/actionAudit.test.ts`)

1. **Owner hand-over used the cookie role.** `saveDeal` decided "may hand the deal to someone else" from the session role. A person demoted
   to `sales_rep` could keep handing over their deals for up to 5 minutes. It now reads the role from the database inside the save.
2. **`fromLeadId` on an edit.** Editing your own deal with another rep's prospect id attached that prospect's contact to your deal, without
   `can_edit_lead`. Only a new deal made from a prospect takes its contact now (and `convertLead` checks the permission there).

### Left as is, on purpose

- **Reads and lookups use the cookie identity** (up to 5 minutes after a person is deactivated or demoted). Every write re-checks the database, so this only affects what can be read, and everyone may read everything anyway.
- **Creating a deal for a phone number that already exists** fills the existing contact's empty name or company. It never overwrites a value and never changes the owner.
- **Settings writes** do not repeat the role in the SQL, because the tables are global and `runSave` reads the role from the database right before the transaction.

### Added in the same task (not permission gaps)

- Rate limit on `HEAD /go/wa` (it queried the database without a limit) and on `/api/v1/ingest/web-form`.
- Password sign-in: 10 wrong passwords per email and 30 per address in 15 minutes, then even the right password is refused until the window passes.

## Pending pull requests (read with `git show`, not edited)

| PR | Entry point | Result |
| --- | --- | --- |
| #18 pricing | `approveDiscountAction` → `approveDiscount` | OK. Role from the cookie first, then the UPDATE repeats `EXISTS (active ceo/admin)` and `can_edit_deal` against the database; the approval is tied to the lines' fingerprint. |
| #18 pricing | `saveDeal` (clears the approval, calls `notifyDiscountApprovals`) | **Gap, same as 1 and 2 above**: the PR's `lib/dealSave.ts` still has the cookie-role `manager` check and `isNew`-less `fromLeadId`. It touches nearby lines, so after this PR merges, rebase #18 and keep both changes. |
| #19 launch | `GET /api/health` | OK by design: public, no secrets (status, db, commit id). Not rate limited on purpose (Railway's healthcheck). Adds itself to `lib/publicPaths.ts`. |
| #20 accurate | `jobs/accurate-sync.ts` | No inbound entry point. Only GET calls to Accurate; `redirect: "error"` keeps the token from leaving. |
| #21 stok | `GET /stok/ekspor` | OK: session, role re-read from the database, admin/ceo/sales_lead only. |
| #21 stok | `/stok` page | Low: gated with `canOpenStock(user)` from the cookie role (read only; at most 5 minutes behind). The CSV is gated from the database. |

Files that more than one open PR changes along with this one: `docs/deploy.md` (#19, #20), `tests/db/migrate.test.ts` (migration list; #18, #21), `lib/dealSave.ts` (#18). Conflicts are small.
