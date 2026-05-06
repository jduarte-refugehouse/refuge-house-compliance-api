# Refuge House Compliance API — Consumer Guide for Pulse

Base URL: `https://compliance-api.refugehouse.org` (production) | `http://localhost:3100` (local dev)

## Authentication

Most endpoints under `/api/*` require the API key header. **Static pages (`/pages/*`) are public and require no authentication.**

Every request to `/api/*` must include the header:

```
x-api-key: <your COMPLIANCE_API_KEY>
```

In Pulse, set `VITE_COMPLIANCE_API_KEY` and `VITE_COMPLIANCE_API_URL` as environment variables (GitHub Secrets for CI, `.env.local` for dev).

Example Pulse fetch wrapper:

```js
const complianceApi = {
  baseUrl: import.meta.env.VITE_COMPLIANCE_API_URL,
  apiKey: import.meta.env.VITE_COMPLIANCE_API_KEY,

  async get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'x-api-key': this.apiKey }
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  }
};
```

---

## Quick Reference — All Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Service status (no auth required) |
| **GitHub Webhook (no API key — uses HMAC signature)** | | |
| POST | `/webhooks/github` | Auto-sync knowbase on push to main |
| **Public Document Access (no auth)** | | |
| GET | `/public/documents` | List all documents with slugs and public URLs |
| GET | `/public/documents/:slug` | Rendered HTML page (or JSON/markdown via `?format=`) |
| **Static Pages (Public)** | | |
| GET | `/pages` | List all available static HTML pages (no auth) |
| GET | `/pages/:pageName` | Serve a static HTML page (no auth) |
| **Knowledge Assistant** | | |
| POST | `/api/chat` | Natural language policy Q&A |
| POST | `/api/chat/stream` | Streaming policy Q&A (SSE) |
| POST | `/api/generate/service-plan` | Generate service plans from child data |
| POST | `/api/evaluate/:type` | Structured compliance evaluations |
| **Document Browsing** | | |
| GET | `/api/documents` | List all documents (flat, with category metadata) |
| GET | `/api/documents/directory` | **Documents pre-grouped by category or service package** |
| GET | `/api/documents/view?path=...` | View a specific document's full content |
| GET | `/api/documents/index` | Auto-generated index with headings, topics, regulations |
| GET | `/api/documents/evaluation-types` | List available evaluation types |
| POST | `/api/documents/refresh` | Pull latest from GitHub and re-index |
| POST | `/api/documents/reindex` | Force full re-index (ignores cache) |
| **Compliance Registry** | | |
| GET | `/api/compliance/documents` | List registered documents (filterable, paginated) |
| GET | `/api/compliance/documents/:id` | Get single document details |
| POST | `/api/compliance/documents` | Register a new document |
| PUT | `/api/compliance/documents/:id` | Update document metadata |
| POST | `/api/compliance/documents/:id/sunset` | Mark document as retired |
| GET | `/api/compliance/documents/:id/dependencies` | Get related/dependent documents |
| GET | `/api/compliance/documents/:id/regulations` | Get regulatory mappings for a document |
| GET | `/api/compliance/documents/:id/versions` | Version history |
| GET | `/api/compliance/documents/:id/diff` | Diff against last approved version |
| **Regulations** | | |
| GET | `/api/compliance/regulations` | List regulatory sources |
| POST | `/api/compliance/regulations` | Register new regulation |
| GET | `/api/compliance/regulations/:id/documents` | Find documents implementing a regulation |
| POST | `/api/compliance/regulations/:id/change` | Record a regulatory change (triggers reviews) |
| POST | `/api/compliance/regulations/impact-analysis` | AI analysis of a regulatory change |
| **Reviews** | | |
| GET | `/api/compliance/reviews` | List reviews (filterable) |
| POST | `/api/compliance/reviews/:id/approve` | Approve a review |
| POST | `/api/compliance/reviews/:id/request-revision` | Request changes |
| POST | `/api/compliance/reviews/:id/reject` | Reject a review |
| POST | `/api/compliance/reviews/:id/recommend-sunset` | Recommend document retirement |
| POST | `/api/compliance/reviews/:id/ai-analysis` | AI-assisted review analysis |
| **Dashboard & Timeline** | | |
| GET | `/api/compliance/dashboard` | Overall compliance status |
| GET | `/api/compliance/dashboard/regulatory` | Regulatory coverage stats |
| GET | `/api/compliance/timeline` | Upcoming reviews (default 90 days) |
| GET | `/api/compliance/timeline/overdue` | Overdue reviews |
| GET | `/api/compliance/history` | Audit trail |
| **Reminders** | | |
| GET | `/api/compliance/reminders` | Reminder configuration |
| PUT | `/api/compliance/reminders/:documentId` | Configure reminders for a document |
| POST | `/api/compliance/reminders/check` | Trigger reminder check |
| **Webhooks (Pulse Integration)** | | |
| POST | `/api/compliance/webhooks/sync` | Trigger knowbase sync |
| POST | `/api/compliance/webhooks/reminder-check` | Trigger reminder check + notify Pulse |
| GET | `/api/compliance/webhooks/status` | Webhook configuration status |

