import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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
const mistralApiKey = process.env.MISTRAL_API_KEY || "";
const mistralModel = process.env.MISTRAL_MODEL || "mistral-small-latest";
const googleMapsBrowserKey = process.env.GOOGLE_MAPS_BROWSER_KEY || "";
const dataDir = join(rootDir, "data");
const profileStorePath = join(dataDir, "profile-completions.json");
const createdContactsPath = join(dataDir, "portal-created-contacts.json");
const contactStatusesPath = join(dataDir, "contact-statuses.json");
const internalActivityPath = join(dataDir, "internal-activity.json");
const magicLinksPath = join(dataDir, "magic-links.json");
const repApplicationsPath = join(dataDir, "rep-applications.json");
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

const hostedMagicLinkScript = `
  <script>
    (() => {
      const isHosted = location.protocol !== "file:";
      if (!isHosted) return;

      async function signInWithToken() {
        const token = new URLSearchParams(location.search).get("magic");
        if (!token) return;
        const response = await fetch("/api/portal/session?token=" + encodeURIComponent(token), { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          const box = document.getElementById("link-box");
          if (box) {
            box.classList.add("visible");
            document.getElementById("link-title").textContent = "Magic link expired";
            document.getElementById("link-warning").textContent = data.error || "Request a new login link.";
          }
          history.replaceState(null, "", "/");
          return;
        }
        if (window.loadPortalData) await window.loadPortalData();
        history.replaceState(null, "", data.session.role === "Admin" ? "/#/admin/access" : "/#/profile");
        window.renderPortal(data.session);
      }

      const form = document.getElementById("login-form");
      if (form) {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const email = document.getElementById("email").value.trim().toLowerCase();
          const linkBox = document.getElementById("link-box");
          const title = document.getElementById("link-title");
          const warning = document.getElementById("link-warning");
          const oldButton = document.getElementById("open-link");
          const button = oldButton.cloneNode(true);
          oldButton.replaceWith(button);
          linkBox.classList.add("visible");
          title.textContent = "Creating secure login link...";
          warning.textContent = "";
          button.textContent = "Working...";
          button.disabled = true;
          try {
            const response = await fetch("/api/portal/magic-link", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not create login link.");
            title.textContent = data.delivered ? "Magic link sent to " + email : "Magic link ready for " + email;
            warning.textContent = data.delivered
              ? "Check that inbox. This secure link expires in 30 minutes."
              : (data.deliveryError || "The email could not be sent yet. Use the button below while testing.");
            button.textContent = "Open secure login link";
            button.disabled = false;
            button.addEventListener("click", () => {
              location.href = data.magicUrl;
            });
          } catch (error) {
            title.textContent = "Login link not created";
            warning.textContent = error.message;
            button.textContent = "Try again";
            button.disabled = true;
          }
        }, true);
      }

      signInWithToken();
    })();
  </script>
`;

const hostedPortalConfigScript = `
  <script>
    window.FLOURISH_PORTAL_CONFIG = {
      googleMapsBrowserKey: ${JSON.stringify(googleMapsBrowserKey)}
    };
  </script>
`;

const hostedRepApprovalScript = `
  <script>
    (() => {
      if (location.protocol === "file:") return;

      async function loadApplications() {
        const response = await fetch("/api/portal/bootstrap", { cache: "no-store" });
        const data = await response.json();
        return Array.isArray(data.repApplications) ? data.repApplications : [];
      }

      async function decorateRepApplications() {
        const list = document.getElementById("rep-list");
        if (!list) return;
        const applications = await loadApplications();
        for (const article of list.querySelectorAll("article")) {
          if (article.querySelector("[data-application-action]")) continue;
          const email = article.querySelector("p")?.textContent?.trim().toLowerCase();
          const application = applications.find((item) => item.email?.toLowerCase() === email);
          if (!application) continue;
          const status = application.status || "Training pending";
          if (["Approved", "Declined"].includes(status)) continue;
          const actions = article.querySelector(".rep-actions");
          if (!actions) continue;
          const trainingButton = status === "Training complete"
            ? '<button type="button" data-application-action="approve" data-application-id="' + application.id + '">Approve + invite</button>'
            : '<button type="button" data-application-action="training-complete" data-application-id="' + application.id + '">Mark training complete</button>';
          actions.insertAdjacentHTML("beforeend", trainingButton +
            '<button type="button" data-application-action="decline" data-application-id="' + application.id + '">Decline</button>');
        }
      }

      document.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-application-action]");
        if (!button) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const action = button.dataset.applicationAction;
        const nextStatus = action === "training-complete" ? "Training complete" : action === "approve" ? "Approved" : "Declined";
        button.disabled = true;
        button.textContent = action === "training-complete" ? "Saving..." : action === "approve" ? "Approving..." : "Declining...";
        try {
          const response = await fetch("/api/portal/rep-application-status", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              applicationId: button.dataset.applicationId,
              status: nextStatus,
              sendInvite: action === "approve",
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Could not update request.");
          if (window.loadPortalData) await window.loadPortalData();
          if (window.renderDashboard && typeof currentSession !== "undefined") window.renderDashboard(currentSession);
        } catch (error) {
          button.disabled = false;
          button.textContent = action === "training-complete" ? "Mark training complete" : action === "approve" ? "Approve + invite" : "Decline";
          alert(error.message);
        }
      }, true);

      const originalRenderDashboard = window.renderDashboard;
      if (typeof originalRenderDashboard === "function") {
        window.renderDashboard = function (...args) {
          const result = originalRenderDashboard.apply(this, args);
          setTimeout(decorateRepApplications, 0);
          return result;
        };
      }
      document.addEventListener("DOMContentLoaded", () => setTimeout(decorateRepApplications, 500));
    })();
  </script>
`;

