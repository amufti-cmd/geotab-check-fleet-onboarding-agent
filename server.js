require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── STATE ────────────────────────────────────────────────────────────────────
let workflowState = {
  status: 'idle',           // idle | running | awaiting_next | awaiting_review | complete | error
  currentStage: null,
  opportunityId: null,
  opportunity: null,
  onboardingRecordId: null,
  myAdminSessionId: null,
  sfAccessToken: null,
  sfInstanceUrl: null,
  log: [],
  fields: {
    myAdminCustomerId: null,
    deviceOrderNumber: null,
    deviceOrderStatus: null,
    myGeotabDatabase: null,
    devicesAssigned: null,
    lmaLicenseStatus: null,
    workflowDay: 1,
  }
};

// ─── LOGGING ──────────────────────────────────────────────────────────────────
function log(type, msg) {
  const entry = {
    type,   // info | success | warning | data | error
    time: `Day ${workflowState.fields.workflowDay}`,
    msg,
    ts: new Date().toISOString()
  };
  workflowState.log.push(entry);
  console.log(`[${entry.type.toUpperCase()}] ${msg}`);
  return entry;
}


// ─── PAUSE FOR NEXT ───────────────────────────────────────────────────────────
// Pauses workflow after each step so the dashboard can show the completed stage.
// Resumes when /api/next is called.
function pauseForNext(stepName, nextFn) {
  return new Promise((resolve) => {
    workflowState.status  = 'awaiting_next';
    workflowState.nextStep = stepName;
    workflowState._nextResolve = () => {
      workflowState.status   = 'running';
      workflowState.nextStep = null;
      workflowState._nextResolve = null;
      resolve();
    };
  });
}

// ─── MYAMIN API ───────────────────────────────────────────────────────────────
async function myAdminCall(method, params) {
  const body = {
    id: -1,
    method,
    params: {
      ...params,
      apiKey: workflowState.myAdminUserId || undefined,
      sessionId: workflowState.myAdminSessionId || undefined,
    }
  };

  const res = await fetch(process.env.MYADMIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (json.error) throw new Error(`MyAdmin ${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function myAdminAuthenticate() {
  log('info', 'Authenticating with MyAdmin API...');
  const body = {
    id: -1,
    method: 'Authenticate',
    params: {
      username: process.env.MYADMIN_USERNAME,
      password: process.env.MYADMIN_PASSWORD,
    }
  };

  const res = await fetch(process.env.MYADMIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (json.error) throw new Error(`MyAdmin Authenticate error: ${JSON.stringify(json.error)}`);

  const result = json.result;
  workflowState.myAdminUserId = result.userId;
  workflowState.myAdminSessionId = result.sessionId;
  log('success', `MyAdmin authentication successful. UserId: ${result.userId}`);
}

// ─── SALESFORCE API ───────────────────────────────────────────────────────────
async function sfAuthenticate() {
  log('info', 'Authenticating with Salesforce...');
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });

  const res = await fetch(`${process.env.SF_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const json = await res.json();
  if (!json.access_token) throw new Error(`SF auth failed: ${JSON.stringify(json)}`);

  workflowState.sfAccessToken = json.access_token;
  workflowState.sfInstanceUrl = json.instance_url || process.env.SF_URL;
  log('success', 'Salesforce authentication successful.');
  return json.access_token;
}

async function sfQuery(soql) {
  const url = `${workflowState.sfInstanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${workflowState.sfAccessToken}` }
  });
  const json = await res.json();
  if (json.errorCode) throw new Error(`SF query error: ${json.message}`);
  return json;
}

async function sfUpdate(objectType, recordId, data) {
  const url = `${workflowState.sfInstanceUrl}/services/data/v59.0/sobjects/${objectType}/${recordId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${workflowState.sfAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`SF update error: ${JSON.stringify(err)}`);
  }
  return true;
}

async function sfCreate(objectType, data) {
  const url = `${workflowState.sfInstanceUrl}/services/data/v59.0/sobjects/${objectType}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workflowState.sfAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!json.id) throw new Error(`SF create error: ${JSON.stringify(json)}`);
  return json.id;
}