---

## Endpoint Details

### 1. Document Directory (Recommended for Pulse navigation)

**`GET /api/documents/directory`** — Returns documents pre-grouped into categories, ready to render as a sidebar or tree view.

Query params:
- `group_by` — `category` (default) or `service_package`
- `include_index` — `true` to include summaries, headings, topics, and regulations per document

**Example: Group by category**
```
GET /api/documents/directory
```
```json
{
  "groupedBy": "category",
  "totalDocuments": 42,
  "groups": 7,
  "directory": {
    "policy": {
      "label": "Policies & Procedures",
      "count": 15,
      "documents": [
        {
          "path": "policies/medication-management.md",
          "title": "Medication Management",
          "category": "policy",
          "lastModified": "2026-03-14T...",
          "sizeBytes": 12340
        }
      ]
    },
    "regulatory": {
      "label": "Regulatory References",
      "count": 8,
      "documents": [...]
    }
  }
}
```

**Example: Group by service package (with index metadata)**
```
GET /api/documents/directory?group_by=service_package&include_index=true
```
```json
{
  "groupedBy": "service_package",
  "totalDocuments": 42,
  "groups": 12,
  "directory": {
    "IDD/Autism": {
      "label": "IDD/Autism",
      "count": 9,
      "documents": [
        {
          "path": "policies/idd-autism-services.md",
          "title": "Idd Autism Services",
          "category": "policy",
          "lastModified": "2026-03-14T...",
          "sizeBytes": 8456,
          "summary": "This policy outlines the specialized care requirements...",
          "headings": ["Overview", "CANS Requirements", "ISP Development"],
          "topics": ["assessment", "medication", "service plan"],
          "regulations": ["26 TAC 748.2253", "DFPS Minimum Standards"],
          "packages": ["IDD/Autism"],
          "tokenEstimate": 2114
        }
      ]
    },
    "General": {
      "label": "General / All Packages",
      "count": 10,
      "documents": [...]
    }
  }
}
```

**Pulse integration pattern:**
```js
// Fetch directory grouped by category for sidebar navigation
const { directory } = await complianceApi.get('/api/documents/directory');

// Render sidebar
Object.entries(directory).forEach(([key, group]) => {
  renderSection(group.label, group.documents);
});

// When user clicks a document, fetch full content
const doc = await complianceApi.get(`/api/documents/view?path=${encodeURIComponent(path)}`);
```

---

### 2. Chat — Policy Q&A

**`POST /api/chat`** — Ask natural language questions about policies and regulations.

```js
const { answer, _meta } = await complianceApi.post('/api/chat', {
  message: "What are the medication management requirements for IDD/Autism?",
  history: []  // optional: previous messages for multi-turn conversation
});
```

**`POST /api/chat/stream`** — Same as above but returns Server-Sent Events for streaming responses.

```js
const response = await fetch(`${baseUrl}/api/chat/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
  body: JSON.stringify({ message: "...", history: [] })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
