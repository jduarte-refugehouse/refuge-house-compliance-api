# Refuge House Compliance API — Setup Guide

Step-by-step instructions to get this running locally and deployed to Azure,
written for the same environment you already use for Pulse.

---

## What This Service Does

This is an Express API that serves as the **AI knowledge layer** for Refuge House. It:

1. **Clones your `refuge-house-knowbase` repo** on startup and loads all policy/procedure/regulatory markdown files into memory
2. **Stays in sync** — pulls for updates every 30 minutes (or on demand). When you update a document in the knowbase, the API picks it up automatically. No code changes needed.
3. Exposes three capabilities:

| Capability | Endpoint | Use Case |
|------------|----------|----------|
| **Chat** | `POST /api/chat` | Staff ask natural language questions: *"How often does a child in the IDD/Autism Package need their CANS redone?"* |
| **Plan Generation** | `POST /api/generate/service-plan` | Feed in a child's data catalog (signals) and get back a compliant initial plan of service with required activities, timelines, and policy citations |
| **Compliance Evaluation** | `POST /api/evaluate/:type` | Structured compliance check of a record against policies — returns findings with severity levels |

All responses are grounded exclusively in your policy documents. Claude only cites what's actually in the knowbase.

---

## How Documents Stay Dynamic

The knowbase repo is the **single source of truth**. The compliance API has zero hardcoded document paths.

- **Add a new policy** → push to knowbase repo → API picks it up on next refresh
- **Edit an existing policy** → push to knowbase repo → API picks it up on next refresh
- **Rename or move a file** → API discovers the new path automatically
- **Add a new directory** → API scans it automatically

There is an optional `document-manifest.json` that you can place in the knowbase repo root to map evaluation types to specific documents for more targeted evaluations. But it's optional — without it, all documents are included in every request. Chat and plan generation always use all documents regardless.

---

## Part 1: Local Development Setup

### Step 1 — Create a separate repo

This scaffold currently lives inside `refugehouse-checkin/compliance-api/`. Move it to its own repo:

```bash
# 1. Create a new directory outside of refugehouse-checkin
cd ~/repos   # or wherever you keep your projects
mkdir refuge-house-compliance-api
cp -r ~/repos/refugehouse-checkin/compliance-api/* refuge-house-compliance-api/
cp ~/repos/refugehouse-checkin/compliance-api/.gitignore refuge-house-compliance-api/
cp ~/repos/refugehouse-checkin/compliance-api/.env.example refuge-house-compliance-api/

# 2. Initialize git
cd refuge-house-compliance-api
git init
git add .
git commit -m "Initial scaffold for compliance API"

# 3. Create a GitHub repo and push
#    Go to https://github.com/new
#    Name: refuge-house-compliance-api
#    Private: Yes
#    Don't initialize with README (you already have files)
#
#    Then:
git remote add origin https://github.com/jduarte-refugehouse/refuge-house-compliance-api.git
git push -u origin main
```

### Step 2 — Set up environment variables

```bash
cd refuge-house-compliance-api

# Copy the example env file
cp .env.example .env
```

Open `.env` and fill in:

```
ANTHROPIC_COMPLIANCE_KEY=<your Claude API key>
```

You can use the same key you use for Pulse (`ANTHROPIC_PULSE_KEY`). If you want separate usage tracking on Anthropic's dashboard, create a second key at https://console.anthropic.com/settings/keys.

Leave `COMPLIANCE_API_KEY` blank for local development (auth will be skipped).

### Step 3 — Install and run

```bash
npm install
npm run dev
```

You should see:
```
[STARTUP] Syncing knowbase repository...
[KNOWBASE] Cloning repository...
[KNOWBASE] Loaded 62 documents into cache
[KNOWBASE]   policy: 35 documents
[KNOWBASE]   regulatory: 12 documents
[KNOWBASE]   treatment-model: 3 documents
[KNOWBASE]   guide: 8 documents
[KNOWBASE]   general: 4 documents
[STARTUP] Knowbase sync complete
[STARTUP] Compliance API running on port 3100
[STARTUP] Anthropic configured: Yes
```

### Step 4 — Test it

**Health check:**
```bash
curl http://localhost:3100/health
```

**Ask a policy question (chat):**
```bash
curl -X POST http://localhost:3100/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How frequently does a child in the IDD/Autism Package need to have their CANS redone?"
  }'
```

