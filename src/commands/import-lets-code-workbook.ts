import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import {
  LETS_CODE_WORKBOOK_URL,
  collectLetsCodeIntel,
  fetchLetsCodeSheets,
  normalizeCompanyName,
} from "../jobs/lets-code-workbook.js";

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID;
if (spreadsheetId === undefined || spreadsheetId.trim() === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}

const text = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
};

const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});

const sheets = await fetchLetsCodeSheets();
const intel = collectLetsCodeIntel(sheets);
const existingCompanies = (
  await transport.getValues("'Companies'!A2:X2000")
).map((row) => {
  const copy = [...row];
  while (copy.length < 24) copy.push("");
  return copy;
});
const companyIndex = new Map(
  existingCompanies.flatMap((row, index) => {
    const key = normalizeCompanyName(text(row[1]));
    return key === "" ? [] : ([[key, index]] as const);
  }),
);
const companyUpdates: {
  range: string;
  values: readonly (readonly unknown[])[];
}[] = [];
let companiesUpdated = 0;
let companiesAdded = 0;

for (const company of intel.companies) {
  const key = normalizeCompanyName(company.name);
  const index = companyIndex.get(key);
  const sourceNote = [
    "Imported from the Lets Code Bangalore Job Seekers Kit.",
    ...company.notes,
    company.recruitingEmail === ""
      ? ""
      : "Recruiting email is source-provided and must be verified before outreach.",
  ]
    .filter(Boolean)
    .join(" ");
  if (index !== undefined) {
    const row = existingCompanies[index];
    if (row === undefined) {
      throw new Error(`Missing Companies row for ${company.name}`);
    }
    if (text(row[4]) === "") row[4] = company.sector;
    if (text(row[5]) === "") row[5] = company.area;
    if (text(row[6]) === "") row[6] = company.area;
    if (text(row[8]) === "") row[8] = company.careersPage;
    if (text(row[11]) === "") row[11] = company.linkedIn;
    if (text(row[15]) === "") row[15] = company.recruitingEmail;
    if (text(row[19]) === "")
      row[19] = "Employer listed in Lets Code job-seeker kit";
    if (text(row[20]) === "") row[20] = company.roles;
    const existingNotes = text(row[23]);
    if (!existingNotes.includes("Lets Code Bangalore Job Seekers Kit")) {
      row[23] = [existingNotes, sourceNote].filter(Boolean).join("\n");
    }
    companyUpdates.push({
      range: `'Companies'!E${String(index + 2)}:X${String(index + 2)}`,
      values: [row.slice(4, 24)],
    });
    companiesUpdated += 1;
    continue;
  }

  const rowNumber = existingCompanies.length + companiesAdded + 2;
  const row = [
    `lets-code:${key}`,
    company.name,
    "Employer directory",
    "",
    company.sector,
    company.area,
    company.area,
    "",
    company.careersPage,
    "",
    "",
    company.linkedIn,
    "",
    "",
    "",
    company.recruitingEmail,
    "",
    "",
    "",
    "Employer listed in Lets Code job-seeker kit",
    company.roles,
    LETS_CODE_WORKBOOK_URL,
    "",
    sourceNote,
  ];
  companyUpdates.push({
    range: `'Companies'!A${String(rowNumber)}:X${String(rowNumber)}`,
    values: [row],
  });
  companyIndex.set(key, rowNumber - 2);
  companiesAdded += 1;
}

if (existingCompanies.length + companiesAdded > 1999) {
  throw new Error("Companies sheet capacity exceeded during workbook import");
}
await transport.batchUpdateValues(companyUpdates);

