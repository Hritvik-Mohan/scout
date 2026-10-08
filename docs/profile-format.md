# Scout profile format

A Scout profile is a versioned JSON file that describes one search objective. It
separates the reusable discovery and scoring machinery from a specific company,
client type, or career goal.

## Sections

- `purpose`: the workflow category, such as `sales_leads`, `freelance`, or
  `jobs`.
- `targetEntity`: a plain-language definition of what Scout should find.
- `geographyPriority`: preferred ordering. It never adds fit points.
- `criteria`: durable fit requirements.
- `signals`: time-sensitive evidence that an opportunity is active now.
- `disqualifiers`: conditions that make an opportunity unsuitable.
- `thresholds`: the normalized 1–5 score needed to keep or act on a result.
- `outputFields`: the fields a future destination adapter should produce.

Each criterion and signal has a weight. A matched rule earns its weight only
when it has at least one source URL if `evidenceRequired` is true. Required
criteria must be positively proven. A missing or unsupported required criterion
rejects the opportunity, as does any active hard disqualifier.

## Score

Scout normalizes earned weight to a 1–5 score:

```text
score = 1 + 4 × (earned weight ÷ possible weight)
```

The score is rounded to two decimal places. A rejected result receives score 1
regardless of its other matches. `geographyRank` is returned separately so a
runner can prefer India before international results without corrupting fit
quality.

## Evidence assessment

The scorer consumes a second JSON file containing the opportunity, its
geography, rule-by-rule findings, rationales, source URLs, and any disqualifier
IDs. This boundary allows a human, Codex, another LLM, or a deterministic parser
to research the opportunity. The deterministic engine remains responsible for
validation and the final score.

Validate and score with:

```bash
npm run build
npm run profile:validate -- profiles/freelance.json
npm run profile:score -- profiles/freelance.json examples/freelance-opportunity.json
```
