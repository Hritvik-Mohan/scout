import { GoogleAuthAccessTokenProvider } from "../integrations/google-auth.js";
import { GoogleSheetsRestTransport } from "../integrations/google-sheets.js";
import { discoverBangaloreStartupCompanies } from "../jobs/bangalore-startup-map.js";
import { enrichCompanyWebsite } from "../jobs/company-enrichment.js";
import { CompanySheetRepository } from "../jobs/company-sheet.js";

const positiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("SCOUT_COMPANY_ENRICH_LIMIT must be a positive integer");
  }
  return parsed;
};

const spreadsheetId = process.env.SCOUT_JOB_SHEET_ID?.trim();
if (spreadsheetId === undefined || spreadsheetId === "") {
  throw new Error("SCOUT_JOB_SHEET_ID is required");
}
const enrichLimit = positiveInteger(process.env.SCOUT_COMPANY_ENRICH_LIMIT, 25);
const transport = new GoogleSheetsRestTransport({
  spreadsheetId,
  tokenProvider: new GoogleAuthAccessTokenProvider(),
});
const repository = new CompanySheetRepository(transport);
const companies = await discoverBangaloreStartupCompanies();
const synced = await repository.syncBaseCompanies(companies);
const targets = await repository.companiesNeedingEnrichment(enrichLimit);
const failures: string[] = [];
let enriched = 0;
for (const target of targets) {
  try {
    const enrichment = await enrichCompanyWebsite(target.website);
    await repository.writeEnrichment(target.rowNumber, enrichment);
    enriched += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${target.name}: ${message}`);
    await repository.writeEnrichment(target.rowNumber, {
      careersPage: "",
      jobBoard: "",
      contactPage: "",
      linkedin: "",
      twitter: "",
      github: "",
      otherSocials: "",
      recruitingEmail: "",
      otherEmails: "",
      lastEnriched: new Date().toISOString(),
      notes: `Public website scan failed: ${message}`,
    });
  }
}
const sourceRows = await transport.getValues("'Sources'!A2:H200");
const sourceIndex = sourceRows.findIndex(
  (row) => row[0] === "bangalore-startup-map",
);
if (sourceIndex >= 0) {
  await transport.batchUpdateValues([
    {
      range: `'Sources'!G${String(sourceIndex + 2)}:G${String(sourceIndex + 2)}`,
      values: [[new Date().toISOString()]],
    },
  ]);
}
process.stdout.write(
  `${JSON.stringify({ discovered: companies.length, synced, enrichmentAttempted: targets.length, enriched, failures }, null, 2)}\n`,
);