const sourceRows = await transport.getValues("'Sources'!A2:H300");
if (!sourceRows.some((row) => text(row[0]) === "lets-code-workbook")) {
  const firstEmpty = sourceRows.findIndex((row) => text(row[0]).trim() === "");
  const rowNumber = 2 + (firstEmpty === -1 ? sourceRows.length : firstEmpty);
  await transport.batchUpdateValues([
    {
      range: `'Sources'!A${String(rowNumber)}:H${String(rowNumber + 1)}`,
      values: [
        [
          "lets-code-workbook",
          "Bangalore Job Seekers Kit - Lets Code",
          "reference_workbook",
          LETS_CODE_WORKBOOK_URL,
          "Bengaluru + Remote",
          false,
          new Date().toISOString(),
          "Imported company, contact, remote-work, compensation, job-reference, and preparation-resource intelligence. Source-provided claims require verification.",
        ],
        [
          "lets-code-jobs",
          "Lets Code Jobs",
          "manual_alert",
          "https://www.lets-code.co.in/jobs/",
          "India + Remote",
          false,
          "",
          "Manual source discovered in the shared workbook; verify freshness before applying.",
        ],
      ],
    },
  ]);
}

interface SheetMetadata {
  sheets?: { properties?: { sheetId?: number; title?: string } }[];
}
let metadata = await transport.getSpreadsheet<SheetMetadata>(
  "sheets(properties(sheetId,title))",
);
const requiredTabs = ["Reference Jobs", "Resources"] as const;
const existingTitles = new Set(
  (metadata.sheets ?? []).map((sheet) => sheet.properties?.title ?? ""),
);
const missing = requiredTabs.filter((title) => !existingTitles.has(title));
if (missing.length > 0) {
  await transport.batchUpdateSpreadsheet(
    missing.map((title) => ({ addSheet: { properties: { title } } })),
  );
  metadata = await transport.getSpreadsheet<SheetMetadata>(
    "sheets(properties(sheetId,title))",
  );
}

const idFor = (title: string): number => {
  const id = metadata.sheets?.find((sheet) => sheet.properties?.title === title)
    ?.properties?.sheetId;
  if (id === undefined) throw new Error(`Missing sheet id for ${title}`);
  return id;
};

const importedAt = new Date().toISOString();
await transport.batchUpdateValues([
  {
    range: `'Reference Jobs'!A1:H${String(intel.jobs.length + 1)}`,
    values: [
      [
        "Company",
        "Role",
        "Eligible Batches",
        "Location",
        "URL",
        "Imported",
        "Verification Status",
        "Source",
      ],
      ...intel.jobs.map((job) => [
        job.company,
        job.role,
        job.batches,
        job.location,
        job.url,
        importedAt,
        "Unverified - confirm opening is active before applying",
        LETS_CODE_WORKBOOK_URL,
      ]),
    ],
  },
  {
    range: `'Resources'!A1:E${String(intel.resources.length + 1)}`,
    values: [
      ["Category", "Resource", "URL", "Imported", "Source"],
      ...intel.resources.map((resource) => [
        resource.category,
        resource.title,
        resource.url,
        importedAt,
        LETS_CODE_WORKBOOK_URL,
      ]),
    ],
  },
]);

const styleRequests = requiredTabs.flatMap((title) => {
  const sheetId = idFor(title);
  const columnCount = title === "Reference Jobs" ? 8 : 5;
  return [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.11, green: 0.29, blue: 0.49 },
            textFormat: {
              bold: true,
              foregroundColor: { red: 1, green: 1, blue: 1 },
            },
            verticalAlignment: "MIDDLE",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    },
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: columnCount,
        },
      },
    },
    {
      setBasicFilter: {
        filter: {
          range: { sheetId, startRowIndex: 0, endColumnIndex: columnCount },
        },
      },
    },
  ];
});
await transport.batchUpdateSpreadsheet(styleRequests);

const [verifiedJobs, verifiedResources] = await Promise.all([
  transport.getValues("'Reference Jobs'!A2:H500"),
  transport.getValues("'Resources'!A2:E500"),
]);

console.log(
  JSON.stringify(
    {
      companiesDiscovered: intel.companies.length,
      companiesUpdated,
      companiesAdded,
      referenceJobs: verifiedJobs.filter((row) => text(row[0]) !== "").length,
      resources: verifiedResources.filter((row) => text(row[2]) !== "").length,
      target: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    },
    null,
    2,
  ),
);
