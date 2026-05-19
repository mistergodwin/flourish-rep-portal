import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import "./styles.css";

const reps = [
  {
    id: "F7kz2DXoX9xMvyIP3Duj",
    name: "Daniel Godwin",
    email: "dan@flourishsolar.com",
    role: "Rep",
    territory: "Orlando, FL",
    status: "Active",
  },
  {
    id: "admin",
    name: "Daniel Godwin",
    email: "godwin.inc@gmail.com",
    role: "Admin",
    territory: "All markets",
    status: "Owner",
  },
];

const records = [
  {
    id: "jw2NkX7pU5Svc1jaXAOc",
    type: "Lead",
    name: "Test Rep Lead",
    email: "test.rep.lead.20260510@example.com",
    ownerId: "F7kz2DXoX9xMvyIP3Duj",
    stage: "New lead",
    nextStep: "Confirm portal visibility",
    value: "$0",
  },
  {
    id: "homeowner-001",
    type: "Customer",
    name: "Sample Homeowner",
    email: "sample.homeowner@example.com",
    ownerId: "admin",
    stage: "Proposal sent",
    nextStep: "Awaiting admin assignment",
    value: "$18,400",
  },
  {
    id: "install-001",
    type: "Job",
    name: "Mock Solar Install",
    email: "operations@example.com",
    ownerId: "admin",
    stage: "Permitting",
    nextStep: "Upload permit packet",
    value: "$24,900",
  },
];

const notifications = [
  {
    id: "note-1",
    ownerId: "F7kz2DXoX9xMvyIP3Duj",
    title: "New lead assigned",
    body: "Test Rep Lead is ready for review.",
    time: "Today",
  },
  {
    id: "note-2",
    ownerId: "admin",
    title: "Portal test ready",
    body: "Rep visibility passed with one assigned contact.",
    time: "Today",
  },
];

function App() {
  const [session, setSession] = useState(null);
  const [issuedLink, setIssuedLink] = useState("");

  if (!session) {
    return <MagicLinkLogin onLogin={setSession} issuedLink={issuedLink} setIssuedLink={setIssuedLink} />;
  }

  return <Portal session={session} onLogout={() => setSession(null)} />;
}

