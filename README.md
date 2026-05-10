# Flourish Solar Rep Portal

Custom rep/admin portal for Flourish Solar.

## What Works Now

- Magic-link style login test flow
- Rep-only dashboard filtering
- Admin dashboard with all records
- First-login rep profile completion
- Admin can mark rep profiles complete or reset them
- Admin launch checklist
- Live data adapter that falls back to sample data until HighLevel access is connected
- Portal design form creates contacts in HighLevel
- Portal contact edits update HighLevel, then refresh back into the portal
- Admin lead stage changes update HighLevel tags, then refresh back into the portal. Reps can view stages but cannot change them.
- Admin stage tabs filter records by New Project, Design, Proposal, Pre-Qualification, Sold, and NTP. Reps do not see these admin filters.
- Admin workflow checklist shows the draft GHL automations needed for stage tags.

## Local Preview

Run the portal server:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4177/flourish-rep-portal.html
```

For hosted deployment, set `HOST=0.0.0.0` in the web host environment.

## Recommended Hosting

Use Render as a Node web service. This repo includes `render.yaml`, which sets:

- Node production service
- `node server.mjs` as the start command
- no build step, because the portal is served by the Node server directly
- `/api/health` as the health check
- a small persistent disk mounted at `data/` for portal profile completion, pinned portal-created contacts, stage activity, and local status cache
- private environment variable placeholder for `GHL_PRIVATE_INTEGRATION_TOKEN`

Before going live:

1. Push this project to GitHub.
2. Create a Render Blueprint from the repo.
3. Add the private integration token in Render, not in the code.
4. Rotate the HighLevel private integration token that was used during local setup.
5. Connect a custom domain such as `portal.flourishsolar.com`.
6. Test admin login, rep login, contact create, contact edit, and admin stage changes.

## HighLevel Connection

Copy `.env.local.example` to `.env.local` and fill in:

```bash
GHL_LOCATION_ID=YfwlbtO6dLJ7ho2JKvzI
GHL_PRIVATE_INTEGRATION_TOKEN=your_private_integration_token
ADMIN_EMAILS=godwin.inc@gmail.com
PORT=4177
NODE_ENV=development
```

The token must stay on the server. Do not paste it into `flourish-rep-portal.html`.

When `GHL_PRIVATE_INTEGRATION_TOKEN` is present and the HighLevel scopes are correct, `/api/portal/bootstrap` will return live reps, contacts, and opportunities. Until then, the portal shows sample records and the admin launch checklist displays `Sample`.

Rep onboarding completion and admin checkoffs are saved through:

```text
POST /api/portal/profile-completion
```

In this local build that data is stored in `data/profile-completions.json`. In the live build, the same save point can be connected to HighLevel custom fields.

Portal lead intake and contact updates use:

```text
POST /api/portal/design-contact
PUT /api/portal/contact
PUT /api/portal/contact-status
```

Both routes write to HighLevel first. The portal then reloads live data so reps and admin see the CRM-backed version.

Lead stages are saved as HighLevel tags like `portal-status-design`, `portal-status-proposal`, `portal-status-sold`, and `portal-status-ntp`, which can later trigger internal GHL workflows. Only admin can change these stages from the portal.

Workflow setup details are in `ghl-rep-portal-workflows.md`. These are internal workflows for admin and sales reps only, not customer-facing communication.

## Needed HighLevel Scopes

- Users read
- Contacts read
- Opportunities read
- Contacts/custom fields update, for saving rep profile completion

## Next Build Step

After the HighLevel token is added, test:

1. Admin login sees live records.
2. Daniel login sees only records assigned to `F7kz2DXoX9xMvyIP3Duj`.
3. Rep profile completion saves back into HighLevel custom fields.
4. HighLevel workflows send new-lead notifications.