**Generate a service plan from child data:**
```bash
curl -X POST http://localhost:3100/api/generate/service-plan \
  -H "Content-Type: application/json" \
  -d '{
    "childData": {
      "name": "Test Child",
      "age": 14,
      "dateOfBirth": "2012-03-15",
      "admissionDate": "2026-02-01",
      "placementType": "Foster Family Home",
      "servicePackage": "Short Term Assessment Services",
      "signals": [
        { "signal": "CANS Score", "value": "42", "date": "2026-02-05" },
        { "signal": "Diagnosis", "value": "PTSD, ADHD", "date": "2026-02-03" },
        { "signal": "Prior Placements", "value": "3", "date": "2026-02-01" },
        { "signal": "Education Status", "value": "Enrolled - 9th Grade", "date": "2026-02-01" }
      ],
      "background": "Removed from home due to neglect. Three prior placements in past year. Diagnosed PTSD and ADHD. Currently stable on medication."
    }
  }'
```

**Multi-turn chat conversation:**
```bash
curl -X POST http://localhost:3100/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What about if they are also in the Mental Health add-on package?",
    "history": [
      { "role": "user", "content": "How frequently does a child in the IDD/Autism Package need to have their CANS redone?" },
      { "role": "assistant", "content": "According to FC-IDD-01 Section 4.3..." }
    ]
  }'
```

**Run a structured compliance evaluation:**
```bash
curl -X POST http://localhost:3100/api/evaluate/child-record \
  -H "Content-Type: application/json" \
  -d '{
    "record": {
      "childName": "Test Child",
      "admissionDate": "2026-01-15",
      "age": 14,
      "placementType": "Foster Family Home",
      "servicesPackage": "T3C Basic",
      "hasISP": true,
      "ispLastUpdated": "2026-01-20",
      "hasInitialAssessment": true,
      "hasMedicalConsent": true,
      "hasPsychologicalEval": false,
      "hasEducationPlan": true,
      "familyContactSchedule": "Weekly phone calls, monthly visits",
      "lastCaseworkerVisit": "2026-02-15"
    },
    "focusAreas": "assessment completeness and service plan timeliness"
  }'
```

---

## Part 2: Deploy to Azure

This mirrors exactly how Pulse is deployed — same patterns, same portal.

### Step 5 — Create an Azure App Service

1. Go to **Azure Portal** → https://portal.azure.com
2. Click **Create a resource** → Search for **Web App** → Click **Create**
3. Fill in:
   - **Subscription**: Same subscription as Pulse
   - **Resource Group**: Same resource group as Pulse (or create a new one like `refugehouse-compliance-rg`)
   - **Name**: `refugehouse-compliance-api` (this becomes `refugehouse-compliance-api.azurewebsites.net`)
   - **Publish**: Code
   - **Runtime stack**: Node 22 LTS
   - **Operating System**: Linux
   - **Region**: Same region as Pulse
   - **Pricing plan**: B1 (Basic) is fine to start — this is a lightweight API

4. Click **Review + Create** → **Create**

### Step 6 — Configure environment variables in Azure

1. Go to your new App Service in the Azure Portal
2. Left sidebar → **Settings** → **Environment variables** (or **Configuration** → **Application settings**)
3. Add these application settings:

| Name | Value |
|------|-------|
| `NODE_ENV` | `production` |
| `ANTHROPIC_COMPLIANCE_KEY` | Your Claude API key |
| `ANTHROPIC_COMPLIANCE_MODEL` | `claude-sonnet-4-5` |
| `COMPLIANCE_API_KEY` | (generate one — see below) |
| `KNOWBASE_REPO_URL` | `https://github.com/jduarte-refugehouse/refuge-house-knowbase.git` |
| `KNOWBASE_REFRESH_MINUTES` | `30` |

**Generate an API key** (run this locally):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output and use it as `COMPLIANCE_API_KEY`. You'll also set this in Pulse so it can authenticate.

4. Click **Save** (Azure will restart the app)

### Step 7 — Set up deployment from GitHub

1. In the App Service, left sidebar → **Deployment Center**
2. **Source**: GitHub
3. Sign in to GitHub if prompted
4. Select:
   - **Organization**: `jduarte-refugehouse`
   - **Repository**: `refuge-house-compliance-api`
   - **Branch**: `main`
