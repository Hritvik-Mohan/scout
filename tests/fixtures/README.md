# Phase 0 regression fixtures

All records are synthetic and use reserved `example.com` URLs. No record is a
real prospect, contact, message, or call.

- `sample-leads.json`: exactly 10 canonical lead rows.
- `labelled-replies.json`: exactly 30 synthetic reply-class examples.
- `buying-signals.json`: exactly 5 synthetic buying-signal items.
- `historical-transcripts.json`: exactly 3 synthetic discovery transcripts.
- `prompt-regression.json`: versioned prompt snapshot envelope and examples.
- `tracker-reordered.json`: all 44 Pipeline headers in a noncanonical order.

Every file has `schemaVersion: 1`. Change a fixture schema only by adding a new
version and migration note; do not silently reinterpret an existing version.
