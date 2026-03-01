# Geotab & Check-Fleet Customer Onboarding Agent
### Geotab Vibe Coding Challenge 2026 — GPS Dashboard, Inc.

**Category:** Enterprise Integration — Sync Geotab data with Salesforce to automate business workflows

---

## The Problem

When a Geotab reseller closes a deal, onboarding a new customer requires manual steps across five separate systems — a process that can span multiple days or weeks, with steps completed out of order, IDs copied between systems manually, and no single view of where the customer stands:

| System | Manual Task | Time |
|--------|------------|------|
| Salesforce | Update opportunity, create tracking record | 10 min |
| MyAdmin | Create customer account | 10 min |
| MyAdmin | Place device order | 15 min |
| MyGeotab | Provision customer database | 10 min |
| AppExchange LMA | Activate Check-Fleet license | 10 min |

Total: **~55 minutes of manual work** per customer, spread across multiple logins, copy-pasting IDs, and context switching. Mistakes cause delays. Steps get forgotten. Customers wait.

---

## The Solution

An AI onboarding agent that triggers automatically when a Salesforce Opportunity reaches **Closed Won** and orchestrates all five systems in sequence — with human review checkpoints at critical steps (device orders).

**What the agent does autonomously:**
1. Reads the Salesforce Opportunity and creates an Onboarding Workflow tracking record
2. Creates or finds the customer account in Geotab MyAdmin
3. Prepares device order details (plan, shipping, contact) — pauses for rep confirmation
4. Submits the confirmed device order to MyAdmin
5. Provisions a new MyGeotab database for the customer
6. Polls MyAdmin until ordered devices are provisioned and listed in the account (with serial numbers) — confirming they are ready to be added to the MyGeotab database
7. Polls the Salesforce LMA (License Management App) to detect when the customer has installed Check-Fleet in their Salesforce org, then activates the license — confirming the customer is live

**What the rep sees:** A real-time dashboard showing each stage completing, live agent logs, and an accumulating results panel — without touching a single system manually.

---

## Demo