// Read SSE chunks...
```

---

### 3. Compliance Evaluations

**`POST /api/evaluate/:type`** — Run structured compliance checks against a child's record.

Available types are returned by `GET /api/documents/evaluation-types`. Common types:
- `child-record` — Full record compliance check
- `treatment-plan` — ISP/service plan evaluation
- `schedule` — Weekly schedule compliance
- `cqi` — Continuous quality improvement metrics

```js
const result = await complianceApi.post('/api/evaluate/treatment-plan', {
  record: {
    childName: "Jane Doe",
    admissionDate: "2026-01-15",
    servicePackage: "Short Term Assessment Services",
    isp: { /* ISP data */ }
  },
  packages: ["mental-health"],       // optional: T3C package add-ons
  focusAreas: "medication management" // optional: narrow the evaluation scope
});
```

---

### 4. Service Plan Generation

**`POST /api/generate/service-plan`** — Generate a compliant service plan from a child's data.

```js
const plan = await complianceApi.post('/api/generate/service-plan', {
  childData: {
    name: "Jane Doe",
    age: 14,
    dateOfBirth: "2012-03-15",
    admissionDate: "2026-02-01",
    placementType: "Foster Family Home",
    servicePackage: "Short Term Assessment Services",
    packageAddOns: ["mental-health"],
    signals: [
      { signal: "CANS Score", value: "42", date: "2026-02-05" },
      { signal: "Diagnosis", value: "PTSD, ADHD", date: "2026-02-03" }
    ],
    background: "Brief narrative about the child's history"
  },
  planType: "initial-service-plan",
  focusAreas: "trauma-informed care"
});
```

---

### 5. Compliance Dashboard

**`GET /api/compliance/dashboard`** — Summary stats for the compliance overview page.

```js
const dashboard = await complianceApi.get('/api/compliance/dashboard');
// Returns: document counts by status, upcoming reviews, overdue items, coverage %
```

**`GET /api/compliance/timeline`** — Upcoming document reviews.

```js
// Default: next 90 days
const timeline = await complianceApi.get('/api/compliance/timeline');
// With custom range
const timeline = await complianceApi.get('/api/compliance/timeline?days=30');
```

**`GET /api/compliance/timeline/overdue`** — Documents past their review date.

---

### 6. Compliance Document Registry (CRUD)

**List with filters:**
```js
const docs = await complianceApi.get(
  '/api/compliance/documents?category=policy&status=current&limit=50&offset=0'
);
```

Filter params: `category`, `content_type`, `status`, `service_packages`, `limit`, `offset`

**Get single document:**
```js
const doc = await complianceApi.get('/api/compliance/documents/42');
```

**Register new document:**
```js
await complianceApi.post('/api/compliance/documents', {
  document_path: "policies/new-policy.md",
  title: "New Policy",
  category: "policy",
  content_type: "policy",
  service_packages: "all",
  review_frequency_days: 180,
  user_id: "current-user-id"
});
```

---

### 7. Webhooks — Keeping Pulse in Sync

**Trigger a knowbase sync** (call after knowbase repo updates):
```js
await complianceApi.post('/api/compliance/webhooks/sync');
```

**Trigger reminder check** (call from a scheduled job):
```js
await complianceApi.post('/api/compliance/webhooks/reminder-check');
```

---

## Environment Variables (Pulse Side)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_COMPLIANCE_API_URL` | Base URL of the compliance API | `https://compliance-api.refugehouse.org` |
| `VITE_COMPLIANCE_API_KEY` | API key for authentication | `(from GitHub Secrets)` |

Set these in:
- **Local dev**: `.env.local`
- **CI/CD**: GitHub repository secrets (triggers on next build/deploy)

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Short error description",
  "message": "Detailed error message (when available)",
  "hint": "Suggestion for fixing the issue (when applicable)"
}
```

Common HTTP status codes:
- `400` — Bad request (missing required fields)
- `401` — Unauthorized (missing or invalid API key)
- `404` — Resource not found
- `409` — Conflict (duplicate resource)
- `500` — Internal server error

---

## GitHub Webhook — Automatic Knowbase Sync

**`POST /webhooks/github`** — Receives push events from the `refuge-house-knowbase` GitHub repo and automatically refreshes the document cache.

- **No API key required** — authenticated via GitHub's HMAC-SHA256 signature (`x-hub-signature-256` header)
- Only triggers sync on pushes to `main` (other branches and events are ignored)
- Responds immediately with `202 Accepted`, then syncs in the background
- Also syncs the compliance registry and notifies Pulse of changes

**Environment variable:** `GITHUB_WEBHOOK_SECRET` — must match the secret configured in the GitHub webhook settings.

**GitHub webhook setup:**
1. Go to `refuge-house-knowbase` repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://compliance-api.refugehouse.org/webhooks/github`
3. Content type: `application/json`
4. Secret: (generate a strong secret and set it as `GITHUB_WEBHOOK_SECRET` in App Service config)
5. Events: select "Just the push event"

---

## Public Document Access (No Authentication)

These endpoints live under `/public/` and require **no API key**. They are designed for:
- Sharing documents with foster parents, external stakeholders, or auditors
- Embedding documents in external apps (e.g., foster parent portal)
- Linking directly to the current version of a policy or plan

### How Slugs Work

Every document in the knowbase gets an auto-generated slug from its filename:
- `plans/Emergency Response Disaster Recovery and Business Continuity Plan.md` -> `emergency-response-disaster-recovery-and-business-continuity-plan`
- `policies/medication-management.md` -> `medication-management`