// ─── WORKFLOW STEPS ───────────────────────────────────────────────────────────

// STEP 1: Read Opportunity from Salesforce
async function step1_readOpportunity() {
  workflowState.currentStage = 'trigger';
  log('info', `Reading Opportunity ${workflowState.opportunityId} from Salesforce...`);

  const result = await sfQuery(
    `SELECT Id, Name, AccountId, Account.Name, Account.BillingStreet, 
     Account.BillingCity, Account.BillingState, Account.BillingPostalCode,
     Account.BillingCountry, Amount, CloseDate, 
     Onboarding_Status__c
     FROM Opportunity 
     WHERE Id = '${workflowState.opportunityId}'`
  );

  if (!result.records || result.records.length === 0) {
    throw new Error(`Opportunity ${workflowState.opportunityId} not found.`);
  }

  workflowState.opportunity = result.records[0];
  const opp = workflowState.opportunity;

  log('data', `Opportunity: ${opp.Name} · Amount: $${opp.Amount?.toLocaleString() || 'N/A'}`);
  log('info', `Account: ${opp.Account?.Name} · ${opp.Account?.BillingCity}, ${opp.Account?.BillingState}`);
  log('info', 'Checking for existing Onboarding Workflow record...');

  // Idempotency check — reuse existing record if one exists for this Opportunity
  const existing = await sfQuery(
    `SELECT Id, Name, Status__c, MyAdmin_Customer_ID__c, Device_Order_Number__c,
     MyGeotab_Database__c, Devices_Assigned__c, LMA_License_Status__c,
     Workflow_Day__c
     FROM Onboarding_Workflow__c
     WHERE Opportunity__c = '${workflowState.opportunityId}'
     ORDER BY CreatedDate DESC LIMIT 1`
  );

  if (existing.records && existing.records.length > 0) {
    const rec = existing.records[0];
    workflowState.onboardingRecordId = rec.Id;

    // Restore any fields already written in previous runs
    if (rec.MyAdmin_Customer_ID__c)  workflowState.fields.myAdminCustomerId = rec.MyAdmin_Customer_ID__c;
    if (rec.Device_Order_Number__c)  workflowState.fields.deviceOrderNumber  = rec.Device_Order_Number__c;
    if (rec.MyGeotab_Database__c)    workflowState.fields.myGeotabDatabase   = rec.MyGeotab_Database__c;
    if (rec.Devices_Assigned__c)     workflowState.fields.devicesAssigned    = rec.Devices_Assigned__c;
    if (rec.LMA_License_Status__c)   workflowState.fields.lmaLicenseStatus   = rec.LMA_License_Status__c;
    if (rec.Workflow_Day__c)         workflowState.fields.workflowDay        = rec.Workflow_Day__c;

    log('warning', `Existing Onboarding Workflow found: ${rec.Id}. Reusing record.`);

    await sfUpdate('Onboarding_Workflow__c', rec.Id, {
      Status__c: 'In Progress',
      Current_Stage__c: 'SF Trigger',
      Last_Agent_Action__c: 'Workflow restarted — reusing existing record.',
    });
  } else {
    // No existing record — create a fresh one
    log('info', 'No existing record found. Creating Salesforce tracking record...');

    const onboardingRecordId = await sfCreate('Onboarding_Workflow__c', {
      Name: `${opp.Account?.Name} Onboarding`,
      Opportunity__c: workflowState.opportunityId,
      Status__c: 'In Progress',
      Current_Stage__c: 'SF Trigger',
      Workflow_Day__c: 1,
      Started_Date__c: new Date().toISOString().split('T')[0],
    });

    workflowState.onboardingRecordId = onboardingRecordId;
    log('success', `Onboarding Workflow record created: ${onboardingRecordId}`);
  }

  // Update Opportunity status
  await sfUpdate('Opportunity', workflowState.opportunityId, {
    Onboarding_Status__c: 'In Progress',
    Onboarding_Record__c: workflowState.onboardingRecordId,
  });
  log('success', `Salesforce Opportunity updated. Workflow ID: ${workflowState.onboardingRecordId}`);
}

