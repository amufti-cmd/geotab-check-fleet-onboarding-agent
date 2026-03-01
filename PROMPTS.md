# PROMPTS.md — AI Prompts Used to Build Check-Fleet Onboarding Agent

**AI Tool:** Claude (Anthropic) — claude.ai  
**Model:** Claude Sonnet (claude.ai web interface)  
**Challenge:** Geotab Vibe Coding Challenge 2026  
**Builder:** Amin Mufti, GPS Dashboard, Inc.

---

## Overview

This project was built entirely through conversational prompting with Claude. No prior Node.js or Express experience was used. All server logic, API integrations, dashboard UI, debugging, and architecture decisions were developed through natural language prompts over multiple sessions spanning approximately 2 weeks.

The builder's role was: problem definition, API knowledge (Geotab MyAdmin, Salesforce), testing, and product decisions. Claude's role was: all code generation, debugging, architecture, and UI design.

---

## Session 1 — Architecture & Planning

**Prompt:**
> "I want to build an AI onboarding agent for my Geotab reseller business. When a Salesforce Opportunity closes, I need it to automatically: create a customer in MyAdmin, place a device order, provision a MyGeotab database, activate an LMA license, and create a COA order. I'm not a developer. What's the best approach?"

**What this produced:** Technology selection (Node.js/Express), API discovery plan, workflow step definition, recommendation to use Salesforce REST API + MyAdmin API.

---

## Session 2 — Salesforce Custom Object Design

**Prompt:**
> "I need to create a Salesforce custom object to track the onboarding workflow. What fields do I need based on the 7 steps we defined? Give me the field names, types, and labels so I can create them in Salesforce Setup."

**What this produced:** Complete field specification for `Onboarding_Workflow__c` with 15 fields — API names, data types, and descriptions.

---

## Session 3 — MyAdmin API Research

**Prompt:**
> "I need to understand the Geotab MyAdmin API. Specifically: how to authenticate, how to create a customer (AddEditCustomerAsync), how to look up device plans and shipping options, and how to place a device order. Can you research this and build me the Node.js functions?"

**What this produced:** MyAdmin authentication function, `myAdminCall()` helper, `step2_createMyAdminCustomer()`, `step3_prepareOrder()`, and `step3b_submitOrder()` with full idempotency check.

---

## Session 4 — MyGeotab Database Provisioning

**Prompt:**
> "The MyGeotab CreateDatabase API call is working but sometimes the database already exists from a previous test run. I need the code to handle this gracefully — detect the existing database, authenticate into it to get the server URL, and continue without failing."

**What this produced:** `resolveExistingDatabase()` function with fallback authentication, integrated into `step4_createDatabase()`.

---

## Session 5 — Full Server Build

**Prompt:**
> "Now build the complete server.js with all 8 steps, Express API endpoints for the dashboard to call (/api/start, /api/state, /api/confirm, /api/reset), in-memory workflow state, and a 2-second polling model so the dashboard can show live progress."

**What this produced:** Complete 800+ line `server.js` with full workflow orchestration, state management, human review pause/resume pattern, and all REST endpoints.

---

## Session 6 — Dashboard UI (Initial)

**Prompt:**
> "Build me a real-time dashboard HTML file that connects to the server. It needs: a pipeline showing the 7 stages as chevrons, a live log panel showing agent activity, a detail panel showing the current step, and a Salesforce-style record panel. It should poll /api/state every 2 seconds."

**What this produced:** `onboarding-dashboard-v2.html` — first version with live polling, log streaming, SF field grid.


---

## Session 6b — UI Design Concept via Lovable

**Tool:** Lovable (lovable.dev)

**Prompt used in Lovable:**
> "Design a real-time onboarding agent dashboard with a chevron pipeline showing 7 stages, a live activity log panel, an active stage detail card with chips, and a results checklist panel. Use IBM Plex Sans, Geotab blue (#0078D3), clean card layouts, and professional spacing."

**What this produced:** A React-based UI export with compiled JS/CSS bundles — used as a visual design reference only. The color palette, typography choices (IBM Plex Sans + IBM Plex Mono), chevron shape, card structure, and spacing system were extracted from this design.

**How it was used:** The Lovable export was shared with Claude, which then reconstructed the entire design as a self-contained vanilla HTML/CSS/JS file — no React, no build tools, fully integrated with the live server API.

> **Note:** The Lovable-generated code itself was not used in the final submission. Only the visual design language was adopted.

---

## Session 7 — Dashboard Redesign

