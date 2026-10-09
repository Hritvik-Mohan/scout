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
npm run profile:validate -- profiles/jobs.json
npm run profile:score -- profiles/jobs.json examples/job-opportunity.json
```

Three starter profiles live in [`profiles/`](profiles):

- `sales-leads.json` — find companies matching a service ICP;
- `freelance.json` — find well-scoped paid projects;
- `jobs.json` — find SDE 1 and SDE 2 roles in India and the global remote
  market, tailored to Hritvik's backend and distributed-systems experience.

The job example is deliberately fictional. It documents the evidence shape and
expected score for an ideal global-remote SDE 2 opportunity; it is not a live
job lead.

## Create the job-search workbook

Keep the service-account JSON outside the repository and point
`GOOGLE_APPLICATION_CREDENTIALS` at its absolute path in `.env`. Set
`SCOUT_SHEET_SHARE_EMAIL` to the Google account that should receive editor
access, then run:

```bash
npm run jobs:sheet:create
```

This creates and verifies a native Google Sheets workbook with `Job Pipeline`,
`Sources`, `Runs`, `Profile`, and `Companies` tabs. The source registry includes
automated feeds plus alert/import/research channels, while application state
remains ready for subsequent Scout updates. The Google Sheets API and Google
Drive API must both be enabled for the service-account project.

If Google prevents the service account from owning new Drive files, create a
blank Sheet in the personal account, share it with the service account as an
editor, set `SCOUT_JOB_SHEET_ID`, and run:

```bash
npm run jobs:sheet:init
```

This initializes and verifies the same four tabs while keeping the workbook
owned by the personal account. Subsequent Scout reads and updates continue to
use the service-account credentials.

## Discover and score remote jobs

Search all currently automated sources again and update the live pipeline with:

```bash
npm run jobs:update
```

`jobs:run` remains available as the underlying command; `jobs:update` is the
human-friendly manual trigger. Run it whenever you want an immediate refresh.

It reads the active `remotive`, `greenhouse`, `lever`, `smartrecruiters`, and
`ashby` rows from the `Sources` tab, queries their public job feeds, assesses
each listing against `profiles/jobs.json`, and writes only `keep` or `action`
roles. Existing opportunities are updated by provider-scoped stable ID while the
human-maintained application fields remain untouched. One failed company feed
produces a partial run instead of losing results from the other sources. Each
successful source receives a `Last Checked` timestamp, and every run is recorded
in the `Runs` tab.

Verified, current software roles that match the configured SDE/SDE 1/SDE 2,
backend, platform, infrastructure, or related criteria belong in `Job Pipeline`.
Potentially useful roles whose freshness or India eligibility is not yet proven
belong in `Reference Jobs` with an explicit verification status. This keeps the
application queue actionable without discarding research leads.

Copy one, change its criteria and signals, and validate it before use. See
[`docs/profile-format.md`](docs/profile-format.md) for the format and scoring
rules.

## Rank the pipeline and draft applications

The keyword score only decides what is kept. Ranking comes from a review of each
kept posting against [`docs/job-search-icp.md`](docs/job-search-icp.md):

```bash
npm run jobs:review:pending                    # export unreviewed roles
npm run jobs:review:apply -- <reviews.json>   # write reviews to the Sheet
npm run jobs:digest                            # print what to apply to next
```

`jobs:update` caches kept postings in `.local/job-cache.json`.
`jobs:review:pending` writes the roles that still need a review, with their
descriptions, to `.local/job-reviews/pending.json`. A reviewer (a person or an
AI session) reads them and produces a JSON array matching `jobReviewSchema` in
[`src/jobs/review.ts`](src/jobs/review.ts): a 0-100 fit, a verdict, up to three
reasons and gaps, resume evidence to lead with, and an outreach draft.

`jobs:review:apply` writes `Fit`, `Verdict`, `Fit Summary`, and `Reviewed` to
Job Pipeline columns X:AA and the drafts to the `Application Kit` tab. Drafts
are never sent. `jobs:digest` lists the top open roles by fit and postings old
enough to need a freshness check.

## Discover and enrich Bengaluru companies

Run:

```bash
npm run jobs:companies
```

Scout reads the company directory embedded in the public Bangalore Startup Map
homepage (without calling its robots-excluded API), synchronizes all companies
into the `Companies` tab, and enriches a bounded batch of official websites.
Enrichment records careers/contact pages, ATS links, company social profiles,
and only publicly published email addresses; it never guesses an address.
`SCOUT_COMPANY_ENRICH_LIMIT` controls the resumable per-run batch size. Job
pipeline rows reuse matching company contact and referral paths when available.

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