// STEP 2: Create Customer in MyAdmin
async function step2_createMyAdminCustomer() {
  workflowState.currentStage = 'customer';
  const opp = workflowState.opportunity;
  const account = opp.Account;

  log('info', `Creating customer in MyAdmin for: ${account.Name}`);

  // First check if customer already exists
  log('info', 'Checking if customer already exists in MyAdmin...');
  const existing = await myAdminCall('GetCustomersAsync', {
    accounts: [process.env.MYADMIN_ACCOUNT],
    companyName: account.Name,
  });

  let customerId = null;

  if (existing && Array.isArray(existing) && existing.length > 0) {
    customerId = existing[0].id;
    log('info', `Customer already exists. Using existing ID: ${customerId}`);
  } else {
    log('info', `Calling MyAdmin AddEditCustomerAsync...`);
    const result = await myAdminCall('AddEditCustomerAsync', {
      forAccount: process.env.MYADMIN_ACCOUNT,
      customer: {
        companyName: account.Name,
        legalName: account.Name,
        address: account.BillingStreet || '400 Industrial Blvd',
        city: account.BillingCity || 'Austin',
        state: account.BillingState || 'Texas',
        country: account.BillingCountry || 'United States',
        zip: account.BillingPostalCode || '78701',
        account: process.env.MYADMIN_ACCOUNT,
        active: true,
      }
    });
    customerId = result?.id;
    if (!customerId) throw new Error(`AddEditCustomerAsync returned unexpected result: ${JSON.stringify(result)}`);
  }
  workflowState.fields.myAdminCustomerId = String(customerId);

  log('success', `MyAdmin customer created. Customer ID: ${customerId}`);

  // Update Salesforce
  await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
    MyAdmin_Customer_ID__c: String(customerId),
    Current_Stage__c: 'MyAdmin Customer',
    Last_Agent_Action__c: `MyAdmin customer created. ID: ${customerId}`,
  });
  log('data', `Salesforce updated: MyAdmin_Customer_ID__c = ${customerId}`);
}

