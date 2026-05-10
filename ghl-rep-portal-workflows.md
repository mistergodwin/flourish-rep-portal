# Flourish Rep Portal: GHL Workflow Plan

These workflows are triggered by tags that the portal adds when admin changes a project stage.

## Stage Tags

- `portal-status-new-project`
- `portal-status-design`
- `portal-status-proposal`
- `portal-status-pre-qualification`
- `portal-status-sold`
- `portal-status-ntp`

Important: these workflows are internal only. Do not send customer-facing SMS or email from these stage workflows.

## Workflow 1: Portal - Design Needed

Trigger:
- Contact tag added: `portal-status-design`

Filters:
- Contact tag includes `rep-portal-lead` or `portal-design-form`

Actions:
- Notify admin/design team: new design needed
- Create task for assigned user: Review design request
- Optional: Add internal note with contact name, phone, email, and assigned rep

Draft message:
```text
Design needed for {{contact.full_name}}.
Phone: {{contact.phone}}
Email: {{contact.email}}
Assigned user: {{contact.assigned_user.name}}
```

## Workflow 2: Portal - Proposal

Trigger:
- Contact tag added: `portal-status-proposal`

Filters:
- Contact tag includes `rep-portal-lead` or `portal-design-form`

Actions:
- Create internal follow-up task for assigned rep/admin
- Optional: Notify admin that the proposal stage was reached
- Do not send customer-facing messages

Draft internal note:
```text
Proposal stage reached for {{contact.full_name}}.
Assigned rep/admin should confirm next internal step.
```

## Workflow 3: Portal - Sold

Trigger:
- Contact tag added: `portal-status-sold`

Filters:
- Contact tag includes `rep-portal-lead` or `portal-design-form`

Actions:
- Notify admin/operations
- Create handoff task
- Add tag: `portal-sold-handoff`
- Optional: Move/create opportunity in sold/customer pipeline

Draft message:
```text
Sold project: {{contact.full_name}}.
Start admin/ops handoff and verify project details.
```

## Workflow 4: Portal - NTP

Trigger:
- Contact tag added: `portal-status-ntp`

Filters:
- Contact tag includes `rep-portal-lead` or `portal-design-form`

Actions:
- Notify operations
- Create task: Start NTP checklist
- Optional: Add tag `portal-ntp-started`

Draft message:
```text
NTP reached for {{contact.full_name}}.
Operations can start the NTP checklist.
```

## Safety Rules

- Create workflows as drafts first.
- Test only with portal-created test contacts.
- Do not send customer-facing SMS/email from these workflows.
- Use internal notifications, internal notes, and staff tasks only.
