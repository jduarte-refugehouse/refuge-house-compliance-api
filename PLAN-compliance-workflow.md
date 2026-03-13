# Compliance Workflow & Review Management — Implementation Plan

## Scope

This API will manage the full compliance content lifecycle — not just policies and procedures, but all content that informs compliance and outcomes: operational documents, service plans, CQI models, logic models, treatment frameworks, templates, guides, and regulatory references.

The knowbase repo is the **source of truth** for document content. This system layers workflow management, regulatory mapping, and lifecycle tracking on top of that content — leveraging the repo's version history for auditability, its searchability for AI-assisted reviews, and its structure for AI coders to reference regulations when building functionality.

Pulse remains the presentation and delivery layer (PDF rendering, email, UI).

---

## 1. Database: RadiusCompliance (Dedicated Azure SQL Database)

### Why a separate database?

Compliance workflow data (review schedules, approval chains, audit trails, regulatory mappings) is fundamentally different from client/case operational data in RadiusBifrost. A dedicated database on the **same Azure SQL server** (`refugehouse-bifrost-server`) provides:

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
Registry of all managed content with review schedule configuration and lifecycle state.

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
| status | NVARCHAR(30) | `current`, `under-review`, `revision-pending`, `expired`, `draft`, `sunset`, `deprecated`, `archived` |
| effective_date | DATE | When the current version became effective |
| content_hash | NVARCHAR(64) | SHA256 hash — tracks if content changed in knowbase |
| version | INT DEFAULT 1 | Increments when content changes are approved through review |
| superseded_by | INT FK → compliance_documents (nullable) | If deprecated/sunset, points to the replacement document |
| sunset_reason | NVARCHAR(500) | Why the document was retired (regulation repealed, consolidated, service discontinued, etc.) |
| sunset_date | DATE | When the document was formally retired |
| created_at | DATETIME2 DEFAULT GETDATE() | |
| updated_at | DATETIME2 | |

### Table: `regulatory_sources`
Registry of regulating entities and the specific regulations they enforce. This is what makes the system queryable: "which regulations govern medication management?" or "DFPS updated Standard 748.2253 — what's affected?"

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| authority | NVARCHAR(100) | Regulating entity: `DFPS`, `HHSC`, `TJJD`, `CMS`, `Joint Commission`, etc. |
| reference_code | NVARCHAR(100) | Specific citation: `26 TAC §748.2253`, `DFPS Min Std 748.535`, `42 CFR §441.301`, etc. |
| title | NVARCHAR(300) | Human-readable title of the regulation/standard |
| description | NVARCHAR(MAX) | Summary of what the regulation requires |
| source_url | NVARCHAR(500) | Link to the official regulation text |
| effective_date | DATE | When the regulation took/takes effect |
| last_updated | DATE | When the authority last modified this regulation |
| status | NVARCHAR(30) | `active`, `amended`, `repealed`, `proposed` |
| knowbase_path | NVARCHAR(500) | Path to the regulation text in the knowbase repo (if stored there) |
| created_at | DATETIME2 DEFAULT GETDATE() | |
| updated_at | DATETIME2 | |

### Table: `document_regulatory_mappings`
Links documents to the specific regulations they implement. Many-to-many — a policy may implement multiple regulations, and a regulation may be implemented by multiple documents.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| document_id | INT FK → compliance_documents | |
| regulatory_source_id | INT FK → regulatory_sources | |
| mapping_type | NVARCHAR(30) | `implements`, `supports`, `references`, `required-by` |
| notes | NVARCHAR(500) | How this document relates to the regulation |
| created_at | DATETIME2 DEFAULT GETDATE() | |

### Table: `document_dependencies`
Captures relationships between documents. A procedure implements a policy. A CQI model measures outcomes from a logic model. When a parent changes, dependents get flagged for review.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| parent_document_id | INT FK → compliance_documents | The document being depended on |
| dependent_document_id | INT FK → compliance_documents | The document that depends on the parent |
| dependency_type | NVARCHAR(30) | `implements`, `measures`, `supplements`, `references`, `derived-from` |
| notes | NVARCHAR(500) | Description of the relationship |
| created_at | DATETIME2 DEFAULT GETDATE() | |

