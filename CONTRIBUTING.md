# Contributing to Scout

Thanks for wanting to improve Scout. This guide covers how to set up, what makes
a good change, and the rules a change must keep.

## Ways to contribute

- **Report a bug** or **suggest a feature** with an
  [issue](https://github.com/Hritvik-Mohan/scout/issues/new/choose).
- **Add a job-board adapter.** Scout polls Greenhouse, Lever, Ashby,
  SmartRecruiters, and Remotive. Workday, Keka, Darwinbox, and Zoho Recruit are
  common and not yet supported.
- **Improve matching.** The keyword assessor in `src/jobs/assess.ts` is simple
  on purpose; better experience parsing and fewer false keeps are welcome.
- **Improve the docs**, especially where the setup guide was unclear to you.

For anything larger than a small fix, open an issue first so the approach can be
agreed before you write it.

## Set up

You need Node.js 22.9 or newer.

```bash
git clone https://github.com/<you>/scout.git
cd scout
npm ci
npm run check
```

`npm run check` runs formatting, lint, type checks, tests, and the build. It
needs no Google account, sheet, or credentials: the tests use fake transports
and fictional data. If it passes on a fresh clone, you are ready.

To run the pipeline against a real sheet, follow the README's manual setup with
a sheet of your own.

## Where things are

| Path                 | What it holds                                             |
| -------------------- | --------------------------------------------------------- |
| `src/jobs/`          | Board adapters, the assessor, sheet repositories, reviews |
| `src/commands/`      | One file per `npm run jobs:*` command                     |
| `src/profiles/`      | The scoring engine and profile schema                     |
| `src/integrations/`  | Google auth and the Sheets transport                      |
| `tests/`             | Vitest tests, one area per file                           |
| `examples/john-doe/` | A fictional search used in docs and tests                 |
| `docs/`              | The ICP template, profile format, and README images       |

## Rules a change must keep

These are what make Scout safe to run unattended. A change that breaks one will
not be merged.

1. **Scout never acts for the user.** It must not submit applications, send
   messages, or contact anyone. It prepares drafts; a person sends them.
2. **No invented contacts.** Record only publicly published contact details,
   with the source URL. Never guess an email address or a name.
3. **Human columns are untouched.** Job Pipeline columns R:V (Applied,
   Application Date, Stage, Next Action, Notes) belong to the user. Code may
   read them and must never write them, except to clear a whole row being
   removed.
4. **Public feeds only.** Use documented public endpoints. Do not log in, evade
   bot protection, or fetch paths a site's `robots.txt` excludes.
5. **No personal data in the repository.** Never commit `my-search/`, `.env`,
   service-account keys, sheet IDs, or a real person's resume or job search.
   Tests and examples use fictional people and companies.
6. **Roles are identified by a stable ID** (`<provider>:<board>:<id>`), so a
   refresh updates a row instead of duplicating it.

## Making a change

1. Fork the repository and branch from `main`. Name the branch for the change,
   for example `feat/workday-adapter` or `fix/experience-range-parsing`.
2. Make the change with a test. Match the style of the surrounding code.
3. Run `npm run check` and fix what it reports. `npm run format` fixes
   formatting.
4. Commit using a conventional prefix:

   | Prefix   | Use for                             |
   | -------- | ----------------------------------- |
   | `feat:`  | A new capability                    |
   | `fix:`   | A bug fix                           |
   | `docs:`  | Documentation only                  |
   | `test:`  | Tests only                          |
   | `chore:` | Tooling, dependencies, housekeeping |

   Add `!` for a breaking change, as in `feat!:`, and explain it in the body.

5. Open a pull request against `main` and fill in the template. The `quality`
   check must pass before it can be merged.

### What counts as breaking

A change is breaking when someone already using Scout must do something to keep
it working:

- adding, moving, or renaming a sheet column or tab;
- changing the shape of `my-search/job-search.json` or `my-search/jobs.json`;
- renaming an environment variable or an `npm run` command;
- changing a role's stable ID format.

Say so in the pull request and include the steps a user must take. Prefer an
additive change where one is possible.

### Adding a job-board adapter

1. Implement `JobDiscoveryAdapter` in `src/jobs/<provider>.ts`, validating the
   response with a zod schema. Accept `null` for optional fields; real feeds
   send it.
2. Register the type in `parseConfiguredJobSources` and
   `createJobDiscoveryAdapter` in `src/jobs/sources.ts`.
3. If the feed lists every open role, add it to `completeFeedIdPrefix` so closed
   postings are detected. If it returns one page or a rolling window, leave it
   out.
4. Add tests in `tests/job-scout.test.ts` using a mocked `fetch`. Do not call
   the live service from tests.
5. Add the type and its URL format to the sources table in the README.

## Reporting a bug

Use the bug report template. Include the command you ran, what you expected,
what happened, the Scout version (`npm pkg get version`), and your Node.js
version. Paste the error output, but first remove anything private: sheet IDs,
key contents, email addresses, and your own profile.

## Security

Do not open a public issue for a leaked credential or a security problem. Follow
[SECURITY.md](SECURITY.md).

## Releases

The maintainer publishes releases; the steps are in the README under "Publish a
release". Contributors do not need to change the version number.

## License

By contributing, you agree that your contribution is licensed under the
project's [MIT license](LICENSE).