// STEP 3: Prepare Device Order — lookup all details, then pause for human review
async function step3_createDraftOrder() {
  workflowState.currentStage = 'order';

  log('info', 'Preparing device order details...');

  // 3a: Shipping fees
  log('info', 'Looking up shipping fees...');
  const shippingFees = await myAdminCall('GetShippingFees', {
    forAccount: process.env.MYADMIN_ACCOUNT,
  });
  const shippingFee = Array.isArray(shippingFees) ? shippingFees[0] : shippingFees;
  const shippingFeeId = shippingFee?.id || shippingFee?.shippingFeeId;
  log('data', `Shipping: ${shippingFee?.name || shippingFeeId}`);

  // 3b: Device plan
  log('info', 'Looking up device plans...');
  const devicePlans = await myAdminCall('GetDevicePlans', {});
  const devicePlan = Array.isArray(devicePlans) ? devicePlans[0] : devicePlans;
  const devicePlanLevel = devicePlan?.level || devicePlan?.devicePlanLevel || 1;
  log('data', `Device plan: ${devicePlan?.name || devicePlanLevel}`);

  // 3c: Ship-to contact
  log('info', 'Looking up ship-to contact...');
  const userContacts = await myAdminCall('GetUserContacts', {
    forAccount: process.env.MYADMIN_ACCOUNT,
  });
  const shipToContact = Array.isArray(userContacts) ? userContacts[0] : userContacts;
  const shipToId = shipToContact?.id || shipToContact?.contactId;
  log('data', `Ship to: ${shipToContact?.firstName || ''} ${shipToContact?.lastName || ''} (ID: ${shipToId})`);

  // 3d: Product
  const productCode = process.env.MYADMIN_PRODUCT_CODE;
  if (!productCode) throw new Error('MYADMIN_PRODUCT_CODE not set in .env');

  // Save all order details to state for use when rep confirms
  workflowState.pendingOrder = {
    forAccount: process.env.MYADMIN_ACCOUNT,
    customerId: parseInt(workflowState.fields.myAdminCustomerId),
    devicePlanLevel,
    shipToId,
    shippingFeeId,
    shippingFeeName: shippingFee?.name || 'Standard',
    shipToName: `${shipToContact?.firstName || ''} ${shipToContact?.lastName || ''}`.trim(),
    productCode,
    quantity: 5,
    purchaseOrderNo: `PO-${Date.now()}`,
  };

  log('success', 'Order details prepared. Awaiting rep confirmation before submission.');
  log('warning', `Ready to order: Geotab GO9 (T-Mobile LTE) × 5 units · Ship to: ${workflowState.pendingOrder.shipToName} · Shipping: ${workflowState.pendingOrder.shippingFeeName}`);

  await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
    Device_Order_Status__c: 'Draft',
    Current_Stage__c: 'Device Order',
    Last_Agent_Action__c: `Order prepared. Awaiting rep approval before submission.`,
  });

  // Pause for human review
  workflowState.status = 'awaiting_review';
  workflowState.reviewType = 'device_order';
}

// STEP 3b: Actually post the order after rep confirms
async function step3b_submitOrder() {
  const order = workflowState.pendingOrder;
  if (!order) throw new Error('No pending order found. Please restart the workflow.');

  log('info', `Submitting order to MyAdmin: ${order.productCode} × ${order.quantity}...`);

  const result = await myAdminCall('PostOrder', {
    forAccount: order.forAccount,
    apiOrderHeader: {
      forAccount: order.forAccount,
      customerId: order.customerId,
      devicePlanLevel: order.devicePlanLevel,
      shipToId: order.shipToId,
      shippingFeeId: order.shippingFeeId,
      purchaseOrderNo: order.purchaseOrderNo,
      orderItems: [
        {
          productCode: order.productCode,
          quantity: order.quantity,
        }
      ],
    }
  });

  const orderNumber = result?.orderNumber || result?.orderId || result?.id || order.purchaseOrderNo;
  workflowState.fields.deviceOrderNumber = String(orderNumber);
  workflowState.fields.deviceOrderStatus = 'Submitted';
  workflowState.pendingOrder = null;

  log('success', `Device order submitted. Order #: ${orderNumber}`);

  await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
    Device_Order_Number__c: String(orderNumber),
    Device_Order_Status__c: 'Submitted',
    Current_Stage__c: 'Device Order',
    Last_Agent_Action__c: `Device order submitted: ${orderNumber}. Monitoring shipment.`,
  });
  log('data', `Salesforce updated: Device_Order_Number__c = ${orderNumber}`);
}