function MagicLinkLogin({ onLogin, issuedLink, setIssuedLink }) {
  const [email, setEmail] = useState("dan@flourishsolar.com");
  const [sentTo, setSentTo] = useState("");
  const matchedRep = reps.find((rep) => rep.email.toLowerCase() === email.trim().toLowerCase());

  function requestLink(event) {
    event.preventDefault();
    const token = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    setSentTo(email.trim());
    setIssuedLink(`${window.location.origin}/rep-portal?token=${token}`);
  }

  function openMagicLink() {
    if (matchedRep) {
      onLogin(matchedRep);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-row">
          <span className="brand-mark">
            <Sparkles size={22} />
          </span>
          <div>
            <strong>Flourish Solar</strong>
            <span>Rep Portal</span>
          </div>
        </div>

        <div className="login-copy">
          <span className="eyebrow">Secure access</span>
          <h1>Sign in with a magic link</h1>
          <p>Reps enter their email, receive a one-time link, and land on a dashboard filtered to their assigned records.</p>
        </div>

        <form className="login-form" onSubmit={requestLink}>
          <label>
            <span>Email address</span>
            <div className="input-wrap">
              <Mail size={19} />
              <input
                value={email}
                type="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="rep@flourishsolar.com"
                required
              />
            </div>
          </label>
          <button className="primary-action" type="submit">
            <Send size={18} />
            Send magic link
          </button>
        </form>

        {sentTo && (
          <div className="dev-link">
            <CheckCircle2 size={19} />
            <div>
              <strong>Magic link created for {sentTo}</strong>
              <p>For this test build, use the button below. In production this same link gets emailed.</p>
              <button type="button" onClick={openMagicLink} disabled={!matchedRep}>
                <KeyRound size={17} />
                Open magic link
              </button>
              {!matchedRep && <small>No matching rep is registered for that email yet.</small>}
            </div>
          </div>
        )}
      </section>

      <aside className="security-panel">
        <div>
          <ShieldCheck size={28} />
          <h2>What this protects</h2>
          <p>Each session is tied to a rep profile, then every lead, customer, job, and notification is filtered by owner.</p>
        </div>
        <div className="security-steps">
          <span>1. Email entered</span>
          <ChevronRight size={17} />
          <span>2. One-time link sent</span>
          <ChevronRight size={17} />
          <span>3. Rep-only dashboard</span>
        </div>
      </aside>
    </main>
  );
}

function Portal({ session, onLogout }) {
  const isAdmin = session.role === "Admin";
  const visibleRecords = useMemo(
    () => (isAdmin ? records : records.filter((record) => record.ownerId === session.id)),
    [isAdmin, session.id],
  );
  const visibleNotes = useMemo(
    () => (isAdmin ? notifications : notifications.filter((note) => note.ownerId === session.id)),
    [isAdmin, session.id],
  );

  return (
    <main className="portal-shell">
      <aside className="portal-sidebar">
        <div className="brand-row compact">
          <span className="brand-mark">
            <Sparkles size={20} />
          </span>
          <div>
            <strong>Flourish</strong>
            <span>Solar CRM</span>
          </div>
        </div>
        <nav>
          <button className="active" aria-label="Dashboard">
            <LayoutDashboard size={19} />
          </button>
          <button aria-label="Profile">
            <UserRound size={19} />
          </button>
          <button aria-label="Customers">
            <UsersRound size={19} />
          </button>
          <button aria-label="Jobs">
            <BriefcaseBusiness size={19} />
          </button>
          <button aria-label="Notifications">
            <Bell size={19} />
          </button>
          {isAdmin && (
            <button aria-label="Admin">
              <ShieldCheck size={19} />
            </button>
          )}
        </nav>
        <button className="logout" onClick={onLogout}>
          <LogOut size={18} />
        </button>
      </aside>

      <section className="portal-workspace">
        <header className="portal-header">
          <div>
            <span className="eyebrow">{isAdmin ? "Admin access" : "Rep access"}</span>
            <h1>{isAdmin ? "All records dashboard" : "My assigned work"}</h1>
          </div>
          <div className="user-chip">
            <span>{session.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{session.name}</strong>
              <small>{session.email}</small>
            </div>
          </div>
        </header>

        <section className="metric-strip">
          <Metric icon={ClipboardList} label="Visible records" value={visibleRecords.length} />
          <Metric icon={UsersRound} label="Reps" value={isAdmin ? reps.length - 1 : 1} />
          <Metric icon={Bell} label="Notifications" value={visibleNotes.length} />
          <Metric icon={LockKeyhole} label="Access mode" value={isAdmin ? "All" : "Assigned"} />
        </section>

        <div className="content-grid">
          <section className="records-section">
            <div className="section-title">
              <div>
                <h2>{isAdmin ? "All leads, customers, and jobs" : "My leads, customers, and jobs"}</h2>
                <p>{isAdmin ? "Admin can inspect every record and assignment." : "Rep view only shows records assigned to this login."}</p>
              </div>
            </div>
            <div className="record-list">
              {visibleRecords.map((record) => (
                <article className="record-row" key={record.id}>
                  <span className={`record-type ${record.type.toLowerCase()}`}>{record.type}</span>
                  <div>
                    <h3>{record.name}</h3>
                    <p>{record.email}</p>
                  </div>
                  <div>
                    <strong>{record.stage}</strong>
                    <span>{record.nextStep}</span>
                  </div>
                  <strong>{record.value}</strong>
                </article>
              ))}
            </div>
          </section>

          <aside className="right-rail">
            <section>
              <h2>Profile</h2>
              <dl>
                <div>
                  <dt>Role</dt>
                  <dd>{session.role}</dd>
                </div>
                <div>
                  <dt>Territory</dt>
                  <dd>{session.territory}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{session.status}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h2>Notifications</h2>
              <div className="note-list">
                {visibleNotes.map((note) => (
                  <article key={note.id}>
                    <Bell size={17} />
                    <div>
                      <strong>{note.title}</strong>
                      <p>{note.body}</p>
                      <small>{note.time}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {isAdmin && (
              <section>
                <h2>Rep Access</h2>
                <div className="rep-list">
                  {reps
                    .filter((rep) => rep.role === "Rep")
                    .map((rep) => (
                      <article key={rep.id}>
                        <Building2 size={17} />
                        <div>
                          <strong>{rep.name}</strong>
                          <p>{rep.email}</p>
                        </div>
                        <span>{records.filter((record) => record.ownerId === rep.id).length}</span>
                      </article>
                    ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <article className="metric">
      <Icon size={20} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