5. **Build provider**: App Service Build Service (Oryx) — this runs `npm install` automatically
6. Click **Save**

Now every push to `main` on the compliance API repo will auto-deploy, just like Pulse.

### Step 8 — Verify deployment

```bash
curl https://refugehouse-compliance-api.azurewebsites.net/health
```

You should get back a JSON response showing the service is running and documents are loaded.

---

## Part 3: Connect Pulse to the Compliance API

### Step 9 — Add environment variables to Pulse

In the **Pulse** App Service (your existing one), add these application settings:

| Name | Value |
|------|-------|
| `COMPLIANCE_API_URL` | `https://refugehouse-compliance-api.azurewebsites.net` |
| `COMPLIANCE_API_KEY` | (same key you generated in Step 6) |

### Step 10 — Add the compliance client to Pulse

In your `refugehouse-checkin` project, create a small client service:

**File: `services/compliance-client.js`**
```javascript
// services/compliance-client.js
// Client for calling the Compliance API from Pulse.

const COMPLIANCE_API_URL = process.env.COMPLIANCE_API_URL;
const COMPLIANCE_API_KEY = process.env.COMPLIANCE_API_KEY;

if (!COMPLIANCE_API_URL) {
    console.warn('[COMPLIANCE] COMPLIANCE_API_URL not set. Compliance features unavailable.');
}

const headers = {
    'Content-Type': 'application/json',
    'x-api-key': COMPLIANCE_API_KEY || ''
};

async function callApi(path, body) {
    if (!COMPLIANCE_API_URL) {
        throw new Error('Compliance API not configured (COMPLIANCE_API_URL not set)');
    }
    const response = await fetch(`${COMPLIANCE_API_URL}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Compliance API error (${response.status}): ${errorBody}`);
    }
    return response.json();
}

/** Ask a policy question (chat) */
async function askPolicy(message, history = []) {
    return callApi('/api/chat', { message, history });
}

/** Generate a service plan from child data */
async function generateServicePlan(childData, options = {}) {
    return callApi('/api/generate/service-plan', { childData, ...options });
}

/** Run a structured compliance evaluation */
async function evaluateCompliance(evaluationType, record, options = {}) {
    return callApi(`/api/evaluate/${evaluationType}`, { record, ...options });
}

module.exports = { askPolicy, generateServicePlan, evaluateCompliance };
```

### Step 11 — Use it in Pulse routes

**Chat — case manager asks a policy question:**
```javascript
const { askPolicy } = require('../services/compliance-client');

router.post('/api/compliance/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        const result = await askPolicy(message, history);
        res.json(result);
    } catch (err) {
        console.error('[COMPLIANCE] Chat failed:', err);
        res.status(500).json({ error: err.message });
    }
});
```

**Plan generation — generate ISP from child's data catalog:**
```javascript
const { generateServicePlan } = require('../services/compliance-client');

router.post('/api/child-folio/:guid/generate-plan', async (req, res) => {
    try {
        // Gather child data from your database (signals, demographics, etc.)
        const childData = req.body;
        const result = await generateServicePlan(childData, {
            planType: req.body.planType || 'initial-service-plan'
        });
        res.json(result);
    } catch (err) {
        console.error('[COMPLIANCE] Plan generation failed:', err);
        res.status(500).json({ error: err.message });
    }
});
```

**Compliance check — structured evaluation:**
```javascript
const { evaluateCompliance } = require('../services/compliance-client');

router.post('/api/child-folio/:guid/compliance-check', async (req, res) => {
    try {
        const result = await evaluateCompliance('child-record', req.body);
        res.json(result);
    } catch (err) {
        console.error('[COMPLIANCE] Evaluation failed:', err);
        res.status(500).json({ error: err.message });
    }
});
```

---

## Part 4: If Your Knowbase Repo Is Private

If you make `refuge-house-knowbase` private (recommended for production), the compliance API needs a way to clone it.

### Option A: GitHub Personal Access Token (simplest)

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**
2. Scopes: `repo` (full control of private repos)
3. Generate and copy the token
4. In Azure, update the `KNOWBASE_REPO_URL` setting:
   ```
   https://<YOUR_TOKEN>@github.com/jduarte-refugehouse/refuge-house-knowbase.git
   ```

### Option B: Deploy Key (more secure)

