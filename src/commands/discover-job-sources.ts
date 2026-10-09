import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import {
  detectCompanyBoards,
  type DetectedBoard,
} from "../jobs/board-detection.js";
import { loadScoutProfile } from "../profiles/loader.js";

interface ProbeRecord {
  probedAt: string;
  boards: readonly DetectedBoard[];
}

const positiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("SCOUT_BOARD_PROBE_LIMIT must be a positive integer");
  }
  return parsed;
};

const cell = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const probeLimit = positiveInteger(process.env.SCOUT_BOARD_PROBE_LIMIT, 150);
const concurrency = 6;
const profile = await loadScoutProfile(
  resolve(process.env.SCOUT_PROFILE_PATH ?? "profiles/jobs.json"),
);
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const cachePath = resolve(".local/board-probe.json");
const cache = new Map<string, ProbeRecord>(
  Object.entries(
    await readFile(cachePath, "utf8")
      .then((body) => JSON.parse(body) as Record<string, ProbeRecord>)
      .catch(() => ({})),
  ),
);

const companyRows = await transport.getValues("'Companies'!B2:J2000");
const sourceRows = await transport.getValues("'Sources'!A2:H1000");
const knownUrls = new Set(sourceRows.map((row) => cell(row[3])));
const knownIds = new Set(sourceRows.map((row) => cell(row[0])));
const companies = companyRows.flatMap((row, index) => {
  const name = cell(row[0]);
  return name === ""
    ? []
    : [{ name, rowNumber: index + 2, board: cell(row[8]) }];
});
const targets = companies
  .filter((company) => !cache.has(company.name.toLowerCase()))
  .slice(0, probeLimit);

const now = new Date();
const request = {
  startAt: new Date(now.valueOf() - 336 * 60 * 60 * 1000),
  endAt: now,
  maxResults: 100,
};
let cursor = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (;;) {
      const target = targets[cursor];
      cursor += 1;
      if (target === undefined) return;
      cache.set(target.name.toLowerCase(), {
        probedAt: now.toISOString(),
        boards: await detectCompanyBoards(target.name, profile, request),
      });
    }
  }),
);
await mkdir(dirname(cachePath), { recursive: true });
await writeFile(
  cachePath,
  `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`,
);

let lastUsed = 0;
sourceRows.forEach((row, index) => {
  if (cell(row[0]) !== "") lastUsed = index + 1;
});
const newSources: unknown[][] = [];
const companyUpdates: { range: string; values: unknown[][] }[] = [];
const added: string[] = [];
for (const company of companies) {
  const record = cache.get(company.name.toLowerCase());
  for (const board of record?.boards ?? []) {
    const id = `${board.type}-${board.slug}`;
    if (knownUrls.has(board.url) || knownIds.has(id)) continue;
    knownUrls.add(board.url);
    knownIds.add(id);
    newSources.push([
      id,
      company.name,
      board.type,
      board.url,
      "Bengaluru + Remote (India-compatible)",
      true,
      "",
      `Auto-detected from the Companies tab on ${now.toISOString().slice(0, 10)} with ${String(board.keptRoles)} matching role(s). Board identifier was inferred from the company name; confirm it is the right employer.`,
    ]);
    added.push(`${company.name} (${board.type})`);
    if (company.board === "") {
      companyUpdates.push({
        range: `'Companies'!J${String(company.rowNumber)}:J${String(company.rowNumber)}`,
        values: [[board.url]],
      });
      company.board = board.url;
    }
  }
}
if (newSources.length > 0) {
  const firstRow = lastUsed + 2;
  const lastRow = firstRow + newSources.length - 1;
  if (lastRow > 1000) throw new Error("Sources sheet capacity exceeded");
  interface Metadata {
    sheets?: {
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number };
      };
    }[];
  }
  const metadata = await transport.getSpreadsheet<Metadata>(
    "sheets(properties(sheetId,title,gridProperties(rowCount)))",
  );
  const sources = metadata.sheets?.find(
    (sheet) => sheet.properties?.title === "Sources",
  )?.properties;
  const rowCount = sources?.gridProperties?.rowCount ?? 0;
  if (sources?.sheetId !== undefined && rowCount < lastRow) {
    await transport.batchUpdateSpreadsheet([
      {
        appendDimension: {
          sheetId: sources.sheetId,
          dimension: "ROWS",
          length: lastRow - rowCount,
        },
      },
    ]);
  }
  await transport.batchUpdateValues([
    {
      range: `'Sources'!A${String(firstRow)}:H${String(lastRow)}`,
      values: newSources,
    },
    ...companyUpdates,
  ]);
}
process.stdout.write(
  `${JSON.stringify({ companies: companies.length, probedThisRun: targets.length, remaining: companies.filter((company) => !cache.has(company.name.toLowerCase())).length, sourcesAdded: added.length, added }, null, 2)}\n`,
);
