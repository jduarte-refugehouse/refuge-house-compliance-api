# Refuge House Compliance API — Consumer Guide for Pulse

Base URL: `https://compliance-api.refugehouse.org` (production) | `http://localhost:3100` (local dev)

## Authentication

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

## CORS

The API allows requests from:
- `https://pulse.refugehouse.org`
- `https://pulse.staging.refugehouse.org`
- `http://localhost:5173` (dev only)
- `http://localhost:3000` (dev only)
