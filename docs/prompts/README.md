# Claude Code task prompts

One file per task. For each task:
1. `git checkout main && git pull`
2. In Claude Code: `/clear`, then set the model from the table (`/model opus` + `/effort high`, `/model opusplan`, or `/model sonnet`).
3. Open `docs/prompts/Txx.md`, copy the block, paste. Approve the plan, then let it build.
4. Review the result and `git log --oneline main..HEAD`. When happy: push and open the PR (ask Claude: "push and open the PR").
5. Merge, then move the Linear item. ✓ = this task's PR closes the Linear item.

Order matters: T01 → T12 is the pilot path (Wed 4 – Tue 10 Nov). T13 onwards after the pilot starts.
Waiting on people: T15 needs the MSRP list (Pak Jovian), T18 needs Nabil, T20 needs Accurate credentials
and the DIGI39 / DIGI09 / DIGI28 answers (Head of Engineering).

| Task | Title | Linear | Model | Branch |
| --- | --- | --- | --- | --- |
| T01 | Scaffold and database | MAR-141 | Opus 5.5 · high | `adibwafi/mar-141-t01-scaffold` |
| T02 | Google sign-in and roles | MAR-141 | Opus 5.5 · high | `adibwafi/mar-141-t02-auth` |
| T03 | App shell, copy and formatting | MAR-141 ✓ | opusplan (or Sonnet 5.5 · medium) | `adibwafi/mar-141-t03-shell` |
| T04 | ingestLead() | MAR-144 | Opus 5.5 · high | `adibwafi/mar-144-t04-ingest` |
| T05 | Tambah cepat (phone quick-add) | MAR-144 | Sonnet 5.5 · medium | `adibwafi/mar-144-t05-quick-add` |
| T06 | Prospek | MAR-144 | Sonnet 5.5 · medium | `adibwafi/mar-144-t06-prospek` |
| T07 | Pipeline | MAR-147 | Opus 5.5 · high | `adibwafi/mar-147-t07-pipeline` |
| T08 | Deal panel and Jadikan deal | MAR-147 ✓ | opusplan (Opus plans, Sonnet builds) | `adibwafi/mar-147-t08-deal-panel` |
| T09 | Kontak and Perusahaan | MAR-163 ✓ | Sonnet 5.5 · medium | `adibwafi/mar-163-t09-contacts` |
| T10 | Website form and tracked WhatsApp links | MAR-144 ✓ | Opus 5.5 · high | `adibwafi/mar-144-t10-web-form` |
| T11 | Laporan (basic) and Pengaturan | MAR-151 | opusplan · high for settings permissions | `adibwafi/mar-151-t11-reports-settings` |
| T12 | QA, deploy and pilot prep | MAR-152 | Opus 5.5 · high | `adibwafi/mar-152-t12-launch` |
| T13 | Meta insights sync | MAR-153 | Sonnet 5.5 · high | `adibwafi/mar-153-t13-meta-sync` |
| T14 | Laporan lengkap | MAR-151 | Sonnet 5.5 · medium | `adibwafi/mar-151-t14-full-reports` |
| T15 | Harga dan diskon | MAR-164 ✓ | Opus 5.5 · high | `adibwafi/mar-164-t15-pricing` |
| T16 | Sweeper and reminders | MAR-151 ✓ | Sonnet 5.5 · high | `adibwafi/mar-151-t16-sweeper` |
| T17 | Pilot fixes | MAR-152 ✓ | opusplan | `adibwafi/mar-152-t17-pilot-fixes` |
| T18 | Ad codes rollout | MAR-153 ✓ | Sonnet 5.5 · medium | `adibwafi/mar-153-t18-ad-codes` |
| T19 | WhatsApp Coexistence spike | MAR-158 | Opus 5.5 · high | `adibwafi/mar-158-t19-wa-coexistence` |
| T20 | Accurate read-only sync | MAR-158 | Sonnet 5.5 · high | `adibwafi/mar-158-t20-accurate` |
| T21 | Stok & Permintaan screen | MAR-158 ✓ | Sonnet 5.5 · medium | `adibwafi/mar-158-t21-stock` |
| T22 | Hardening | MAR-162 | Opus 5.5 · high | `adibwafi/mar-162-t22-hardening` |
| T23 | Review pack for Pak Jovian | MAR-162 ✓ | Sonnet 5.5 · medium | `adibwafi/mar-162-t23-review` |

## Why these models
- Opus 5.5 high for security, money and data integrity (auth, ingestion, stage moves, HMAC, discounts, webhook, audit).
- `opusplan` where the plan matters but the build is UI work from a fixed design (Opus plans, Sonnet writes).
- Sonnet 5.5 medium for screens built from `docs/design/*.png` and `messages/id.json`; high for jobs that talk to outside APIs.
- Switch model only at the start of a task: switching mid-task throws away the prompt cache.
- Every prompt ends with a fresh-context review subagent, so a cheaper builder still gets an independent check.