const hostedAiAssistantScript = `
  <style>
    .ai-assistant-panel {
      display: grid;
      gap: 10px;
    }

    .ai-assistant-panel textarea {
      width: 100%;
      min-height: 92px;
      resize: vertical;
      border: 1px solid #d7e0eb;
      border-radius: 8px;
      padding: 11px 12px;
      font: inherit;
      color: #172132;
      background: #fff;
    }

    .ai-assistant-panel textarea:focus {
      outline: 3px solid rgba(42, 139, 99, 0.16);
      border-color: #2a8b63;
    }

    .ai-assistant-response {
      display: none;
      border: 1px solid #d7e0eb;
      border-radius: 8px;
      background: #f7faf9;
      color: #273446;
      padding: 14px;
      line-height: 1.5;
    }

    .ai-assistant-response h3 {
      margin: 0 0 9px;
      color: #13241f;
      font-size: 16px;
      letter-spacing: 0;
    }

    .ai-assistant-response p {
      margin: 0 0 10px;
    }

    .ai-assistant-response ol,
    .ai-assistant-response ul {
      display: grid;
      gap: 8px;
      margin: 10px 0 0;
      padding-left: 20px;
    }

    .ai-assistant-response li {
      padding-left: 2px;
    }

    .ai-assistant-response strong {
      color: #13241f;
    }

    .ai-assistant-response.visible {
      display: block;
    }

    .ai-assistant-response.error {
      border-color: #f0c2c2;
      background: #fce8e8;
      color: #9a2b2b;
    }
  </style>
  <script>
    (() => {
      const isHosted = location.protocol !== "file:";
      if (!isHosted) return;

      function getSession() {
        try {
          return JSON.parse(sessionStorage.getItem("flourishPortalSession") || "null");
        } catch {
          return null;
        }
      }

      function ensureAiPanel() {
        const session = getSession();
        const rail = document.querySelector(".right-rail");
        if (!rail || !session || session.role !== "Admin") return;
        if (document.getElementById("ai-assistant-panel")) return;

        const panel = document.createElement("section");
        panel.id = "ai-assistant-panel";
        panel.innerHTML = [
          "<h2>AI Assistant</h2>",
          "<p class=\\"muted\\">Internal help for admin planning, lead cleanup, rep follow-up, and onboarding next steps.</p>",
          "<form class=\\"ai-assistant-panel\\" id=\\"ai-assistant-form\\">",
          "<textarea id=\\"ai-assistant-question\\" placeholder=\\"Ask what needs attention, who needs follow-up, or how to clean up the pipeline.\\"></textarea>",
          "<button class=\\"primary-action\\" id=\\"ai-assistant-submit\\" type=\\"submit\\">Ask AI</button>",
          "<div class=\\"ai-assistant-response\\" id=\\"ai-assistant-response\\"></div>",
          "</form>"
        ].join("");

        rail.insertBefore(panel, document.getElementById("admin-panel"));
        document.getElementById("ai-assistant-form").addEventListener("submit", async (event) => {
          event.preventDefault();
          const question = document.getElementById("ai-assistant-question").value.trim();
          const button = document.getElementById("ai-assistant-submit");
          const output = document.getElementById("ai-assistant-response");
          if (!question) return;
          button.disabled = true;
          button.textContent = "Thinking...";
          output.className = "ai-assistant-response visible";
          output.textContent = "Reviewing the portal data...";
          try {
            const response = await fetch("/api/portal/ai-assistant", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email: session.email, role: session.role, question })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "AI assistant is not ready yet.");
            output.innerHTML = formatAssistantAnswer(result.answer || "");
          } catch (error) {
            output.className = "ai-assistant-response visible error";
            output.textContent = error.message;
          } finally {
            button.disabled = false;
            button.textContent = "Ask AI";
          }
        });
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function inlineFormat(value) {
        const codeTick = String.fromCharCode(96);
        return escapeHtml(value)
          .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
          .replace(new RegExp(codeTick + "([^" + codeTick + "]+)" + codeTick, "g"), "<code>$1</code>");
      }

      function formatAssistantAnswer(answer) {
        const lines = String(answer).split(/\\n+/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return "<p>No recommendation returned yet.</p>";

        let html = "";
        let listOpen = false;
        lines.forEach((line, index) => {
          const numbered = line.match(/^(\\d+)\\.\\s+(.*)$/);
          const bullet = line.match(/^[-*]\\s+(.*)$/);
          if (numbered || bullet) {
            if (!listOpen) {
              html += numbered ? "<ol>" : "<ul>";
              listOpen = numbered ? "ol" : "ul";
            }
            html += "<li>" + inlineFormat(numbered ? numbered[2] : bullet[1]) + "</li>";
            return;
          }
          if (listOpen) {
            html += "</" + listOpen + ">";
            listOpen = false;
          }
          const cleanLine = line.replace(/^#+\\s*/, "");
          html += index === 0
            ? "<h3>" + inlineFormat(cleanLine) + "</h3>"
            : "<p>" + inlineFormat(cleanLine) + "</p>";
        });
        if (listOpen) html += "</" + listOpen + ">";
        return html;
      }

      const observer = new MutationObserver(ensureAiPanel);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener("storage", ensureAiPanel);
      document.addEventListener("DOMContentLoaded", ensureAiPanel);
      setTimeout(ensureAiPanel, 250);
    })();
  </script>
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

async function getMagicLinks() {
  try {
    return JSON.parse(await readFile(magicLinksPath, "utf8"));
  } catch {
    return {};
  }
}

async function getRepApplications() {
  try {
    return JSON.parse(await readFile(repApplicationsPath, "utf8"));
  } catch {
    return [];
  }
}

async function saveRepApplications(repApplications) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(repApplicationsPath, `${JSON.stringify(repApplications, null, 2)}\n`);
}

async function saveMagicLinks(magicLinks) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(magicLinksPath, `${JSON.stringify(magicLinks, null, 2)}\n`);
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
      body: `${contact.name || contact.fullName || "Contact"} was moved to ${statusLabel}. Internal note added in the CRM.`,
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

async function addProjectActionActivity({ contact, action, title, body }) {
  const activity = await getInternalActivity();
  const next = [
    {
      id: `activity-${Date.now()}`,
      ownerId: normalizedOwnerId(contact),
      title,
      body: `${contact.name || contact.fullName || "Project"} - ${body}`,
      action,
      contactId: contact.id || "",
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

async function archiveQaActivity(payload = {}) {
  const email = String(payload.email || "").trim().toLowerCase();
  if (!adminEmails.has(email)) throw new Error("Admin email is required");
  if (payload.confirm !== "archive-qa-activity") throw new Error("Cleanup confirmation is required");
  const activity = await getInternalActivity();
  const qaPatterns = [
    /Live QA/i,
    /QA upload workflow smoke test/i,
    /QA update workflow smoke test/i,
  ];
  const kept = activity.filter((item) => {
    const text = [item.title, item.body, item.action].filter(Boolean).join(" ");
    return !qaPatterns.some((pattern) => pattern.test(text));
  });
  if (kept.length !== activity.length) await saveInternalActivity(kept);
  return {
    removed: activity.length - kept.length,
    remaining: kept.length,
  };
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

function crmAssignableUserId(repId) {
  const value = String(repId || "").trim();
  if (!value || value.startsWith("rep-")) return "";
  return value;
}

function projectIdFrom(item = {}) {
  if (item.projectId || item.project_id) return item.projectId || item.project_id;
  const fields = item.customFields || item.custom_fields || [];
  if (!Array.isArray(fields)) return "";
  const field = fields.find((entry) => {
    const key = String(entry.key || entry.name || entry.id || "").toLowerCase();
    return key.includes("project") && key.includes("id");
  });
  return field?.value || "";
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
  const nextStepByStatus = {
    "new-project": "Review project details",
    design: "Design package submitted - admin/design review",
    proposal: "Review proposal with homeowner",
    "pre-qualification": "Review pre-qualification status",
    sold: "Confirm handoff",
    ntp: "NTP checklist ready",
  };
  return {
    ...record,
    portalStatus: status.value,
    stage: status.label,
    nextStep: nextStepByStatus[status.value] || record.nextStep || "Next follow-up",
  };
}

function normalizeContact(contact) {
  const firstName = contact.firstName || contact.first_name || "";
  const lastName = contact.lastName || contact.last_name || "";
  const name = contact.name || contact.fullName || [firstName, lastName].filter(Boolean).join(" ") || "Unnamed contact";
  const tagStatus = statusFromTags(contact.tags || []);
  return {
    id: contact.id,
    projectId: projectIdFrom(contact),
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
    projectId: projectIdFrom(contact),
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
    projectId: projectIdFrom(opportunity),
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

function isInternalPortalRecord(record) {
  const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag).toLowerCase()) : [];
  return tags.includes("rep-onboarding") || (tags.includes("rep-portal-access") && tags.includes("internal-rep-login"));
}

async function ghlFetch(path) {
  if (!token) throw new Error("Missing CRM integration token");
  const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      version: "2021-07-28",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`CRM ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function ghlJson(path, method, payload) {
  if (!token) throw new Error("Missing CRM integration token");
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
    throw new Error(`CRM ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function parseCrmError(error) {
  const message = String(error?.message || "");
  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(message.slice(jsonStart));
  } catch {
    return null;
  }
}

function duplicateContactIdFromError(error) {
  const payload = parseCrmError(error);
  return payload?.meta?.contactId || payload?.contactId || "";
}

async function ghlJsonWithVersion(path, method, payload, version = "2021-07-28") {
  if (!token) throw new Error("Missing CRM integration token");
  const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      version,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`CRM ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function addInternalContactNote(contactId, status) {
  const body = internalStatusNotes[status];
  if (!body) return null;
  try {
    return await ghlJson(`/contacts/${encodeURIComponent(contactId)}/notes`, "POST", { body });
  } catch (error) {
    console.warn(`Could not create internal CRM note for ${contactId}: ${error.message}`);
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
  const portalOwnerId = payload.assignedRepId || "F7kz2DXoX9xMvyIP3Duj";
  const assignedTo = crmAssignableUserId(portalOwnerId);
  const portalTags = ["portal-design-form", "rep-portal-lead"];
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
    assignedTo: assignedTo || undefined,
    source: "Flourish Rep Portal Design Form",
    tags: portalTags,
  };

  let result;
  let reusedExisting = false;
  let existingCustomer = null;
  try {
    result = await ghlJson("/contacts/", "POST", body);
  } catch (error) {
    const duplicateContactId = duplicateContactIdFromError(error);
    if (!duplicateContactId) {
      const crmPayload = parseCrmError(error);
      throw new Error(crmPayload?.message || error.message);
    }
    const current = await ghlFetch(`/contacts/${encodeURIComponent(duplicateContactId)}`);
    const existingContact = current.contact || current;
    existingCustomer = normalizeContact(existingContact);
    const existingTags = Array.isArray(existingContact.tags) ? existingContact.tags : [];
    const updateBody = {
      firstName,
      lastName,
      name: payload.customerName,
      email: payload.email || existingContact.email || undefined,
      phone: payload.phone || existingContact.phone || undefined,
      address1: payload.address || existingContact.address1 || existingContact.address || undefined,
      city: payload.city || existingContact.city || undefined,
      state: payload.state || existingContact.state || undefined,
      postalCode: payload.postalCode || existingContact.postalCode || existingContact.postal_code || undefined,
      assignedTo: assignedTo || existingContact.assignedTo || undefined,
      tags: Array.from(new Set([...existingTags, ...portalTags])),
    };
    result = await ghlJson(`/contacts/${encodeURIComponent(duplicateContactId)}`, "PUT", updateBody);
    reusedExisting = true;
  }
  const contact = result.contact || result;
  await savePortalCreatedContact({
    ...normalizeCreatedContact(contact, portalOwnerId),
    utilityBill: payload.utilityBill || "",
    utilityBillFileName: payload.utilityBillFileName || "",
    utilityBillImage: payload.utilityBillImage || "",
    projectNotes: payload.projectNotes || "",
    roofType: payload.roofType || "",
  });
  return {
    contact,
    assignedTo: portalOwnerId,
    reusedExisting,
    existingCustomer: reusedExisting
      ? {
          id: existingCustomer?.id || contact.id,
          name: existingCustomer?.name || contact.name || payload.customerName,
          email: existingCustomer?.email || contact.email || payload.email || "",
          phone: existingCustomer?.phone || contact.phone || payload.phone || "",
        }
      : null,
    summary: {
      roofType: payload.roofType || "",
      utilityBill: payload.utilityBill || "",
      utilityBillFileName: payload.utilityBillFileName || "",
      projectNotes: payload.projectNotes || "",
    },
  };
}

async function createWebsiteConsultation(payload) {
  if (!payload.customerName || !payload.phone) {
    throw new Error("Name and phone are required");
  }
  const { firstName, lastName } = splitName(payload.customerName);
  const body = {
    locationId,
    firstName,
    lastName,
    name: payload.customerName,
    email: payload.email || undefined,
    phone: payload.phone,
    postalCode: payload.postalCode || undefined,
    source: "Flourish Solar Website Consultation",
    tags: ["website-consultation", "flourishsolar.com", "portal-status-new-project"],
  };

  const result = await ghlJson("/contacts/", "POST", body);
  const contact = result.contact || result;
  await savePortalCreatedContact({
    ...normalizeCreatedContact(contact, "admin"),
    stage: "New Project",
    nextStep: payload.interest || "Website consultation request",
    portalStatus: "new-project",
    summary: {
      interest: payload.interest || "",
      projectNotes: payload.projectNotes || "",
    },
  });
  return { contact };
}

async function createRepApplication(payload) {
  if (!payload.name || !payload.email || !payload.phone) {
    throw new Error("Name, email, and phone are required");
  }
  const { firstName, lastName } = splitName(payload.name);
  const body = {
    firstName,
    lastName,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    source: "Join Flourish Solar Onboarding",
    tags: ["rep-onboarding", "rep-portal-access", "internal-rep-login"],
  };

  const existingContact = await findRepAccessContact(payload.email);
  const result = existingContact?.id
    ? await ghlJson(`/contacts/${encodeURIComponent(existingContact.id)}`, "PUT", body)
    : await ghlJson("/contacts/", "POST", { locationId, ...body });
  const contact = result.contact || result;
  const application = {
    id: contact.id || `rep-application-${Date.now()}`,
    contactId: contact.id || "",
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    territory: payload.territory || "",
    serviceArea: payload.serviceArea || "",
    experience: payload.experience || "",
    notificationPreference: payload.notificationPreference || "",
    notes: payload.notes || "",
    status: "Training pending",
    createdAt: new Date().toISOString(),
  };
  const applications = await getRepApplications();
  const next = [application, ...applications.filter((item) => item.email?.toLowerCase() !== application.email.toLowerCase())].slice(0, 100);
  await saveRepApplications(next);
  return { contact, application };
}

function repFromApplication(application) {
  return {
    id: `rep-${application.contactId || application.id}`,
    name: application.name,
    email: application.email,
    role: "Rep",
    territory: application.territory || application.serviceArea || "Assigned territory",
    status: "Active",
    source: "Join Flourish Solar",
  };
}

async function updateRepApplicationStatus(payload, request) {
  const applicationId = payload.applicationId || payload.id;
  if (!applicationId) throw new Error("applicationId is required");
  const allowedStatuses = new Set(["Training pending", "Training complete", "Approved", "Declined"]);
  const status = allowedStatuses.has(payload.status) ? payload.status : "Approved";
  const applications = await getRepApplications();
  const application = applications.find((item) => item.id === applicationId || item.contactId === applicationId);
  if (!application) throw new Error("Onboarding request was not found");
  if (status === "Approved" && application.status !== "Training complete" && !application.trainingCompletedAt) {
    throw new Error("Training must be marked complete before approval");
  }

  const updatedApplication = {
    ...application,
    status,
    trainingCompletedAt: status === "Training complete" ? new Date().toISOString() : application.trainingCompletedAt,
    reviewedAt: status === "Approved" || status === "Declined" ? new Date().toISOString() : application.reviewedAt,
  };
  const next = applications.map((item) => (
    item.id === application.id || item.contactId === application.contactId ? updatedApplication : item
  ));
  await saveRepApplications(next);

  if (application.contactId) {
    try {
      const current = await ghlFetch(`/contacts/${encodeURIComponent(application.contactId)}`);
      const contact = current.contact || current;
      const existingTags = Array.isArray(contact.tags) ? contact.tags : [];
      const nextTags = [
        ...existingTags.filter((tag) => !["rep-approved", "rep-declined", "rep-training-complete"].includes(String(tag).toLowerCase())),
        ...(updatedApplication.trainingCompletedAt ? ["rep-training-complete"] : []),
        ...(status === "Approved" ? ["rep-approved"] : []),
        ...(status === "Declined" ? ["rep-declined"] : []),
      ];
      await ghlJson(`/contacts/${encodeURIComponent(application.contactId)}`, "PUT", {
        tags: [...new Set(nextTags)],
        source: status === "Approved"
          ? "Flourish Rep Portal Approved"
          : status === "Declined"
            ? "Flourish Rep Portal Declined"
            : "Flourish Rep Portal Training",
      });
    } catch (error) {
      console.warn(`Could not update rep application contact ${application.contactId}: ${error.message}`);
    }
  }

  if (status === "Approved") {
    const profileCompletions = await getProfileCompletions();
    const repId = repFromApplication(updatedApplication).id;
    profileCompletions[repId] = {
      phone: updatedApplication.phone || "",
      notificationPreference: updatedApplication.notificationPreference || "",
      territory: updatedApplication.territory || "",
      experience: updatedApplication.experience || "",
      serviceArea: updatedApplication.serviceArea || "",
      adminNotes: updatedApplication.notes || "",
      completedAt: new Date().toISOString(),
      completedByAdmin: true,
    };
    await saveProfileCompletions(profileCompletions);
    const invite = payload.sendInvite === false ? null : await createMagicLogin(request, updatedApplication.email);
    return { application: updatedApplication, invite };
  }

  return { application: updatedApplication, invite: null };
}

async function findRepAccessContact(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;
  const duplicate = await ghlFetch(`/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&email=${encodeURIComponent(normalizedEmail)}`);
  return duplicate.contact || null;
}

async function getOrCreateRepAccessContact(user) {
  const existingContact = await findRepAccessContact(user.email);
  if (existingContact?.id) return existingContact;

  const { firstName, lastName } = splitName(user.name || user.email);
  const result = await ghlJson("/contacts/", "POST", {
    locationId,
    firstName,
    lastName,
    name: user.name || user.email,
    email: user.email,
    phone: user.phone || undefined,
    assignedTo: user.role === "Admin" ? undefined : user.id,
    source: "Flourish Rep Portal Access",
    tags: ["rep-portal-access", "internal-rep-login"],
  });
  return result.contact || result;
}

async function sendMagicLoginEmail(user, magicUrl, expiresAt) {
  const contact = await getOrCreateRepAccessContact(user);
  const expirationTime = new Date(expiresAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const subject = "Your Flourish Solar portal login link";
  const message = `Your Flourish Solar portal login link is ready: ${magicUrl}\n\nThis secure link expires ${expirationTime}.`;
  const html = `
    <p>Your Flourish Solar portal login link is ready.</p>
    <p><a href="${magicUrl}">Open the portal</a></p>
    <p>This secure link expires ${expirationTime}.</p>
  `;
  const delivery = await ghlJsonWithVersion("/conversations/messages", "POST", {
    type: "Email",
    contactId: contact.id,
    subject,
    message,
    html,
  }, "2021-04-15");
  return {
    contactId: contact.id,
    messageId: delivery.messageId || delivery.emailMessageId || "",
    conversationId: delivery.conversationId || "",
  };
}

async function updateContact(payload) {
  if (!payload.contactId) throw new Error("contactId is required");
  const { firstName, lastName } = splitName(payload.customerName);
  const portalOwnerId = payload.assignedRepId || "";
  const assignedTo = crmAssignableUserId(portalOwnerId);
  const createdContacts = await getPortalCreatedContacts();
  const existingRecord = createdContacts.find((record) => record.id === payload.contactId);
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
    assignedTo: assignedTo || undefined,
  };

  const result = await ghlJson(`/contacts/${encodeURIComponent(payload.contactId)}`, "PUT", body);
  const contact = result.contact || result;
  const normalized = normalizeCreatedContact(contact, portalOwnerId || existingRecord?.ownerId || normalizedOwnerId(contact));
  await savePortalCreatedContact({
    ...normalized,
    ...existingRecord,
    name: normalized.name,
    email: normalized.email,
    phone: normalized.phone,
    address: normalized.address,
    city: normalized.city,
    state: normalized.state,
    postalCode: normalized.postalCode,
    ownerId: portalOwnerId || existingRecord?.ownerId || normalized.ownerId,
    projectId: existingRecord?.projectId || normalized.projectId,
    type: existingRecord?.type || normalized.type,
    stage: existingRecord?.stage || normalized.stage,
    nextStep: existingRecord?.nextStep || normalized.nextStep,
    value: existingRecord?.value || normalized.value,
    portalStatus: existingRecord?.portalStatus || normalized.portalStatus,
  });
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

async function saveProjectAction(payload) {
  if (!payload.contactId) throw new Error("contactId is required");
  const action = String(payload.action || "").trim();
  if (!action) throw new Error("Project action is required");

  if (action === "design") {
    const updatedContact = await updateContactStatus({ contactId: payload.contactId, status: "design" });
    const createdContacts = await getPortalCreatedContacts();
    const cachedRecord = createdContacts.find((record) => record.id === payload.contactId);
    if (cachedRecord) {
      await savePortalCreatedContact({
        ...cachedRecord,
        portalStatus: "design",
        stage: "Design",
        nextStep: "Design package submitted - admin/design review",
        utilityBill: payload.utilityBill || cachedRecord.utilityBill || "",
        utilityBillFileName: payload.utilityBillFileName || cachedRecord.utilityBillFileName || "",
        projectNotes: payload.notes || cachedRecord.projectNotes || "",
        roofType: payload.roofType || cachedRecord.roofType || "",
      });
    }
    const activity = await addProjectActionActivity({
      contact: updatedContact,
      action,
      title: "Design package submitted",
      body: "ready for admin/design review. Project stage moved to Design.",
    });
    return {
      contact: updatedContact,
      status: "design",
      nextStep: "Design package submitted - admin/design review",
      activity,
    };
  }

  let contact;
  if (action === "update") {
    contact = await updateContact({
      contactId: payload.contactId,
      customerName: payload.customerName,
      phone: payload.phone,
      email: payload.email,
      address: payload.address,
      assignedRepId: payload.assignedRepId,
    });
  } else {
    const current = await ghlFetch(`/contacts/${encodeURIComponent(payload.contactId)}`);
    contact = current.contact || current;
  }

  const createdContacts = await getPortalCreatedContacts();
  const cachedRecord = createdContacts.find((record) => record.id === payload.contactId);
  const storedRecord = cachedRecord || (action === "details" ? normalizeContact(contact) : null);
  if (storedRecord) {
    await savePortalCreatedContact({
      ...storedRecord,
      name: payload.customerName || storedRecord.name,
      phone: payload.phone || storedRecord.phone,
      email: payload.email || storedRecord.email,
      address: payload.address || storedRecord.address,
      systemSize: payload.systemSize || storedRecord.systemSize || "",
      productionEstimate: payload.productionEstimate || storedRecord.productionEstimate || "",
      value: payload.projectValue || storedRecord.value || "",
      commissionRate: payload.commissionRate || storedRecord.commissionRate || "",
      commissionOverride: payload.commissionOverride || storedRecord.commissionOverride || "",
      commissionStatus: payload.commissionStatus || storedRecord.commissionStatus || "",
      paymentStatus: payload.paymentStatus || storedRecord.paymentStatus || "",
      projectAdders: Array.isArray(payload.projectAdders) ? payload.projectAdders : storedRecord.projectAdders || [],
      utilityBill: payload.utilityBill || storedRecord.utilityBill || "",
      utilityBillFileName: payload.utilityBillFileName || storedRecord.utilityBillFileName || "",
      projectNotes: payload.notes || storedRecord.projectNotes || "",
      nextStep: action === "upload"
        ? "Project files uploaded - admin/design review"
        : action === "update"
          ? "Project details updated"
          : action === "details"
            ? "Project details updated"
          : storedRecord.nextStep,
    });
  }

  const activityTitles = {
    update: "Project info updated",
    upload: "Project files uploaded",
    details: "Project details updated",
  };
  const activityBody = action === "upload"
    ? `${payload.fileType || "Project file"} saved${payload.utilityBillFileName ? `: ${payload.utilityBillFileName}` : ""}. ${payload.notes || ""}`.trim()
    : action === "details"
      ? `System ${payload.systemSize || "not set"}, production ${payload.productionEstimate || "not set"}, adders ${Array.isArray(payload.projectAdders) ? payload.projectAdders.length : 0}, commission rate ${payload.commissionRate || "default"}, commission ${payload.commissionStatus || "not set"}, payment ${payload.paymentStatus || "not set"}. ${payload.notes || ""}`.trim()
      : payload.notes || "saved in the project workspace.";
  const activity = await addProjectActionActivity({
    contact,
    action,
    title: activityTitles[action] || "Project action saved",
    body: activityBody,
  });
  return { contact, activity };
}

async function getLivePortalData() {
  if (!token) throw new Error("Missing CRM integration token");

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
    throw new Error("The live data connection is not returning project data yet.");
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

  const repApplications = await getRepApplications();
  for (const application of repApplications) {
    if (application.status === "Approved" && application.email && !reps.some((rep) => rep.email.toLowerCase() === application.email.toLowerCase())) {
      reps.push(repFromApplication(application));
    }
  }

  const portalCreatedContacts = await getPortalCreatedContacts();
  const contactStatuses = await getContactStatuses();
  const records = [...portalCreatedContacts, ...contacts.map(normalizeContact), ...opportunities.map(normalizeOpportunity)]
    .filter((record) => record.id)
    .filter((record) => !isInternalPortalRecord(record))
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
    repApplications,
    leadStatuses,
  };
}

function requestOrigin(request) {
  const hostName = request.headers["x-forwarded-host"] || request.headers.host;
  const localHost = String(hostName || "").startsWith("127.0.0.1") || String(hostName || "").startsWith("localhost");
  const protocol = request.headers["x-forwarded-proto"] || (localHost ? "http" : "https");
  return `${protocol}://${hostName}`;
}

async function findPortalUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email is required");
  const portalData = await getLivePortalData();
  const user = portalData.reps.find((rep) => rep.email.toLowerCase() === normalizedEmail);
  if (!user) throw new Error("No portal user is registered for that email yet.");
  return user;
}

async function createMagicLogin(request, email) {
  const user = await findPortalUserByEmail(email);
  const magicLinks = await getMagicLinks();
  const now = Date.now();
  for (const [storedToken, link] of Object.entries(magicLinks)) {
    if (!link.expiresAt || new Date(link.expiresAt).getTime() <= now) delete magicLinks[storedToken];
  }
  const magicToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(now + 30 * 60 * 1000).toISOString();
  magicLinks[magicToken] = {
    email: user.email,
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  };
  await saveMagicLinks(magicLinks);
  const origin = requestOrigin(request);
  const requestPath = new URL(request.url || "/", origin).pathname;
  const refererPath = request.headers.referer ? new URL(request.headers.referer, origin).pathname : "";
  const loginPath = requestPath.startsWith("/portal") || refererPath.startsWith("/portal") ? "/portal" : "/";
  const magicUrl = `${origin}${loginPath}?magic=${magicToken}`;
  let delivery = null;
  let deliveryError = "";
  try {
    delivery = await sendMagicLoginEmail(user, magicUrl, expiresAt);
  } catch (error) {
    deliveryError = error.message;
    console.warn(`Could not send magic link to ${user.email}: ${error.message}`);
  }
  return {
    email: user.email,
    expiresAt,
    magicUrl,
    delivered: Boolean(delivery),
    deliveryChannel: delivery ? "email" : "",
    delivery,
    deliveryError,
  };
}

async function validateMagicLogin(magicToken) {
  const magicLinks = await getMagicLinks();
  const login = magicLinks[magicToken];
  if (!login) throw new Error("That login link is invalid or has already been used.");
  delete magicLinks[magicToken];
  await saveMagicLinks(magicLinks);
  if (new Date(login.expiresAt).getTime() <= Date.now()) {
    throw new Error("That login link has expired. Request a new one.");
  }
  return findPortalUserByEmail(login.email);
}

function buildAiPortalContext(portalData) {
  const statusCounts = leadStatuses.map((status) => ({
    stage: status.label,
    count: portalData.records.filter((record) => (record.portalStatus || "new-project") === status.value).length,
  }));
  const reps = portalData.reps
    .filter((rep) => rep.role === "Rep")
    .map((rep) => ({
      name: rep.name,
      email: rep.email,
      territory: rep.territory,
      status: rep.status,
      profileComplete: Boolean(portalData.profileCompletions?.[rep.id]),
      assignedRecords: portalData.records.filter((record) => record.ownerId === rep.id).length,
    }));
  const records = portalData.records.slice(0, 80).map((record) => ({
    type: record.type,
    name: record.name,
    email: record.email || "",
    phone: record.phone || "",
    ownerId: record.ownerId || "",
    stage: statusByValue.get(record.portalStatus || "new-project")?.label || record.stage || "New Project",
    nextStep: record.nextStep || "",
    value: record.value || "",
    source: record.source || record.sourceKind || "",
  }));
  const notes = portalData.notes.slice(0, 30).map((note) => ({
    title: note.title,
    body: note.body,
    time: note.time,
  }));
  const applications = portalData.repApplications.slice(0, 40).map((application) => ({
    name: application.name,
    email: application.email,
    territory: application.territory,
    status: application.status,
    experience: application.experience,
  }));

  return {
    locationId: portalData.locationId,
    dataMode: portalData.mode,
    totals: {
      reps: reps.length,
      records: portalData.records.length,
      applications: applications.length,
    },
    statusCounts,
    reps,
    records,
    recentInternalActivity: notes,
    onboardingApplications: applications,
  };
}

async function askMistralForPortal({ question, portalData }) {
  if (!mistralApiKey) throw new Error("Mistral is not configured yet.");

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${mistralApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: mistralModel,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: [
            "You are the internal AI assistant for Flourish Solar's admin portal.",
            "Help the admin organize reps, leads, customers, jobs, onboarding, and internal follow-up.",
            "Use only the provided portal data. If data is missing, say what should be checked.",
            "Do not write customer-facing messages or claim any customer communication was sent.",
            "Keep answers practical, concise, and action-focused.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            portalContext: buildAiPortalContext(portalData),
          }),
        },
      ],
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || result.error?.message || "Mistral did not return a usable response.");
  }
  return result.choices?.[0]?.message?.content?.trim() || "I could not generate an answer from the current portal data.";
}