### `GET /public/documents` — List all documents with public URLs

Returns every loaded document with its slug, path, title, and direct URL.

```json
{
  "count": 42,
  "documents": [
    {
      "slug": "emergency-response-disaster-recovery-and-business-continuity-plan",
      "path": "plans/Emergency Response Disaster Recovery and Business Continuity Plan.md",
      "title": "Emergency Response Disaster Recovery and Business Continuity Plan",
      "category": "general",
      "lastModified": "2026-03-25T...",
      "url": "/public/documents/emergency-response-disaster-recovery-and-business-continuity-plan",
      "summary": "This plan outlines..."
    }
  ]
}
```

### `GET /public/documents/:slug` — View a document

Returns a **rendered HTML page** by default (self-contained, branded, print-friendly).

**Formats** (via `?format=` query param):

| Format | Content-Type | Use Case |
|--------|-------------|----------|
| `html` (default) | `text/html` | Direct link, browser viewing, print |
| `json` | `application/json` | App embedding (returns `{ slug, path, title, content }`) |
| `markdown` | `text/markdown` | Raw markdown for client-side rendering |

**Examples:**

```
# Shareable link (opens branded HTML page in browser)
https://compliance-api.refugehouse.org/public/documents/emergency-response-disaster-recovery-and-business-continuity-plan

# JSON for app embedding
GET /public/documents/emergency-response-disaster-recovery-and-business-continuity-plan?format=json

# Raw markdown
GET /public/documents/emergency-response-disaster-recovery-and-business-continuity-plan?format=markdown
```

**Pulse integration patterns:**

```js
// Link to the public HTML version (for foster parent portal, external sharing)
const publicUrl = `${complianceApiBaseUrl}/public/documents/${slug}`;

// Fetch JSON for in-app rendering
const doc = await fetch(
  `${complianceApiBaseUrl}/public/documents/${slug}?format=json`
).then(r => r.json());

// Fetch raw markdown for client-side rendering with custom styles
const markdown = await fetch(
  `${complianceApiBaseUrl}/public/documents/${slug}?format=markdown`
).then(r => r.text());
```

---

## Static HTML Pages (Public — No Auth)

The API can serve standalone HTML pages directly from the knowbase repo. These are **public** — no API key needed — intended for foster parents, staff, and external stakeholders.

### How it works

1. Add an `.html` file to the `static-pages/` folder in the knowbase repo
2. The compliance API picks it up on the next sync (startup or `POST /api/compliance/webhooks/sync`)
3. It's immediately available at `/pages/<filename>` (without the `.html` extension)

### Example

Place `training-videos.html` in the knowbase repo at:
```
refuge-house-knowbase/
  static-pages/
    training-videos.html
    emergency-plan.html
    foster-parent-resources.html
```

These become accessible at:
- `https://compliance-api.refugehouse.org/pages/training-videos`
- `https://compliance-api.refugehouse.org/pages/emergency-plan`
- `https://compliance-api.refugehouse.org/pages/foster-parent-resources`

### Endpoints

**`GET /pages`** — List all available pages:
```json
{
  "count": 3,
  "pages": {
    "training-videos": {
      "url": "/pages/training-videos",
      "lastModified": "2026-03-30T...",
      "sizeBytes": 4523,
      "source": "static-pages/training-videos.html"
    },
    "emergency-plan": { ... },
    "foster-parent-resources": { ... }
  }
}
```

**`GET /pages/:pageName`** — Returns raw HTML (Content-Type: text/html). The `.html` extension is optional.

### Pulse integration

To make these accessible at `pulse.refugehouse.org/pages/<name>`, add a proxy rule or route in Pulse:

**Option A: Azure App Service proxy rule** (recommended for production):
Add to Pulse's Azure configuration to proxy `/pages/*` to the compliance API.

**Option B: Pulse route + iframe**:
```jsx
// In Pulse router
<Route path="/pages/:pageName" element={<StaticPageViewer />} />

// StaticPageViewer.jsx
function StaticPageViewer() {
  const { pageName } = useParams();
  const apiUrl = import.meta.env.VITE_COMPLIANCE_API_URL;
  return <iframe src={`${apiUrl}/pages/${pageName}`} style={{ width: '100%', height: '100vh', border: 'none' }} />;
}
```

**Option C: Direct link** — Share the compliance API URL directly:
`https://compliance-api.refugehouse.org/pages/training-videos`

---

## Content Cookbook (Registry + Resolver)

The cookbook is the **stable contract** for compliance content used by Pulse and other integrations (child / package / add-on flows). It separates three responsibilities cleanly:

