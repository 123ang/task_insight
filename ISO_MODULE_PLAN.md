# Task Insight — ISO Document Control Module: Implementation Plan

Goal: make Task Insight sellable to Malaysian SMEs as **"audit-ready document
control"** by adding a document register, approval workflow, acknowledgment
tracking, and a one-click Audit Pack — built natively in this codebase
(Express + MySQL), using `123ang/dms_package` (TS/Postgres) as a design
reference only.

Positioning: *"Google Drive stores your files. Task Insight gets you through
your audit."*

---

## Decisions already made (from review on 2026-06-13)

- **Consolidate into Task Insight.** It has the security foundation (auth
  tests, refresh-token rotation, rate limiting, audit logs), a live deployment
  (taskinsight.my), and the more mature file/versioning core.
- **Approval workflow is a new build**, not a port — verified that neither
  codebase has a generic approval engine. `dms_package`'s QP module
  (submit → review → approve/reject) is the pattern blueprint; its ISO schema
  (`iso_documents`, `iso_document_versions`, `iso_document_sets`) is the data
  model blueprint.
- **QP (academic submissions) stays out** until a college deal exists.
- **`dms_package` is frozen** — reference only, no new work there.

## Open decisions (decide before Phase 1 coding)

1. **Repo ownership:** code lives in `123ang/task_insight`. Consider moving
   to a dedicated org (e.g. `taskinsight-my`) before signing corporate
   clients.
2. **Approver model:** start with per-document approvers (flexible, simple)
   vs. org-level "approver" role. Plan assumes **per-document approver
   chosen at submission time**, restricted to org members; revisit multi-step
   later.
3. **Doc numbering:** auto-suggested (`<TYPE>-<seq>`, e.g. `SOP-012`) but
   editable, unique per organization. Confirm format with first pilot client.

---

## Phase 1 — Document Register + Approval MVP (target: 4–6 weeks part-time)

The smallest thing an ISO consultant can demo.

### 1.1 Database — `backend/migrations/003_document_register.sql`

New tables (all FK to existing `organizations`, `users`, `files`):

- **`controlled_documents`** — the register. One row per controlled document.
  - `id`, `organization_id`, `doc_number` (unique per org), `title`,
    `doc_type` (enum: policy, manual, sop, form, record, other),
    `owner_user_id`, `current_file_id` (FK → `files.id`, the approved
    controlled copy), `status` (enum: `draft`, `in_review`, `approved`,
    `obsolete`), `review_due_at` (nullable — ISO wants periodic review),
    `created_at`, `updated_at`
  - Reuses the existing `files` table + its versioning (`current_version`)
    for storage — do NOT build a parallel file store.
- **`document_revisions`** — one row each time a document is submitted.
  - `id`, `controlled_document_id`, `file_id`, `revision_label` (A, B, C… or
    1.0/2.0), `change_summary` (required — auditors ask "what changed"),
    `submitted_by`, `submitted_at`, `status` (`in_review`, `approved`,
    `rejected`, `superseded`)
- **`document_approvals`** — approval record per revision.
  - `id`, `document_revision_id`, `approver_user_id`, `decision`
    (`pending`, `approved`, `rejected`), `comment`, `decided_at`
- **`document_acknowledgments`** — "read & understood" (Phase 2 UI, create
  table now to avoid a second migration).
  - `id`, `controlled_document_id`, `revision_id`, `user_id`,
    `acknowledged_at`, unique(`revision_id`, `user_id`)

Indexes: (`organization_id`, `status`), (`organization_id`, `doc_number`),
approval lookups by `approver_user_id` + `decision`.

### 1.2 Backend — `backend/routes/documents.js`

Follow the existing patterns in `routes/files.js` (express-validator,
`middleware/auth.js` role checks: `platform_owner` / `organization_admin` /
member, audit logging on every mutation).

- `POST   /api/documents` — create register entry (draft), link/upload file
- `GET    /api/documents` — register list; filters: status, type, owner,
  overdue-review; this list IS the "master document list"
- `GET    /api/documents/:id` — detail incl. revision + approval history
- `POST   /api/documents/:id/revisions` — submit new revision
  (file + change_summary + approver) → status `in_review`, creates
  `document_approvals` row, notifies approver
- `POST   /api/revisions/:id/approve` — approver only → revision `approved`,
  document `approved`, `current_file_id` updated, previous revision
  `superseded`; audit log entry
- `POST   /api/revisions/:id/reject` — approver only, comment required
- `POST   /api/documents/:id/obsolete` — org admin or owner; keeps record,
  hides from active register (ISO obsolete-document control)
- `GET    /api/documents/audit-pack` — Phase 1 ships **CSV master list**
  (doc number, title, type, revision, status, owner, approved by/at,
  review due). PDF pack is Phase 2.

