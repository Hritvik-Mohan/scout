import { resolve } from "node:path";

import { loadScoutProfile } from "../profiles/loader.js";

const path = process.argv[2];
if (path === undefined) {
  throw new Error("Usage: npm run profile:validate -- <profile.json>");
}

const profile = await loadScoutProfile(resolve(path));
process.stdout.write(
  `${JSON.stringify({ valid: true, id: profile.id, purpose: profile.purpose }, null, 2)}\n`,
);
