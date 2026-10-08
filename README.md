# Scout

Scout is a private, configurable opportunity-discovery engine. Give it a profile
describing what you want, then use the same evidence and scoring pipeline to
assess:

- sales leads;
- freelance projects;
- jobs; or
- another opportunity type you define.

The profile is the source of truth. It contains the target, geographic priority,
fit criteria, buying or hiring signals, disqualifiers, score thresholds, and
output fields. The engine does not send messages, submit applications, or mutate
external systems by default.

## Quick start

```bash
npm ci
npm run build
npm run profile:validate -- profiles/freelance.json
npm run profile:score -- profiles/freelance.json examples/freelance-opportunity.json
```

Three starter profiles live in [`profiles/`](profiles):

- `sales-leads.json` — find companies matching a service ICP;
- `freelance.json` — find well-scoped paid projects;
- `jobs.json` — find roles matching a candidate's goals.

Copy one, change its criteria and signals, and validate it before use. See
[`docs/profile-format.md`](docs/profile-format.md) for the format and scoring
rules.

## What is reusable

The profile loader, evidence rules, scoring engine, discovery adapters,
deduplication, review gates, Google Sheets integration, and runtime safeguards
are reusable. Some original NST Studio workflow adapters remain in the
repository as migration references; they are not the default Scout interface and
will be converted profile-by-profile.

## Safety

- Evidence-required rules receive no credit without a source URL.
- Hard disqualifiers reject an opportunity.
- Missing required criteria reject an opportunity.
- Geographic priority sorts results but does not inflate fit.
- External actions remain disabled unless a future workflow explicitly enables
  them.
- Secrets, service-account JSON, live spreadsheet IDs, and evaluation data must
  stay outside Git.