1. Generate an SSH key on the Azure App Service (via Kudu console)
2. Add the public key as a Deploy Key on the knowbase repo (Settings → Deploy Keys)
3. Update `KNOWBASE_REPO_URL` to use the SSH URL:
   ```
   git@github.com:jduarte-refugehouse/refuge-house-knowbase.git
   ```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│  GitHub: refuge-house-knowbase                  │
│  (policies, procedures, regulations as .md)     │
│  (optional: document-manifest.json)             │
│                                                 │
│  ★ Single source of truth — update docs here,  │
│    the API discovers them automatically.        │
└──────────────────────┬──────────────────────────┘
                       │ git clone / pull (every 30 min)
                       ▼
┌─────────────────────────────────────────────────┐
│  Azure App Service: compliance-api              │
│                                                 │
│  ┌─────────────┐                                │
│  │ knowbase-   │  Discovers ALL .md files       │
│  │ loader      │  dynamically. No hardcoded     │
│  │             │  paths. Categorizes by dir.     │
│  └──────┬──────┘                                │
│         │                                       │
│  ┌──────▼─────────────────────────────────────┐ │
│  │              Services                      │ │
│  │                                            │ │
│  │  chat.js           → Policy Q&A            │ │
│  │  plan-generator.js → Service plan creation │ │
│  │  evaluator.js      → Compliance checks     │ │
│  │  context-builder.js→ Doc selection         │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  Endpoints:                                     │
│    GET  /health                                 │
│    POST /api/chat             ← Staff Q&A      │
│    POST /api/generate/service-plan ← Plans     │
│    POST /api/evaluate/:type   ← Evaluations    │
│    GET  /api/documents        ← Browse docs    │
│    POST /api/documents/refresh← Force sync     │
└──────────────────────┬──────────────────────────┘
                       │ API calls (x-api-key auth)
                       │
┌──────────────────────▼──────────────────────────┐
│  Azure App Service: Pulse (refugehouse-checkin) │
│                                                 │
│  services/compliance-client.js                  │
│  → Chat widget for case managers                │
│  → "Generate Plan" button on child folio        │
│  → Compliance check on record review            │
└─────────────────────────────────────────────────┘
```

---

## Costs

- **Azure App Service B1**: ~$13/month
- **Claude API**: Each chat question or plan generation uses roughly 10K-80K input tokens (all policy docs) + 1K-4K output tokens. At Sonnet pricing (~$3/M input, ~$15/M output):
  - Chat question: ~$0.03-$0.30
  - Plan generation: ~$0.05-$0.35
  - Budget ~$30-75/month for a team of 5-10 active users
- **Total**: ~$43-88/month to start

---

## Keeping the Knowbase Current

The whole point of this architecture is that your knowbase repo evolves freely. Here's what happens when:

| You do this in the knowbase repo | What happens in the compliance API |
|----------------------------------|------------------------------------|
| Edit a policy's content | Picked up automatically on next 30-min refresh |
| Add a new policy document | Discovered automatically — no manifest needed for chat/plans |
| Rename or move a file | Discovered at new path automatically |
| Add a new directory (e.g., `training/`) | Scanned automatically |
| Add/update `document-manifest.json` | Loaded on next refresh — improves targeted evaluations |
| Delete a document | Removed from cache on next refresh |

**You never need to touch the compliance API code when documents change.**

### Optional: document-manifest.json

If you place a `document-manifest.json` in the knowbase repo root, the compliance API uses it to select specific documents for structured evaluations (the `POST /api/evaluate/:type` endpoint). This reduces token usage for evaluations where you know exactly which policies apply.

Chat and plan generation **always use all documents** regardless of the manifest.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `ANTHROPIC_COMPLIANCE_KEY not set` | Set the env var in `.env` (local) or App Service settings (Azure) |
| `Knowbase sync failed` | Check that `KNOWBASE_REPO_URL` is correct and accessible. If private, see Part 4. |
| `0 documents loaded` | The knowbase clone may have failed silently. Run `npm run sync-knowbase` to debug. |
| `Unauthorized - invalid or missing API key` | Pulse needs to send the same `COMPLIANCE_API_KEY` in the `x-api-key` header |
| Chat returns vague answers | Check that documents loaded correctly (`GET /api/documents`). If the knowbase is very large (>150K tokens), answers may be less precise. |
| Plan generation returns `rawResponse` | Claude's response couldn't be parsed as JSON. The plan is still in `rawResponse` — just not structured. |
