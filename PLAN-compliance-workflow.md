# Compliance Workflow & Review Management — Implementation Plan

## Scope

This API will manage the full compliance content lifecycle — not just policies and procedures, but all content that informs compliance and outcomes: operational documents, service plans, CQI models, logic models, treatment frameworks, templates, guides, and regulatory references.

Pulse remains the presentation and delivery layer (PDF rendering, email, UI).

---

## 1. Database: RadiusCompliance (Dedicated Azure SQL Database)

### Why a separate database?

Compliance workflow data (review schedules, approval chains, audit trails) is fundamentally different from client/case operational data in RadiusBifrost. A dedicated database on the **same Azure SQL server** (`refugehouse-bifrost-server`) provides:

- **Clean separation** — compliance lifecycle data doesn't muddy operational tables
- **Independent scaling** — compliance queries won't compete with case management workloads
- **Security boundaries** — this API only needs access to its own database, not client/case data
- **Simpler migrations** — evolve the compliance schema without any risk to RadiusBifrost

**Server:** `refugehouse-bifrost-server` (existing)
**Database:** `RadiusCompliance` (new — created on the same server)
**Connection:** Separate connection string in this API's environment config

If the compliance API ever needs client/case context (e.g., linking a review to a case or user), it gets that through Pulse via API calls — no cross-database queries.

### Schema

### Table: `compliance_documents`
Registry of all managed content with review schedule configuration.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| document_path | NVARCHAR(500) UNIQUE | Path in knowbase repo (e.g., `policies/medication-management.md`) |
| title | NVARCHAR(300) | Document title |
| category | NVARCHAR(50) | policy, regulatory, treatment-model, guide, template, training, operational, cqi, logic-model |
| content_type | NVARCHAR(50) | More specific: policy, procedure, cqi-model, logic-model, service-plan-template, operational-guide, etc. |
| service_packages | NVARCHAR(500) | Comma-separated applicable packages (e.g., `idd-autism,mental-health`) or `all` |
| owner_user_id | INT FK | Person responsible for this document |
| review_frequency_days | INT | Review cycle in days (e.g., 90, 180, 365) |
| next_review_date | DATE | When the next review is due |
| last_reviewed_date | DATE | When it was last reviewed/approved |
| last_reviewed_by | INT FK | User who completed last review |
| status | NVARCHAR(30) | `current`, `under-review`, `revision-pending`, `expired`, `draft` |
| effective_date | DATE | When the current version became effective |
| content_hash | NVARCHAR(64) | SHA256 hash — tracks if content changed in knowbase |
| created_at | DATETIME2 DEFAULT GETDATE() | |
| updated_at | DATETIME2 | |

### Table: `compliance_reviews`
Individual review/approval workflow records.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| document_id | INT FK → compliance_documents | |
| review_type | NVARCHAR(30) | `scheduled`, `ad-hoc`, `revision`, `initial` |
| status | NVARCHAR(30) | `pending`, `in-progress`, `approved`, `revision-requested`, `rejected` |
| requested_by | INT FK | User who initiated the review |
| requested_at | DATETIME2 | |
| assigned_to | INT FK | Primary reviewer |
| due_date | DATE | |
| completed_at | DATETIME2 | |
| completed_by | INT FK | |
| decision_notes | NVARCHAR(MAX) | Reviewer comments |
| revision_summary | NVARCHAR(MAX) | What changed (if revision) |
| created_at | DATETIME2 DEFAULT GETDATE() | |

### Table: `compliance_review_approvals`
Supports multi-step approval chains (e.g., reviewer → supervisor → director).

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| review_id | INT FK → compliance_reviews | |
| approver_user_id | INT FK | |
| approval_order | INT | Sequence in approval chain (1, 2, 3...) |
| status | NVARCHAR(30) | `pending`, `approved`, `revision-requested`, `rejected` |
| comments | NVARCHAR(MAX) | |
| acted_at | DATETIME2 | |

### Table: `compliance_review_history`
Immutable audit trail — every state change logged.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| document_id | INT FK → compliance_documents | |
| review_id | INT FK → compliance_reviews (nullable) | |
| action | NVARCHAR(50) | `review-initiated`, `assigned`, `approved`, `revision-requested`, `rejected`, `reminder-sent`, `content-updated`, `schedule-changed` |
| performed_by | INT FK | |
| details | NVARCHAR(MAX) | JSON blob with context |
| created_at | DATETIME2 DEFAULT GETDATE() | |