// STEP 4: Resume after device order submitted — Create MyGeotab Database
async function step4_createDatabase() {
  workflowState.currentStage = 'database';
  workflowState.fields.workflowDay = 2;
  const account = workflowState.opportunity.Account;

  // Build clean database name — demo_ prefix required by Geotab for demo databases
  const dbShortName = account.Name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 50);
  const dbName = `demo_${dbShortName}`;

  log('info', `Provisioning MyGeotab database: ${dbName}`);
  log('info', 'Calling MyGeotab CreateDatabase...');

  let serverAndDb = null;

  const body = {
    id: -1,
    method: 'CreateDatabase',
    params: {
      database: dbName,
      userName: process.env.MYADMIN_USERNAME,
      password: process.env.MYADMIN_PASSWORD,
      companyDetails: { companyName: account.Name }
    }
  };

  const res = await fetch('https://my.geotab.com/apiv1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json();

  if (json.error) {
    // Check if the error is "database already exists" — if so, treat as success
    const errMsg = JSON.stringify(json.error).toLowerCase();
    if (errMsg.includes('already exists') || errMsg.includes('database exists') || errMsg.includes('exists')) {
      log('warning', `Database ${dbName} already exists. Using existing database.`);
      serverAndDb = await resolveExistingDatabase(dbName);
    } else {
      throw new Error(`CreateDatabase error: ${JSON.stringify(json.error)}`);
    }
  } else {
    // Result is a string like "my3.geotab.com/demo_acmefieldservices"
    serverAndDb = json.result;
    log('success', `Database provisioned: ${serverAndDb}`);
  }

  const database = serverAndDb.split('/')[1] || dbName;
  workflowState.fields.myGeotabDatabase = database;
  workflowState.fields.myGeotabServer   = serverAndDb.split('/')[0];

  await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
    MyGeotab_Database__c: database,
    Current_Stage__c: 'MyGeotab DB',
    Workflow_Day__c: 2,
    Last_Agent_Action__c: `MyGeotab database ready: ${serverAndDb}`,
  });
  log('data', `Salesforce updated: MyGeotab_Database__c = ${database}`);
}

// Helper: find the server for an existing database by authenticating into it
async function resolveExistingDatabase(dbName) {
  try {
    const authBody = {
      id: -1,
      method: 'Authenticate',
      params: {
        database: dbName,
        userName: process.env.MYADMIN_USERNAME,
        password: process.env.MYADMIN_PASSWORD,
      }
    };
    const res  = await fetch('https://my.geotab.com/apiv1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authBody)
    });
    const json = await res.json();
    if (json.result && json.result.path) {
      const server = json.result.path.replace(/\/$/, '');
      log('info', `Resolved existing database server: ${server}/${dbName}`);
      return `${server}/${dbName}`;
    }
  } catch (e) {
    log('warning', `Could not resolve existing database server: ${e.message}`);
  }
  // Fallback
  return `my.geotab.com/${dbName}`;
}

// STEP 5: Poll for Shipment Delivery
async function step5_pollShipment() {
  workflowState.currentStage = 'shipment';

  // Check if delivery has been manually confirmed via /api/confirm-delivery
  if (workflowState._deliveryConfirmed) {
    workflowState._deliveryConfirmed = false;
    const orderNumber = workflowState.fields.deviceOrderNumber;
    workflowState.fields.deviceOrderStatus = 'Delivered';
    workflowState.fields.devicesAssigned = 5;
    workflowState.fields.workflowDay = 3;

    log('success', `Devices provisioned in MyAdmin for order ${orderNumber}. 5 × GO9 — serial numbers confirmed.`);

    await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
      Device_Order_Status__c: 'Provisioned',
      Devices_Assigned__c: 5,
      Current_Stage__c: 'Shipment Monitor',
      Workflow_Day__c: 3,
      Last_Agent_Action__c: `5 × GO9 devices provisioned in MyAdmin. Serial numbers confirmed. Ready to add to MyGeotab database.`,
    });
    log('data', `Salesforce updated: Devices_Assigned__c = 5, Device_Order_Status__c = Provisioned`);
    return true;
  }

  // Not yet confirmed — stay in polling state
  return false;
}

// STEP 6: Activate LMA License (simulated — LMA package records are
// publisher-controlled and not editable in sandbox without a live subscriber install)
async function step6_activateLMA() {
  workflowState.currentStage = 'lma';
  workflowState.fields.workflowDay = 4;

  log('info', 'Processing LMA license activation for Check-Fleet...');
  log('info', `Subscriber: ${workflowState.opportunity?.Account?.Name}`);
  log('info', `Package: Check-Fleet · License type: Site License`);
  log('success', 'LMA license status set to Active. Customer can now access Check-Fleet.');

  workflowState.fields.lmaLicenseStatus = 'Active';

  await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
    LMA_License_Status__c: 'Active',
    Current_Stage__c: 'LMA License',
    Workflow_Day__c: 4,
    Last_Agent_Action__c: `Check-Fleet LMA license activated for ${workflowState.opportunity?.Account?.Name}.`,
  });
  log('data', 'Salesforce updated: LMA_License_Status__c = Active');
}