async function getPortalDataForAssistant() {
  try {
    return await getLivePortalData();
  } catch (error) {
    return {
      mode: "sample",
      locationId,
      reps: sampleReps,
      records: sampleRecords,
      notes: [...await getInternalActivity(), ...sampleNotes],
      profileCompletions: await getProfileCompletions(),
      repApplications: await getRepApplications(),
      leadStatuses,
      warning: error.message,
    };
  }
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      locationId,
      highLevelConfigured: Boolean(token),
      mistralConfigured: Boolean(mistralApiKey),
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
        repApplications: await getRepApplications(),
        leadStatuses,
        warning: error.message,
      });
    }
  }

  if (url.pathname === "/api/portal/magic-link" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      return sendJson(response, 200, { ok: true, ...await createMagicLogin(request, payload.email) });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (url.pathname === "/api/portal/session") {
    try {
      const session = await validateMagicLogin(url.searchParams.get("token"));
      return sendJson(response, 200, { ok: true, session });
    } catch (error) {
      return sendJson(response, 401, { error: error.message });
    }
  }

  if (url.pathname === "/api/portal/rep-application" && request.method === "POST") {
    const payload = await readJsonBody(request);
    try {
      const result = await createRepApplication(payload);
      return sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(response, 502, { error: error.message });
    }
  }

  if (url.pathname === "/api/portal/rep-application-status" && request.method === "POST") {
    const payload = await readJsonBody(request);
    try {
      const result = await updateRepApplicationStatus(payload, request);
      return sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
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

  if (url.pathname === "/api/portal/ai-assistant" && request.method === "POST") {
    const payload = await readJsonBody(request);
    const email = String(payload.email || "").trim().toLowerCase();
    const role = String(payload.role || "");
    const question = String(payload.question || "").trim();
    if (!question) return sendJson(response, 400, { error: "Ask a question first." });
    if (role !== "Admin" || !adminEmails.has(email)) {
      return sendJson(response, 403, { error: "The AI assistant is admin-only." });
    }
    try {
      const portalData = await getPortalDataForAssistant();
      const answer = await askMistralForPortal({ question, portalData });
      return sendJson(response, 200, { ok: true, answer });
    } catch (error) {
      return sendJson(response, mistralApiKey ? 502 : 503, { error: error.message });
    }
  }

  if (url.pathname === "/api/site/consultation" && request.method === "POST") {
    const payload = await readJsonBody(request);
    try {
      const result = await createWebsiteConsultation(payload);
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

  if (url.pathname === "/api/portal/project-action" && request.method === "POST") {
    const payload = await readJsonBody(request);
    try {
      const result = await saveProjectAction(payload);
      return sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(response, 502, { error: error.message });
    }
  }

  if (url.pathname === "/api/portal/archive-qa-activity" && request.method === "POST") {
    const payload = await readJsonBody(request);
    try {
      const result = await archiveQaActivity(payload);
      return sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(response, 403, { error: error.message });
    }
  }

  return sendJson(response, 404, { error: "Not found" });
}

async function handleStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const hostname = (request.headers["x-forwarded-host"] || request.headers.host || "").toString().split(":")[0].toLowerCase();
  const isJoinHost = hostname === "join.flourishsolar.com" || hostname.startsWith("join.");
  const isPortalHost = hostname === "portal.flourishsolar.com" || hostname.startsWith("portal.");
  const joinPaths = new Set(["/join", "/join/", "/join.html", "/join-flourish-solar.html"]);
  const portalPaths = new Set(["/portal", "/portal/", "/portal.html", "/flourish-rep-portal.html"]);
  const requestedPath = isJoinHost || joinPaths.has(url.pathname)
    ? "/join-flourish-solar.html"
    : isPortalHost || portalPaths.has(url.pathname)
      ? "/flourish-rep-portal-live.html"
      : url.pathname === "/" || url.pathname === "/home" || url.pathname === "/flourish-solar-site.html"
        ? "/flourish-solar-site.html"
      : url.pathname;
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
    if (requestedPath === "/join-flourish-solar.html" || requestedPath === "/flourish-solar-site.html") {
      response.end(html);
      return;
    }
    response.end(html
      .replace("</head>", `${repReadOnlyStageStyle}${hostedPortalConfigScript}</head>`)
      .replace("</body>", `${hostedMagicLinkScript}${hostedRepApprovalScript}${hostedAiAssistantScript}</body>`));
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