### Table: `compliance_reminders`
Configurable reminder schedule per document.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| document_id | INT FK → compliance_documents | |
| reminder_days_before | INT | Days before next_review_date to send reminder (e.g., 30, 14, 7) |
| notify_role | NVARCHAR(50) | `owner`, `reviewer`, `supervisor`, `all` |
| last_sent_at | DATETIME2 | Prevents duplicate sends |
| enabled | BIT DEFAULT 1 | |

---

## 2. API Endpoints

### Document Registry
```
GET    /api/compliance/documents              — List all registered documents (filterable by category, content_type, status, service_packages)
GET    /api/compliance/documents/:id          — Get document details with review history
POST   /api/compliance/documents              — Register a document for review tracking
PUT    /api/compliance/documents/:id          — Update document metadata/schedule
DELETE /api/compliance/documents/:id          — Deactivate document tracking
```

### Review Workflow
```
GET    /api/compliance/reviews                — List reviews (filterable by status, assignee, due date)
GET    /api/compliance/reviews/:id            — Get review details with approval chain
POST   /api/compliance/reviews                — Initiate a new review
PUT    /api/compliance/reviews/:id            — Update review (assign, add notes)
POST   /api/compliance/reviews/:id/approve    — Approve at current approval step
POST   /api/compliance/reviews/:id/request-revision — Request revision with comments
POST   /api/compliance/reviews/:id/reject     — Reject review
```

### Review Timeline & Dashboard
```
GET    /api/compliance/timeline               — Upcoming reviews across all documents (next 30/60/90 days)
GET    /api/compliance/timeline/overdue       — All overdue reviews
GET    /api/compliance/dashboard              — Summary stats: current, under-review, expired, overdue counts by category
```

### Reminders
```
GET    /api/compliance/reminders              — List all reminder configurations
PUT    /api/compliance/reminders/:documentId  — Update reminder settings for a document
POST   /api/compliance/reminders/check        — Trigger reminder check (called by scheduled job or Azure Function timer)
```

### Audit History
```
GET    /api/compliance/history                — Query audit history (filterable by document, user, action, date range)
GET    /api/compliance/history/:documentId    — Full history for a specific document
```

---

## 3. Content Types Supported

The system manages review workflows for ALL content that supports compliance and outcomes:

| Content Type | Category | Typical Review Frequency |
|-------------|----------|------------------------|
| Policy | policy | Annual (365 days) |
| Procedure | policy | Annual (365 days) |
| CQI Model | cqi | Quarterly (90 days) |
| Logic Model | operational | Semi-annual (180 days) |
| Treatment Framework | treatment-model | Annual (365 days) |
| Service Plan Template | template | Annual (365 days) |
| Operational Guide | operational | Semi-annual (180 days) |
| Regulatory Reference | regulatory | As updated by authority |
| Training Material | training | Annual (365 days) |
| Implementation Guide | guide | Semi-annual (180 days) |

Review frequencies are configurable per document — these are defaults.

---

## 4. Implementation Steps

### Phase 1: Database & Connection
1. Create `RadiusCompliance` database on `refugehouse-bifrost-server` in Azure portal
2. Add `mssql` package to this API
3. Create database migration scripts for the 5 tables
4. Add RadiusCompliance connection config to `.env` / Azure App Settings (separate from RadiusBifrost)
5. Build a shared `db.js` service for connection pooling

### Phase 2: Document Registry & Review Lifecycle
5. Build `compliance-documents` service and routes
6. Build `compliance-reviews` service and routes (including approval chain logic)
7. Build `compliance-history` service (audit logging — called internally by other services)

### Phase 3: Timeline, Dashboard & Reminders
8. Build timeline and dashboard endpoints
9. Build reminder configuration endpoints
10. Build reminder check logic (stateless — can be triggered by Azure Function timer or cron)

### Phase 4: Integration
11. Auto-sync: when knowbase documents refresh, detect new/changed/removed docs and update registry
12. Expose webhook or callback for Pulse to trigger emails when reminders fire
13. Document the full API for Pulse integration

---

## 5. Connection to Existing Features

The existing endpoints (`/api/chat`, `/api/evaluate`, `/api/generate`, `/api/documents`) remain unchanged. The new `/api/compliance/*` endpoints layer workflow management on top of the same content. The knowbase loader can optionally auto-register new documents into `compliance_documents` when they first appear.

---

## 6. What Pulse Handles

- Rendering document content (markdown → HTML/PDF)
- Sending review reminder emails (triggered by API callback)
- Review/approval UI (forms that call API endpoints)
- Dashboard visualizations (consuming `/api/compliance/dashboard` and `/api/compliance/timeline`)
- PDF generation of compliance reports