// FINAL: Mark onboarding complete
async function completeOnboarding() {
  workflowState.currentStage = 'complete';
  workflowState.status = 'complete';

  await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
    Status__c: 'Complete',
    Current_Stage__c: 'Complete',
    Completed_Date__c: new Date().toISOString().split('T')[0],
    Last_Agent_Action__c: 'Onboarding complete. All systems configured.',
  });

  await sfUpdate('Opportunity', workflowState.opportunityId, {
    Onboarding_Status__c: 'Complete',
  });

  log('success', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('success', `ONBOARDING COMPLETE — ${workflowState.opportunity.Account?.Name} is live on Check-Fleet.`);
  log('success', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ─── WORKFLOW RUNNER ──────────────────────────────────────────────────────────
async function runWorkflow(opportunityId) {
  workflowState.status = 'running';
  workflowState.opportunityId = opportunityId;
  workflowState.log = [];

  try {
    // Authenticate both systems first
    await myAdminAuthenticate();
    await sfAuthenticate();

    // Run sequential steps
    await step1_readOpportunity();
    await pauseForNext('step1_done');

    await step2_createMyAdminCustomer();
    await pauseForNext('step2_done');

    await step3_createDraftOrder();
    // Workflow pauses here — resumes via /api/resume endpoint

  } catch (err) {
    workflowState.status = 'error';
    log('error', `Workflow error: ${err.message}`);

    // Write error to Salesforce if we have a record
    if (workflowState.onboardingRecordId) {
      try {
        await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
          Status__c: 'Failed',
          Error_Message__c: err.message,
          Last_Agent_Action__c: `Error at stage: ${workflowState.currentStage}`,
        });
      } catch (sfErr) {
        console.error('Could not write error to Salesforce:', sfErr.message);
      }
    }
  }
}

async function resumeWorkflow(reviewType) {
  workflowState.status = 'running';

  try {
    // Re-authenticate if tokens may have expired
    await myAdminAuthenticate();
    await sfAuthenticate();

    if (reviewType === 'device_order') {
      log('success', 'Rep confirmed order. Submitting to MyAdmin now...');
      await step3b_submitOrder();

      await sfUpdate('Onboarding_Workflow__c', workflowState.onboardingRecordId, {
        Device_Order_Status__c: 'Submitted',
      });
      await pauseForNext('step3b_done');

      await step4_createDatabase();
      await pauseForNext('step4_done');

      // For demo: show shipment monitoring stage, rep clicks Next to simulate delivery
      workflowState.currentStage = 'shipment';
      workflowState.status = 'polling_shipment';
      workflowState.fields.workflowDay = 3;
      log('info', 'Polling MyAdmin for device provisioning — order ' + (workflowState.fields.deviceOrderNumber || '—') + '...');
      log('info', 'Waiting for ordered devices to appear in MyAdmin account with serial numbers...');
      log('warning', '⏸ Once devices are provisioned in MyAdmin, they can be added to the MyGeotab database.');
      pollShipment();

    }

  } catch (err) {
    workflowState.status = 'error';
    log('error', `Resume error: ${err.message}`);
  }
}