> 3-minute video walkthrough: [https://share.synthesia.io/9455d0a6-f86b-4350-8712-51771b99ae73]

**Demo environments used:**
- **Salesforce (Reseller/Publisher org):** Sandbox (`gpsdb--winter26.sandbox.my.salesforce.com`) — Opportunity, Onboarding Workflow tracking, and LMA License Management
- **Geotab MyAdmin:** Sandbox (`myadminapitest.geotab.com`) — Customer provisioning and device ordering
- **MyGeotab:** Production federation (`my.geotab.com`) — Database provisioning with `demo_` prefix
- **Salesforce (End Customer org):** Developer org — used to simulate the customer's Salesforce instance where Check-Fleet is installed and the LMA license record is created

> Note: No production environments were used. All API calls, customer records, and device orders were made against sandbox/test environments specifically provided for this purpose.

**Demo customer:** Acme Field Services — Salesforce Opportunity `006VE00000TNE6PYAX`

---

## Architecture

```
Salesforce Opportunity (Closed Won)
        ↓
    [Orchestrator Agent — Node.js / Express]
        ├── Salesforce REST API    → Create Onboarding_Workflow__c record
        ├── Geotab MyAdmin API     → AddEditCustomerAsync, GetOrderPackageItemAsync, AddEditOrderAsync
        ├── MyGeotab API           → CreateDatabase
        ├── MyAdmin Device Poll    → Detect devices provisioned & listed in MyAdmin account (serial numbers available)
        └── Salesforce LMA API    → sfLma__License__c status update
        ↓
    Real-time Dashboard (Vanilla JS / HTML)
        ├── 7-stage chevron pipeline
        ├── Live agent log stream (2-second polling)
        └── Onboarding results panel (accumulating per stage)
```

**Key design decisions:**
- **Idempotency:** Each step checks for existing records before creating new ones (MyAdmin customer lookup, Salesforce workflow record query)
- **Human-in-the-loop:** Device order pauses for rep confirmation before submission — agent shows full order details, rep clicks Confirm
- **Step-through workflow:** Each completed stage pauses with a summary, rep advances manually — ideal for demos and oversight
- **Single-file dashboard:** No build tools, no dependencies — just one HTML file served statically


---

## MCP Integration — What We Tried & Why We Pivoted

One of the original objectives for this project was to build the integrations using **MCP (Model Context Protocol)** servers — the emerging standard for connecting AI agents directly to external systems. We evaluated both available MCP options before making the decision to use REST APIs.

### Geotab MCP Server
- **Status:** Not yet published as of submission date (February 2026)
- **What we did:** Researched the Geotab MCP server, confirmed it is in development, and designed the agent architecture to be MCP-ready
- **Impact:** The orchestration pattern used here — discrete tool-like steps, stateful workflow, human-in-the-loop checkpoints — maps directly to how an MCP-based agent would operate. When the Geotab MCP server is published, the MyAdmin and MyGeotab steps could be replaced with MCP tool calls with minimal architectural change

### Salesforce MCP Server
- **Status:** Available in beta via Claude.ai connectors
- **What we tested:** Successfully connected Claude to the Salesforce MCP server and queried live Salesforce objects — including Opportunity records and custom objects — directly from Claude.ai conversation threads
- **Why we didn't use it:** The Salesforce MCP integration is in beta, with inconsistent behavior and limited support for write operations (create/update records) required by this workflow. For a submission requiring reliable end-to-end demo execution, we made the deliberate decision to use the Salesforce REST API directly
- **Reference:** Testing documented in Claude.ai conversation thread "Non-programmer Salesforce Integration"

### Decision: REST APIs
Both Geotab (MyAdmin API + MyGeotab API) and Salesforce (REST API) integrations were implemented using their respective stable, fully-documented REST APIs. This was not the default choice — it was the deliberate fallback after evaluating the MCP path. The agent architecture remains MCP-ready for when both servers are production-available.

---

## Tech Stack

- **Backend:** Node.js, Express
- **APIs:** Salesforce REST API, Geotab MyAdmin API, MyGeotab API
- **Frontend:** Vanilla HTML/CSS/JS (single file, no framework)
- **AI Tools Used:**
  - **Claude (Anthropic)** — claude.ai — all server logic, API integrations, workflow orchestration, and debugging via natural language prompts
  - **Lovable** (lovable.dev) — used to generate an initial UI design concept; the resulting visual design language (typography, color palette, chevron pipeline, card layout) was then reconstructed by Claude into the final self-contained HTML dashboard

---

## Files

| File | Description |
|------|-------------|
| `server.js` | Orchestration agent — all API calls, workflow state, Express endpoints |
| `onboarding-dashboard-v3.html` | Real-time dashboard UI |
| `package.json` | Node.js dependencies (express, node-fetch) |
| `PROMPTS.md` | AI prompts used to build this project |

---

## Setup

### Prerequisites
- Node.js 18+
- Salesforce org with `Onboarding_Workflow__c` custom object (see field list below)
- Geotab MyAdmin account with API access
- MyGeotab credentials

### Configuration
Edit the top of `server.js` with your credentials:

```js
const MYADMIN_URL     = 'https://myadminapitest.geotab.com/v2/MyAdminApi.ashx';
const SF_URL          = 'https://your-org.salesforce.com';
const OPP_ID          = 'your-opportunity-id';
// ... credentials
```

### Run
```bash
npm install
npm start
# Open http://localhost:3000 in Chrome
```

---

## Salesforce Custom Object: Onboarding_Workflow__c

Required fields (all Text unless noted):

| Field API Name | Type |
|---------------|------|
| `Opportunity__c` | Lookup(Opportunity) |
| `Status__c` | Text |
| `Current_Stage__c` | Text |
| `MyAdmin_Customer_ID__c` | Text |
| `Device_Order_Number__c` | Text |
| `Device_Order_Status__c` | Text |
| `MyGeotab_Database__c` | Text |
| `Devices_Assigned__c` | Number |
| `LMA_License_Status__c` | Text |
| `Subscriber_Org_ID__c` | Text |
| `Workflow_Day__c` | Number |
| `Started_Date__c` | Date |
| `Completed_Date__c` | Date |
| `Last_Agent_Action__c` | Text(255) |

---

## About GPS Dashboard, Inc.

GPS Dashboard is a Salesforce ISV AppExchange Partner and Geotab reseller / Marketplace partner. We build telematics integration solutions that connect Geotab fleet data with Salesforce CRM — including Check-Fleet (native Geotab integration) and TelematicsConnect (multi-TSP platform), available on the Salesforce AppExchange.

**This project was built entirely through vibe coding — no prior Node.js or Express experience required. Claude (Anthropic) wrote all code; Lovable generated the initial UI design concept.**