**Prompt:**
> "The dashboard looks too basic. I want to redesign it with: IBM Plex Sans font, colored chevron pipeline with active/done/pending states, a card-based active panel with detail chips, colored log dots (info/success/warning/data), and much better spacing. Make it look professional."

**What this produced:** `onboarding-dashboard-v3.html` — complete redesign with professional typography, animated pipeline, color-coded logging.

---

## Session 8 — Step-Through Workflow

**Prompt:**
> "The steps are completing too fast in the demo — the viewer can't see them. After each step completes, I want the workflow to pause and show a summary of what was just accomplished. The rep clicks 'Next Step' to advance. Add this to both server.js and the dashboard."

**What this produced:** `pauseForNext()` helper in server.js, `awaiting_next` status, next-step summary panels in dashboard with animated green completion state.

---

## Session 9 — Shipment Monitoring Fix

**Prompt:**
> "The app stalls at the Shipment Monitor stage and never advances. Looking at the logs, it sets status to polling_shipment but never actually calls the polling function. Also, the GetOrderAsync call probably won't work in sandbox — can we replace it with a manual 'Simulate Delivery' button for the demo?"

**What this produced:** Fixed `pollShipment()` call, replaced `GetOrderAsync` with a `_deliveryConfirmed` flag pattern, added `/api/confirm-delivery` endpoint, added "Simulate Delivery" button in dashboard.

---

## Session 10 — Idempotency & Record Cleanup

**Prompt:**
> "I have 21 Onboarding Workflow records in Salesforce from all my test runs. The agent creates a new record every time I click Start. Fix it so it checks for an existing record first — and if found, reuses it and restores the saved field values into memory."

**What this produced:** Idempotency check in `step1_readOpportunity()` using SOQL query on `Opportunity__c`, field restoration from existing Salesforce record.

---

## Session 11 — LMA License Fix & Simplification

**Prompt:**
> "Step 6 (LMA license activation) is failing because the sandbox LMA records are publisher-controlled and can't be edited. For the demo, can you simplify step 6 to just update the Onboarding Workflow record and skip the actual LMA API call? Also remove steps 7 and 8 (COA) entirely from both the server and dashboard."

**What this produced:** Simplified `step6_activateLMA()` with Salesforce-only update, complete removal of COA steps from server and all UI references.

---

## Session 12 — Results Panel

**Prompt:**
> "The right panel shows Salesforce field names like 'MyAdmin_Customer_ID__c = 27885' which is developer language. Replace it with a business-friendly results checklist that accumulates one line per completed stage — like '✓ MyAdmin Customer Created — ID: 27885'. Each row should animate in when the stage completes."

**What this produced:** `RESULTS_STAGES` array with business-friendly labels and detail extractors, `renderResults()` function, animated result rows with pending/done states.

---

## Session 13 — UI Polish & Branding

**Prompts (combined):**
> "Center the step tag in the detail panel. Make rows 2 and 3 align with it. Move the action button to be the last centered row instead of a side column."

> "Replace the 'CF' placeholder logo with our GPS Dashboard company logo [image uploaded]."

> "Update all stage labels: MyAdmin / Add Customer, MyAdmin / Order Devices, MyGeotab / Register DB, MyGeotab / Add Devices, AppExchange / License. Update the main title to 'Geotab & Check-Fleet Onboarding Agent'."

**What this produced:** Centered panel layout, embedded base64 company logo, updated all stage and panel text labels throughout the UI.

---

## Key Debugging Prompts

**When the server crashed on startup:**
> "Here's the error from npm start: [paste error]. What's wrong and how do I fix it?"

**When API calls returned unexpected results:**
> "The MyAdmin call is returning this: [paste response]. It looks like the field name is different than expected. Can you update the code to handle this response format?"

**When Salesforce updates failed:**
> "SF update error: [paste error]. This field doesn't exist on the object. What should I do?"

**When the dashboard wasn't reflecting server state:**
> "The dashboard shows 'idle' but the server log shows the workflow is running. The poll function must not be reading the status correctly. Here's the /api/state response: [paste JSON]."

---

## Lessons Learned

1. **Paste actual error output** — Claude fixes bugs much faster with the real error than a description of it
2. **One problem at a time** — Combining multiple issues in one prompt leads to partial fixes
3. **API sandbox limitations are real** — Some things (LMA, real shipment polling) simply can't be tested end-to-end in a sandbox; simulating them is the right call
4. **Idempotency from the start** — Should have built "find before create" logic on day one; retrofitting it took extra sessions
5. **Vibe coding is real** — This entire project — ~800 lines of server code, a production-quality dashboard, 7 live API integrations — was built by a non-developer in ~2 weeks through conversation
