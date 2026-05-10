import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const envPath = join(rootDir, ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const locationId = process.env.GHL_LOCATION_ID || "YfwlbtO6dLJ7ho2JKvzI";
const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || "";
const dataDir = join(rootDir, "data");
const profileStorePath = join(dataDir, "profile-completions.json");
const createdContactsPath = join(dataDir, "portal-created-contacts.json");
const contactStatusesPath = join(dataDir, "contact-statuses.json");
const internalActivityPath = join(dataDir, "internal-activity.json");
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS || "godwin.inc@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

const sampleReps = [
  { id: "F7kz2DXoX9xMvyIP3Duj", name: "Daniel Godwin", email: "dan@flourishsolar.com", role: "Rep", territory: "Orlando, FL", status: "Active" },
  { id: "admin", name: "Daniel Godwin", email: "godwin.inc@gmail.com", role: "Admin", territory: "All markets", status: "Owner" },
];

const sampleRecords = [
  { id: "jw2NkX7pU5Svc1jaXAOc", type: "Lead", name: "Test Rep Lead", email: "test.rep.lead.20260510@example.com", ownerId: "F7kz2DXoX9xMvyIP3Duj", stage: "New lead", nextStep: "Confirm portal visibility", value: "$0" },
  { id: "homeowner-001", type: "Customer", name: "Sample Homeowner", email: "sample.homeowner@example.com", ownerId: "admin", stage: "Proposal sent", nextStep: "Awaiting admin assignment", value: "$18,400" },
  { id: "install-001", type: "Job", name: "Mock Solar Install", email: "operations@example.com", ownerId: "admin", stage: "Permitting", nextStep: "Upload permit packet", value: "$24,900" },
];

const sampleNotes = [
  { id: "note-1", ownerId: "F7kz2DXoX9xMvyIP3Duj", title: "New lead assigned", body: "Test Rep Lead is ready for review.", time: "Today" },
  { id: "note-2", ownerId: "admin", title: "Portal test ready", body: "Rep visibility passed with one assigned contact.", time: "Today" },
];
const leadStatuses = [
  { value: "new-project", label: "New Project" },
  { value: "design", label: "Design" },
  { value: "proposal", label: "Proposal" },
  { value: "pre-qualification", label: "Pre-Qualification" },
  { value: "sold", label: "Sold" },
  { value: "ntp", label: "NTP" },
];
const statusByValue = new Map(leadStatuses.map((status) => [status.value, status]));
const legacyStatusMap = {
  "new-lead": "new-project",
  contacted: "new-project",
  "appointment-set": "pre-qualification",
  "design-needed": "design",
  "proposal-sent": "proposal",
  "not-interested": "new-project",
};

const internalStatusNotes = {
  design: "Portal stage moved to Design. Internal next step: review design details, confirm assigned rep, and prepare design request.",
  proposal: "Portal stage moved to Proposal. Internal next step: prepare or review proposal package and schedule rep follow-up.",
  sold: "Portal stage moved to Sold. Internal next step: confirm handoff details and begin sold-project checklist.",
  ntp: "Portal stage moved to NTP. Internal next step: notify operations and start NTP checklist.",
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const repReadOnlyStageStyle = `
  <style>
    .status-select:disabled {
      width: fit-content;
      max-width: 100%;
      appearance: none;
      border-color: #d7e0eb;
      background: #f6f9fc;
      color: #4f5f73;
      opacity: 1;
      pointer-events: none;
      padding: 0 10px;
    }
  </style>
`;

function sendHeaders(response, status, headers = {}) {
  response.writeHead(status, { ...securityHeaders, ...headers });
}

function sendJson(response, status, payload) {
  sendHeaders(response, status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function getProfileCompletions() {
  try {
    return JSON.parse(await readFile(profileStorePath, "utf8"));
  } catch {
    return {};
  }
}

async function getPortalCreatedContacts() {
  try {
    return JSON.parse(await readFile(createdContactsPath, "utf8"));
  } catch {
    return [];
  }
}

async function getContactStatuses() {
  try {
    return JSON.parse(await readFile(contactStatusesPath, "utf8"));
  } catch {
    return {};
  }
}

async function getInternalActivity() {
  try {
    return JSON.parse(await readFile(internalActivityPath, "utf8"));
  } catch {
    return [];
  }
}

async function saveContactStatuses(contactStatuses) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(contactStatusesPath, `${JSON.stringify(contactStatuses, null, 2)}\n`);
}

async function saveInternalActivity(activity) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(internalActivityPath, `${JSON.stringify(activity, null, 2)}\n`);
}

async function addInternalActivity(contact, status) {
  const statusLabel = statusByValue.get(status)?.label || status;
  const activity = await getInternalActivity();
  const next = [
    {
      id: `activity-${Date.now()}`,
      ownerId: normalizedOwnerId(contact),
      title: `${statusLabel} stage update`,
      body: `${contact.name || contact.fullName || "Contact"} was moved to ${statusLabel}. Internal note added in HighLevel.`,
      time: new Date().toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    },
    ...activity,
  ].slice(0, 50);
  await saveInternalActivity(next);
  return next[0];
}

async function savePortalCreatedContact(record) {
  await mkdir(dataDir, { recursive: true });
  const existing = await getPortalCreatedContacts();
  const next = [record, ...existing.filter((item) => item.id !== record.id)].slice(0, 100);
  await writeFile(createdContactsPath, `${JSON.stringify(next, null, 2)}\n`);
}

async function saveProfileCompletions(profileCompletions) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(profileStorePath, `${JSON.stringify(profileCompletions, null, 2)}\n`);
}

function normalizedOwnerId(item) {
  return item.assignedTo || item.assigned_to || item.userId || item.user_id || item.ownerId || item.owner_id || "admin";
}

function statusFromTags(tags = []) {
  const statusTag = tags.find((tag) => String(tag).startsWith("portal-status-"));
  if (!statusTag) return null;
  const rawValue = statusTag.replace("portal-status-", "");
  const value = legacyStatusMap[rawValue] || rawValue;
  return statusByValue.get(value) || null;
}

function applyStoredStatus(record, contactStatuses) {
  const storedStatus = contactStatuses[record.id];
  const normalizedStoredStatus = legacyStatusMap[storedStatus] || storedStatus;
  const normalizedRecordStatus = legacyStatusMap[record.portalStatus] || record.portalStatus;
  const status = normalizedStoredStatus ? statusByValue.get(normalizedStoredStatus) : normalizedRecordStatus ? statusByValue.get(normalizedRecordStatus) : null;
  if (!status) return record;
  return {
    ...record,
    portalStatus: status.value,
    stage: status.label,
    nextStep: status.label === "Sold" ? "Confirm handoff" : "Next follow-up",
  };
}

function normalizeContact(contact) {
  const firstName = contact.firstName || contact.first_name || "";
  const lastName = contact.lastName || contact.last_name || "";
  const name = contact.name || contact.fullName || [firstName, lastName].filter(Boolean).join(" ") || "Unnamed contact";
  const tagStatus = statusFromTags(contact.tags || []);
  return {
    id: contact.id,
    type: contact.type || "Lead",
    name,
    email: contact.email || "",
    phone: contact.phone || "",
    address: contact.address1 || contact.address || "",
    city: contact.city || "",
    state: contact.state || "",
    postalCode: contact.postalCode || contact.postal_code || "",
    ownerId: normalizedOwnerId(contact),
    stage: tagStatus?.label || contact.pipelineStage || contact.stage || "Contact",
    nextStep: contact.nextStep || contact.source || "Review contact",
    value: contact.value ? `$${contact.value}` : "$0",
    portalStatus: tagStatus?.value || "",
    tags: contact.tags || [],
    sourceKind: "contact",
  };
}

function normalizeCreatedContact(contact, assignedTo) {
  return {
    id: contact.id,
    type: contact.type || "lead",
    name: contact.name || contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed contact",
    email: contact.email || "",
    phone: contact.phone || "",
    address: contact.address1 || contact.address || "",
    city: contact.city || "",
    state: contact.state || "",
    postalCode: contact.postalCode || contact.postal_code || "",
    ownerId: assignedTo || normalizedOwnerId(contact),
    stage: "New portal lead",
    nextStep: contact.source || "Review design form",
    value: "$0",
    portalStatus: "new-project",
    tags: contact.tags || [],
    sourceKind: "contact",
  };
}

function normalizeOpportunity(opportunity) {
  const contact = opportunity.contact || {};
  return {
    id: opportunity.id,
    type: opportunity.status === "won" ? "Customer" : "Lead",
    name: opportunity.name || opportunity.title || contact.name || "Unnamed opportunity",
    email: contact.email || opportunity.email || "",
    phone: contact.phone || opportunity.phone || "",
    address: contact.address1 || contact.address || "",
    city: contact.city || "",
    state: contact.state || "",
    postalCode: contact.postalCode || contact.postal_code || "",
    ownerId: normalizedOwnerId(opportunity) || normalizedOwnerId(contact),
    stage: opportunity.pipelineStageName || opportunity.stageName || opportunity.status || "Opportunity",
    nextStep: opportunity.nextStep || opportunity.pipelineName || "Review opportunity",
    value: opportunity.monetaryValue ? `$${Number(opportunity.monetaryValue).toLocaleString()}` : "$0",
    sourceKind: "opportunity",
  };
}

async function ghlFetch(path) {
  if (!token) throw new Error("Missing GHL_PRIVATE_INTEGRATION_TOKEN");
  const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      version: "2021-07-28",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`HighLevel ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function ghlJson(path, method, payload) {
  if (!token) throw new Error("Missing GHL_PRIVATE_INTEGRATION_TOKEN");
  const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      version: "2021-07-28",
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HighLevel ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function addInternalContactNote(contactId, status) {
  const body = internalStatusNotes[status];
  if (!body) return null;
  try {
    return await ghlJson(`/contacts/${encodeURIComponent(contactId)}/notes`, "POST", { body });
  } catch (error) {
    console.warn(`Could not create internal GHL note for ${contactId}: ${error.message}`);
    return null;
  }
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "New", lastName: "Portal Lead" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

async function createDesignContact(payload) {
  const { firstName, lastName } = splitName(payload.customerName);
  const assignedTo = payload.assignedRepId || "F7kz2DXoX9xMvyIP3Duj";
  const body = {
    locationId,
    firstName,
    lastName,
    name: payload.customerName,
    email: payload.email || undefined,
    phone: payload.phone,
    address1: payload.address || undefined,
    city: payload.city || undefined,
    state: payload.state || undefined,
    postalCode: payload.postalCode || undefined,
    assignedTo,
    source: "Flourish Rep Portal Design Form",
    tags: ["portal-design-form", "rep-portal-lead"],
  };

  const result = await ghlJson("/contacts/", "POST", body);
  const contact = result.contact || result;
  await savePortalCreatedContact(normalizeCreatedContact(contact, assignedTo));
  return {
    contact,
    assignedTo,
    summary: {
      roofType: payload.roofType || "",
      utilityBill: payload.utilityBill || "",
      projectNotes: payload.projectNotes || "",
    },
  };
}

async function updateContact(payload) {
  if (!payload.contactId) throw new Error("contactId is required");
  const { firstName, lastName } = splitName(payload.customerName);
  const body = {
    firstName,
    lastName,
    name: payload.customerName,
    email: payload.email || undefined,
    phone: payload.phone || undefined,
    address1: payload.address || undefined,
    city: payload.city || undefined,
    state: payload.state || undefined,
    postalCode: payload.postalCode || undefined,
    assignedTo: payload.assignedRepId || undefined,
  };

  const result = await ghlJson(`/contacts/${encodeURIComponent(payload.contactId)}`, "PUT", body);
  const contact = result.contact || result;
  await savePortalCreatedContact(normalizeCreatedContact(contact, payload.assignedRepId));
  return contact;
}

async function updateContactStatus(payload) {
  if (!payload.contactId) throw new Error("contactId is required");
  if (!statusByValue.has(payload.status)) throw new Error("Unsupported status");

  const current = await ghlFetch(`/contacts/${encodeURIComponent(payload.contactId)}`);
  const contact = current.contact || current;
  const existingTags = Array.isArray(contact.tags) ? contact.tags : [];
  const nextTags = [
    ...existingTags.filter((tag) => !String(tag).startsWith("portal-status-")),
    `portal-status-${payload.status}`,
  ];

  const result = await ghlJson(`/contacts/${encodeURIComponent(payload.contactId)}`, "PUT", { tags: nextTags });
  const updatedContact = result.contact || result;
  await addInternalContactNote(payload.contactId, payload.status);
  await addInternalActivity(updatedContact, payload.status);
  const contactStatuses = await getContactStatuses();
  contactStatuses[payload.contactId] = payload.status;
  await saveContactStatuses(contactStatuses);

  const createdContacts = await getPortalCreatedContacts();
  const cachedRecord = createdContacts.find((record) => record.id === payload.contactId);
  if (cachedRecord) {
    await savePortalCreatedContact(applyStoredStatus(cachedRecord, contactStatuses));
  }

  return updatedContact;
}

async function getLivePortalData() {
  if (!token) throw new Error("Missing GHL_PRIVATE_INTEGRATION_TOKEN");

  const [usersResult, contactsResult, opportunitiesResult] = await Promise.allSettled([
    ghlFetch(`/users/search?locationId=${encodeURIComponent(locationId)}`),
    ghlFetch(`/contacts/?locationId=${encodeURIComponent(locationId)}&limit=50`),
    ghlFetch(`/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=50`),
  ]);

  const usersPayload = usersResult.status === "fulfilled" ? usersResult.value : {};
  const contactsPayload = contactsResult.status === "fulfilled" ? contactsResult.value : {};
  const opportunitiesPayload = opportunitiesResult.status === "fulfilled" ? opportunitiesResult.value : {};

  const liveUsers = usersPayload.users || usersPayload.data || [];
  const contacts = contactsPayload.contacts || contactsPayload.data || [];
  const opportunities = opportunitiesPayload.opportunities || opportunitiesPayload.data || [];

  if (
    usersResult.status === "rejected" &&
    contactsResult.status === "rejected" &&
    opportunitiesResult.status === "rejected"
  ) {
    throw new Error("HighLevel connection is not returning CRM data yet.");
  }

  const reps = liveUsers
    .filter((user) => user.email)
    .map((user) => ({
      id: user.id,
      name: user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
      email: user.email,
      role: adminEmails.has(user.email.toLowerCase()) ? "Admin" : "Rep",
      territory: user.locationName || "Assigned territory",
      status: user.deleted ? "Inactive" : "Active",
    }));

  for (const email of adminEmails) {
    if (!reps.some((rep) => rep.email.toLowerCase() === email)) {
      reps.push({ id: "admin", name: "Admin", email, role: "Admin", territory: "All markets", status: "Owner" });
    }
  }

  for (const sampleRep of sampleReps) {
    if (!reps.some((rep) => rep.email.toLowerCase() === sampleRep.email.toLowerCase())) {
      reps.push(sampleRep);
    }
  }

  const portalCreatedContacts = await getPortalCreatedContacts();
  const contactStatuses = await getContactStatuses();
  const records = [...portalCreatedContacts, ...contacts.map(normalizeContact), ...opportunities.map(normalizeOpportunity)]
    .filter((record) => record.id)
    .filter((record, index, list) => list.findIndex((item) => item.id === record.id) === index)
    .map((record) => applyStoredStatus(record, contactStatuses))
    .slice(0, 100);

  return {
    mode: "live",
    locationId,
    reps: reps.length ? reps : sampleReps,
    records: records.length ? records : sampleRecords,
    notes: [...await getInternalActivity(), ...sampleNotes],
    profileCompletions: await getProfileCompletions(),
    leadStatuses,
  };
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      locationId,
      highLevelConfigured: Boolean(token),
    });
  }

  if (url.pathname === "/api/portal/bootstrap") {
    try {
      return sendJson(response, 200, await getLivePortalData());
    } catch (error) {
      return sendJson(response, 200, {
        mode: "sample",
        locationId,
        reps: sampleReps,
        records: sampleRecords,
        notes: [...await getInternalActivity(), ...sampleNotes],
        profileCompletions: await getProfileCompletions(),
        leadStatuses,
        warning: error.message,
      });
    }
  }

  if (url.pathname === "/api/portal/profile-completion" && request.method === "POST") {
    const payload = await readJsonBody(request);
    if (!payload.repId) return sendJson(response, 400, { error: "repId is required" });
    const profileCompletions = await getProfileCompletions();
    if (payload.profile) {
      profileCompletions[payload.repId] = payload.profile;
    } else {
      delete profileCompletions[payload.repId];
    }
    await saveProfileCompletions(profileCompletions);
    return sendJson(response, 200, { ok: true, profileCompletions });
  }

  if (url.pathname === "/api/portal/design-contact" && request.method === "POST") {
    const payload = await readJsonBody(request);
    if (!payload.customerName || !payload.phone) {
      return sendJson(response, 400, { error: "Customer name and phone are required" });
    }
    try {
      const result = await createDesignContact(payload);
      return sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(response, 502, { error: error.message });
    }
  }

  if (url.pathname === "/api/portal/contact" && request.method === "PUT") {
    const payload = await readJsonBody(request);
    if (!payload.contactId || !payload.customerName) {
      return sendJson(response, 400, { error: "Contact ID and customer name are required" });
    }
    try {
      const contact = await updateContact(payload);
      return sendJson(response, 200, { ok: true, contact });
    } catch (error) {
      return sendJson(response, 502, { error: error.message });
    }
  }

  if (url.pathname === "/api/portal/contact-status" && request.method === "PUT") {
    const payload = await readJsonBody(request);
    if (!payload.contactId || !payload.status) {
      return sendJson(response, 400, { error: "Contact ID and status are required" });
    }
    try {
      const contact = await updateContactStatus(payload);
      return sendJson(response, 200, { ok: true, contact });
    } catch (error) {
      return sendJson(response, 502, { error: error.message });
    }
  }

  return sendJson(response, 404, { error: "Not found" });
}

async function handleStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/flourish-rep-portal.html" : url.pathname;
  const filePath = normalize(join(rootDir, decodeURIComponent(requestedPath)));

  if (!filePath.startsWith(rootDir) || !existsSync(filePath)) {
    sendHeaders(response, 404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = extname(filePath);
  sendHeaders(response, 200, {
    "content-type": mimeTypes[extension] || "application/octet-stream",
    "cache-control": extension === ".html" ? "no-store" : "public, max-age=3600",
  });
  if (extension === ".html") {
    const html = await readFile(filePath, "utf8");
    response.end(html.replace("</head>", `${repReadOnlyStageStyle}</head>`));
    return;
  }
  createReadStream(filePath).pipe(response);
}

createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }
    await handleStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}).listen(port, host, () => {
  console.log(`Flourish rep portal running at http://${host}:${port}`);
});