- **Render store** — HTML bodies served by slug (`/api/content-cookbook/:slug/html`)
- **Registry** — `cookbook/index.json` in the knowbase repo + per-entry metadata
- **Resolver** — deterministic mapping from `(contentType, packageCode, addOnCode, domain)` to a single entry

The compliance API is the **recipient**: it mirrors the registry from the knowbase repo into memory, validates each entry, and serves the contract endpoints. Drift, missing files, and checksum mismatches surface as warnings on `/api/content-cookbook/_status` rather than silently corrupting reads.

### Required schema fields per entry

Every entry in `cookbook/index.json` must include:

| Field | Description |
|-------|-------------|
| `id` | Stable internal identifier |
| `slug` | URL-safe identifier (used in URLs and resolver) |
| `title` | Human-readable title |
| `summary` | One-line description (optional but recommended) |
| `kind` | High-level category (e.g. `form`, `notice`, `guide`) |
| `contentType` | Specific type (e.g. `package-form`, `add-on-form`, `consent`) |
| `domain` | Domain bucket (e.g. `placement`, `medical`, `training`) |
| `contexts` | Object: `{ packageCode?, addOnCode?, ... }` for resolver matching |
| `status` | One of `active`, `deprecated`, `superseded`, `archived` |
| `path` | File path inside the knowbase repo (e.g. `cookbook/forms/my-form.html`) |

The recipient enriches each entry with `sourceRepo`, `sourceRef`, `sourceUrl`, `mirroredAt`, `syncMode`, and `checksum` automatically.

### Endpoints

**`GET /api/content-cookbook`** — List entries with filters:
- `status` (default `active`; comma-separated, or `all`)
- `kind`, `contentType`, `domain`, `packageCode`, `addOnCode`

```json
{
  "count": 12,
  "filter": { "status": "active", "contentType": "package-form" },
  "meta": { "sourceRepo": "...", "sourceRef": "abc123", "lastSyncAt": "..." },
  "entries": [ { "id": "...", "slug": "...", "title": "...", ... } ]
}
```

**`GET /api/content-cookbook/resolve`** — Deterministic resolver. Inputs: `slug`, `contentType`, `packageCode`, `addOnCode`, `domain`. Response includes `resolutionMode` so the decision is auditable from the response itself.

Precedence (first hit wins, never varies silently):
1. exact slug match (`slug-exact`)
2. `contentType` + `packageCode` + `addOnCode` + `status=active` (`contentType+package+addOn`)
3. `contentType` + `packageCode` + `status=active` (`contentType+package`)
4. `contentType` + `domain` + `status=active` (`contentType+domain`)
5. fallback default entry (`isDefault: true` in metadata) → `default`

```json
{
  "resolutionMode": "contentType+package",
  "context": { "contentType": "package-form", "packageCode": "FFCC" },
  "entry": { "slug": "ffcc-intake-form", "title": "...", "checksum": "...", ... }
}
```

**`GET /api/content-cookbook/:slug`** — Single entry metadata.
- Archived entries: `404` by default; pass `?status=archived` (or `?includeArchived=true`) to retrieve.

**`GET /api/content-cookbook/:slug/html`** — Mirrored HTML body.
- Archived entries remain reachable here for compliance continuity.
- Response headers: `X-Content-Slug`, `X-Content-Status`, `X-Content-Checksum`, `X-Source-Ref`.

**`GET /api/content-cookbook/_status`** — Drift / integrity diagnostics: last sync time, source ref, validation report (invalid entries + warnings).

### Caching

Reads are served from an in-memory registry that is refreshed when stale. Default TTL is 60 seconds (`COOKBOOK_CACHE_TTL_MS`). The cache is also rebuilt on startup and can be busted by re-running sync (e.g. via `POST /api/compliance/webhooks/sync`).

### Sync workflow (sender → recipient)

1. Sender (knowbase) updates HTML and registry entry
2. Recipient mirrors HTML + metadata into memory
3. Recipient stamps `mirroredAt` and computes/verifies `checksum`
4. Recipient validates required coupling fields (`contentType`, `domain`, `contexts`)
5. Recipient deploys / serves new content

If validation fails on an entry, that entry is dropped from the registry and surfaced in `_status.invalid`; the rest of the registry continues to serve. Drift (missing file, checksum mismatch) is reported as a warning rather than dropping the entry.

---

## CORS

The API allows requests from:
- `https://pulse.refugehouse.org`
- `https://pulse.staging.refugehouse.org`
- `http://localhost:5173` (dev only)
- `http://localhost:3000` (dev only)