### Table: `compliance_reviews`
Individual review/approval workflow records. Tied to a specific git commit so the approval is anchored to a known version.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| document_id | INT FK → compliance_documents | |
| review_type | NVARCHAR(30) | `scheduled`, `ad-hoc`, `revision`, `initial`, `regulatory-change`, `content-change-detected`, `relevance-review`, `dependency-cascade` |
| status | NVARCHAR(30) | `pending`, `in-progress`, `approved`, `revision-requested`, `rejected`, `recommend-sunset` |
| requested_by | INT FK | User who initiated the review |
| requested_at | DATETIME2 | |
| assigned_to | INT FK | Primary reviewer |
| due_date | DATE | |
| completed_at | DATETIME2 | |
| completed_by | INT FK | |
| decision_notes | NVARCHAR(MAX) | Reviewer comments |
| revision_summary | NVARCHAR(MAX) | What changed (if revision) |
| knowbase_commit_sha | NVARCHAR(40) | Git commit SHA from knowbase repo — anchors this review to a specific version |
| content_hash_at_review | NVARCHAR(64) | Document hash at time of review — proves what was reviewed |
| triggered_by_regulatory_source_id | INT FK → regulatory_sources (nullable) | If this review was triggered by a regulation change |
| triggered_by_document_id | INT FK → compliance_documents (nullable) | If this review was triggered by a parent document change (cascade) |
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

### Table: `approval_chain_templates`
Default approval chains by category/content type so reviews don't need manual setup every time.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| name | NVARCHAR(100) | Template name (e.g., "Policy Standard Review") |
| category | NVARCHAR(50) | Matches compliance_documents.category — or `all` for default |
| content_type | NVARCHAR(50) | Matches compliance_documents.content_type — or `all` for default |
| chain_definition | NVARCHAR(MAX) | JSON array of approval steps: `[{"order":1,"role":"compliance-officer"},{"order":2,"role":"executive-director"}]` |
| is_default | BIT DEFAULT 0 | If true, used when no more specific template matches |
| created_at | DATETIME2 DEFAULT GETDATE() | |
| updated_at | DATETIME2 | |

### Table: `compliance_review_history`
Immutable audit trail — every state change logged.

| Column | Type | Description |
|--------|------|-------------|
| id | INT IDENTITY PK | |
| document_id | INT FK → compliance_documents | |
| review_id | INT FK → compliance_reviews (nullable) | |
| action | NVARCHAR(50) | `review-initiated`, `assigned`, `approved`, `revision-requested`, `rejected`, `reminder-sent`, `content-changed-detected`, `schedule-changed`, `sunset-initiated`, `sunset-completed`, `regulatory-change-detected`, `dependency-cascade-triggered`, `recommend-sunset` |
| performed_by | INT FK | |
| details | NVARCHAR(MAX) | JSON blob with context |
| knowbase_commit_sha | NVARCHAR(40) | Git commit at time of action (when relevant) |
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
GET    /api/compliance/documents/:id          — Get document details with review history, regulatory mappings, and dependencies
POST   /api/compliance/documents              — Register a document for review tracking
PUT    /api/compliance/documents/:id          — Update document metadata/schedule
DELETE /api/compliance/documents/:id          — Deactivate document tracking
POST   /api/compliance/documents/:id/sunset   — Initiate sunset workflow (with reason and optional superseded_by)
```

### Document Dependencies
```
GET    /api/compliance/documents/:id/dependencies   — Get documents this document depends on and documents that depend on it
POST   /api/compliance/documents/:id/dependencies   — Add a dependency relationship
DELETE /api/compliance/dependencies/:id              — Remove a dependency relationship
```

### Regulatory Sources
```
GET    /api/compliance/regulations                   — List all tracked regulations (filterable by authority, status)
GET    /api/compliance/regulations/:id               — Get regulation details with all mapped documents
POST   /api/compliance/regulations                   — Register a new regulation/standard
PUT    /api/compliance/regulations/:id               — Update regulation (e.g., mark as amended/repealed)
GET    /api/compliance/regulations/:id/documents     — Which documents implement this regulation?
POST   /api/compliance/regulations/:id/change        — Record a regulatory change — triggers reviews on all mapped documents
```

### Regulatory Mappings
```
GET    /api/compliance/documents/:id/regulations     — Which regulations does this document implement?
POST   /api/compliance/documents/:id/regulations     — Map a regulation to a document
DELETE /api/compliance/document-regulations/:id      — Remove a mapping
POST   /api/compliance/regulations/impact-analysis   — AI-assisted: "Here's a new/changed regulation — which documents need updating and what specifically needs to change?"
```

### Review Workflow
```
GET    /api/compliance/reviews                — List reviews (filterable by status, assignee, due date, review_type)
GET    /api/compliance/reviews/:id            — Get review details with approval chain
POST   /api/compliance/reviews                — Initiate a new review (auto-populates approval chain from template)
PUT    /api/compliance/reviews/:id            — Update review (assign, add notes)
POST   /api/compliance/reviews/:id/approve    — Approve at current approval step
POST   /api/compliance/reviews/:id/request-revision — Request revision with comments
POST   /api/compliance/reviews/:id/reject     — Reject review
POST   /api/compliance/reviews/:id/recommend-sunset — Reviewer flags document as potentially obsolete
POST   /api/compliance/reviews/:id/ai-analysis      — Run AI evaluation against mapped regulations, flag gaps/conflicts
```

### Approval Chain Templates
```
GET    /api/compliance/approval-templates              — List all templates
GET    /api/compliance/approval-templates/:id          — Get template details
POST   /api/compliance/approval-templates              — Create a new template
PUT    /api/compliance/approval-templates/:id          — Update a template
DELETE /api/compliance/approval-templates/:id          — Remove a template
```

### Review Timeline & Dashboard
```
GET    /api/compliance/timeline               — Upcoming reviews across all documents (next 30/60/90 days)
GET    /api/compliance/timeline/overdue       — All overdue reviews
GET    /api/compliance/dashboard              — Summary stats: current, under-review, expired, overdue, sunset counts by category
GET    /api/compliance/dashboard/regulatory   — Regulatory coverage: regulations without mapped documents, documents without mapped regulations
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