// Shipment polling loop — waits for /api/confirm-delivery to set the flag
async function pollShipment() {
  try {
    const delivered = await step5_pollShipment();
    if (delivered) {
      await pauseForNext('step5_done');
      await step6_activateLMA();
      await pauseForNext('step6_done');
      await completeOnboarding();
    } else {
      // Check again in 2 seconds
      setTimeout(pollShipment, 2000);
    }
  } catch (err) {
    workflowState.status = 'error';
    log('error', `Shipment polling error: ${err.message}`);
  }
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// Start workflow
app.post('/api/start', async (req, res) => {
  const opportunityId = req.body.opportunityId || process.env.DEMO_OPPORTUNITY_ID;
  if (!opportunityId) return res.status(400).json({ error: 'opportunityId required' });
  if (workflowState.status === 'running') return res.status(400).json({ error: 'Workflow already running' });

  // Reset state
  workflowState = {
    status: 'idle', currentStage: null, opportunityId: null,
    opportunity: null, onboardingRecordId: null,
    myAdminSessionId: null, myAdminUserId: null, sfAccessToken: null, sfInstanceUrl: null,
    log: [], reviewType: null,
    fields: {
      myAdminCustomerId: null, deviceOrderNumber: null, deviceOrderStatus: null,
      myGeotabDatabase: null, myGeotabServer: null, devicesAssigned: null,
      lmaLicenseStatus: null,
      workflowDay: 1,
    }
  };

  res.json({ started: true, opportunityId });
  runWorkflow(opportunityId); // runs async
});

// Resume after human review
app.post('/api/resume', async (req, res) => {
  const { reviewType } = req.body;
  if (workflowState.status !== 'awaiting_review') {
    return res.status(400).json({ error: 'Not currently awaiting review' });
  }
  res.json({ resumed: true, reviewType });
  resumeWorkflow(reviewType);
});


// Advance past awaiting_next pause (demo step-through)
app.post('/api/next', (req, res) => {
  if (workflowState.status !== 'awaiting_next') {
    return res.status(400).json({ error: 'Not currently paused at a next step' });
  }
  if (workflowState._nextResolve) {
    workflowState._nextResolve();
  }
  res.json({ advanced: true });
});


// Confirm device delivery (demo — simulates shipment arriving)
app.post('/api/confirm-delivery', (req, res) => {
  if (workflowState.status !== 'polling_shipment') {
    return res.status(400).json({ error: 'Not currently monitoring shipment' });
  }
  workflowState._deliveryConfirmed = true;
  res.json({ confirmed: true });
});

// Manually trigger shipment check (for demo)
app.post('/api/check-shipment', async (req, res) => {
  if (workflowState.status !== 'polling_shipment') {
    return res.status(400).json({ error: 'Not currently polling shipment' });
  }
  res.json({ checking: true });
  pollShipment();
});

// Get current state (polled by dashboard)
app.get('/api/state', (req, res) => {
  res.json({
    status: workflowState.status,
    currentStage: workflowState.currentStage,
    reviewType: workflowState.reviewType || null,
    pendingOrder: workflowState.pendingOrder || null,
    fields: workflowState.fields,
    log: workflowState.log,
    opportunityName: workflowState.opportunity?.Name || null,
    accountName: workflowState.opportunity?.Account?.Name || null,
    nextStep: workflowState.nextStep || null,
  });
});

// Reset workflow
app.post('/api/reset', (req, res) => {
  workflowState.status = 'idle';
  workflowState.log = [];
  workflowState.currentStage = null;
  workflowState.nextStep = null;
  workflowState._nextResolve = null;
  res.json({ reset: true });
});

// Test endpoint — get MyAdmin account info
app.get('/api/test-myadmin-account', async (req, res) => {
  try {
    await myAdminAuthenticate();
    const result = await myAdminCall('GetCustomersAsync', {
      forAccount: process.env.MYADMIN_ACCOUNT,
    });
    res.json({ success: true, result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nCheck-Fleet Onboarding Agent running on http://localhost:${PORT}`);
  console.log(`MyAdmin URL:  ${process.env.MYADMIN_URL}`);
  console.log(`Salesforce:   ${process.env.SF_URL}`);
  console.log(`Opportunity:  ${process.env.DEMO_OPPORTUNITY_ID || '(not set)'}\n`);
});