Authorization rules:
- Members see their org's register; only owner/org-admin edit metadata.
- Approver cannot be the submitter (basic segregation of duties — auditors
  check this).

### 1.3 Notifications (minimum viable)

- Reuse the reminders/notification bell infrastructure for in-app
  "Pending your approval" + "Document approved/rejected".
- Email via existing SMTP config (`env.example` already has SMTP_*).
- WhatsApp deep links (`wa.me`) in the email/notification as a stopgap;
  real WhatsApp Business API is Phase 3.

### 1.4 Frontend — 3 additions (follow `components/` patterns)

- **Document Register page** — table view: doc number, title, type, status
  chip, revision, owner, review-due flag. "New controlled document" button.
- **Approvals inbox** — list of revisions pending my approval; approve/reject
  modal with comment + file preview (reuse `FilePreviewModal`).
- **Document detail drawer** — status timeline (draft → in review → approved),
  revision history with change summaries, approval records.
- Sidebar: add "Document Register" + "Approvals" under a "Compliance" group.

### 1.5 Tests

Mirror the existing suites (`tests/authorization.test.js`,
`files.test.js` style):
- approval state machine (cannot approve twice, cannot self-approve,
  reject requires comment, supersede on approve)
- authorization matrix (member / org_admin / platform_owner / other org)
- doc number uniqueness per org
- audit-pack CSV shape

### 1.6 Demo data & demo account (sales-critical, do in the same phase)

- Seed script: demo org **"Syarikat Maju Sdn Bhd"** — Quality Manual,
  6 SOPs, 3 forms, one doc in review, one overdue for review, realistic
  names. Replaces "movie"/"tesg" screenshots.
- Read-only demo login, nightly reset (cron + seed script).
- Retake the `docs/screenshots/` set with this data.

**Phase 1 exit criteria:** the 10-minute demo works end-to-end — upload SOP
revision → approver approves from notification → register shows controlled
copy → export master list CSV.

---

## Phase 2 — The Audit Pack + acknowledgments (2–3 weeks)

This is the differentiator no local competitor has.

- **One-click Audit Pack (PDF + Excel zip):** master document list, per-doc
  revision history with change summaries, approval records, acknowledgment
  matrix, obsolete register. Use `archiver` (already a backend dependency)
  + a PDF lib. Branded cover page.
- **Acknowledgment flow:** "Distribute" button on approved revision → selected
  users get notification → must open + confirm → acknowledgment matrix view
  (who has/hasn't read SOP-012 rev C). Auditors ask for exactly this.
- **Review-due dashboard:** documents overdue for periodic review, surfaced
  on the dashboard + weekly email digest.
- **Expiry tracker extension:** extend existing reminders module with
  pre-loaded Malaysian license/cert types (SSM renewal, CIDB, halal, bomba,
  insurance, tenancy). Wedge feature for non-ISO SMEs.

**Demo script unlocked:** "It's Monday, your audit is Friday" → one click →
hand the auditor the pack.

---

## Phase 3 — Local moat features (sequence by demand)

- **WhatsApp Business API** notifications/approvals (360dialog/Twilio or
  local provider). Biggest conversion feature for Malaysian SMEs.
- **Trilingual UI** (BM / EN / 中文) — i18n pass over frontend; differentiates
  against every global competitor.
- **E-invoice retention vault** — folder type with 7-year retention policy,
  rides the LHDN e-invoice mandate.
- **OCR search** on scanned PDFs (SMEs scan paper).
- Multi-step approval chains, e-signature on approval records.

---

## Go-to-market tasks (parallel, non-engineering)

| When | Task |
|---|---|
| During Phase 1 | Landing page on taskinsight.my (currently bare CRA app — meta still says "Web site created using create-react-app"): ISO positioning, 3 screenshots, pricing, WhatsApp button, demo login |
| During Phase 1 | Fix branding link: Sun Tzu site DMS/ISO page → Task Insight screenshots + live demo link |
| Phase 1 done | 3-minute demo video (upload → approve → audit log) |
| Phase 1 done | Founding-customer offer: first 3 SMEs at ~RM150/mo year one, in exchange for named testimonial + case study |
| Phase 2 done | ISO-consultant outreach (20 consultants on LinkedIn, 15–20% recurring referral); draft messages ready |
| Phase 2 done | Pricing tiers live: Starter ~RM199/mo · ISO ~RM449/mo · Private deployment RM15k pilot (Sun Tzu site) |

---

## Effort summary

| Phase | Scope | Estimate (part-time) |
|---|---|---|
| 1 | Register + approvals + CSV list + demo org | 4–6 weeks |
| 2 | Audit Pack PDF + acknowledgments + expiry pack | 2–3 weeks |
| 3 | WhatsApp API, i18n, e-invoice vault, OCR | per-feature, demand-driven |

Order of build inside Phase 1: migration → routes + tests → register page →
approvals inbox → detail drawer → seed/demo → screenshots.