### Version Tracking
```
GET    /api/compliance/documents/:id/versions — Version history: all approved reviews with commit SHAs, content hashes, and who approved
GET    /api/compliance/documents/:id/diff     — Diff between current knowbase content and the version that was last approved (via GitHub API)
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

## 4. Key Workflows

### 4a. Scheduled Review Cycle
1. Reminder fires N days before `next_review_date` → notification to owner/reviewer
2. Review record created (type: `scheduled`) → approval chain auto-populated from template
3. Reviewer opens document, reviews content against mapped regulations
4. Reviewer approves, requests revision, recommends sunset, or rejects
5. If multi-step: flows through approval chain (e.g., compliance officer → executive director)
6. On final approval: `last_reviewed_date` updated, `next_review_date` recalculated, `version` incremented if content changed, `knowbase_commit_sha` recorded
7. Full audit trail logged

### 4b. Content Change Detection
1. Knowbase sync detects hash mismatch on a tracked document
2. History action `content-changed-detected` logged with old/new hash and commit SHA
3. Review auto-created (type: `content-change-detected`) if content was changed outside the review workflow
4. Assigned to document owner for review/approval of the changes

### 4c. Regulatory Change Cascade
1. Staff or system records a regulatory change via `POST /api/compliance/regulations/:id/change`
2. System queries `document_regulatory_mappings` to find all affected documents
3. Review auto-created for each affected document (type: `regulatory-change`, linked to regulation)
4. Optional: AI impact analysis runs to summarize what specifically may need updating
5. Each review follows normal approval flow

### 4d. Dependency Cascade
1. A parent document is approved with changes (e.g., a policy is updated)
2. System queries `document_dependencies` for all dependents
3. Review auto-created for each dependent (type: `dependency-cascade`, linked to parent)
4. Reviewer assesses whether the dependent document needs updates given the parent change

### 4e. Sunset Workflow
1. Reviewer recommends sunset during any review, OR sunset initiated directly
2. `sunset_reason` and optional `superseded_by` recorded
3. Sunset review goes through approval chain
4. On approval: status → `sunset`, `sunset_date` set
5. Dependent documents flagged for review (cascade)
6. Regulatory mappings reviewed — if a regulation still requires coverage, the superseding document must be mapped

### 4f. AI-Assisted Review
1. During any review, reviewer can trigger AI analysis
2. System pulls the document content + all mapped regulation text from knowbase
3. AI evaluates: compliance gaps, outdated references, conflicts with other documents, missing regulatory coverage
4. Results returned as structured findings with severity levels
5. Reviewer uses findings to inform their approval/revision decision

### 4g. AI Coder Regulation Lookup
1. AI coders building functionality query `/api/compliance/regulations` or `/api/compliance/documents/:id/regulations`
2. Get back the specific regulations that apply to the feature area
3. Can also query `/api/chat` with regulation-aware context
4. Knowbase repo structure means coders can also directly read regulation source files

---

## 5. Implementation Steps

### Phase 1: Database & Connection
1. Create `RadiusCompliance` database on `refugehouse-bifrost-server` in Azure portal
2. Add `mssql` package to this API
3. Create database migration scripts for all 10 tables
4. Add RadiusCompliance connection config to `.env` / Azure App Settings (separate from RadiusBifrost)
5. Build a shared `db.js` service for connection pooling
6. Build migration runner (versioned, repeatable, idempotent)

### Phase 2: Core Registry & Regulatory Foundation
7. Build `compliance-documents` service and routes (including sunset lifecycle)
8. Build `regulatory-sources` service and routes
9. Build `document-regulatory-mappings` service and routes
10. Build `document-dependencies` service and routes
11. Build `compliance-history` service (audit logging — called internally by other services)

### Phase 3: Review Lifecycle & Approval Chains
12. Build `approval-chain-templates` service and routes
13. Build `compliance-reviews` service and routes (including approval chain auto-population)
14. Build review approval/rejection/sunset-recommendation flow
15. Wire up dependency cascade logic (parent change → dependent reviews)
16. Wire up regulatory change cascade logic (regulation change → mapped document reviews)

### Phase 4: Timeline, Dashboard & Reminders
17. Build timeline and dashboard endpoints (including regulatory coverage dashboard)
18. Build reminder configuration endpoints
19. Build reminder check logic (stateless — can be triggered by Azure Function timer or cron)

### Phase 5: Version Tracking & AI Integration
20. Build version tracking endpoints (commit SHA history, diff via GitHub API)
21. Build AI-assisted review endpoint (document + regulations → structured findings)
22. Build regulatory impact analysis endpoint (regulation change → affected documents + suggested changes)

### Phase 6: Knowbase Integration
23. Auto-sync: when knowbase documents refresh, detect new/changed/removed docs and update registry
24. Content change detection → auto-create reviews when hashes change
25. Auto-register new documents appearing in knowbase
26. Detect removed documents → flag for sunset review

### Phase 7: Pulse Integration
27. Expose webhook/callback for Pulse to trigger emails when reminders fire
28. Expose webhook for regulatory change notifications
29. Document the full API for Pulse integration

---

## 6. Connection to Existing Features

The existing endpoints (`/api/chat`, `/api/evaluate`, `/api/generate`, `/api/documents`) remain unchanged. The new `/api/compliance/*` endpoints layer workflow management on top of the same content.

**Cross-feature connections:**
- The knowbase loader auto-registers new documents into `compliance_documents` when they first appear
- `/api/chat` can be enhanced to include regulatory mapping context (which regulations apply to the topic being asked about)
- `/api/evaluate` results can reference the specific regulations being evaluated against (from `regulatory_sources`)
- AI coders can query regulatory endpoints to understand what rules apply when building features

---

## 7. What Pulse Handles

- Rendering document content (markdown → HTML/PDF)
- Sending review reminder emails (triggered by API callback)
- Sending regulatory change notification emails
- Review/approval UI (forms that call API endpoints)
- Sunset workflow UI (reason selection, superseding document picker)
- Dashboard visualizations (consuming `/api/compliance/dashboard`, `/api/compliance/timeline`, and `/api/compliance/dashboard/regulatory`)
- PDF generation of compliance reports
- Regulatory coverage reports

---

## 8. Table Summary

| # | Table | Purpose |
|---|-------|---------|
| 1 | `compliance_documents` | Document registry with lifecycle state, versioning, and sunset tracking |
| 2 | `regulatory_sources` | Registry of regulations and regulating entities |
| 3 | `document_regulatory_mappings` | Links documents to the regulations they implement |
| 4 | `document_dependencies` | Relationships between documents (implements, measures, supplements) |
| 5 | `compliance_reviews` | Review workflow records with git version anchoring |
| 6 | `compliance_review_approvals` | Multi-step approval chains per review |
| 7 | `approval_chain_templates` | Default approval chains by category/content type |
| 8 | `compliance_review_history` | Immutable audit trail |
| 9 | `compliance_reminders` | Reminder schedule configuration per document |
