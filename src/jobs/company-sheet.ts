import type { GoogleSheetsTransport } from "../integrations/google-sheets.js";
import type { BangaloreStartupCompany } from "./bangalore-startup-map.js";
import type { CompanyEnrichment } from "./company-enrichment.js";
import { normalizeCompanyName } from "./lets-code-workbook.js";

const text = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
};

const blankRow = (): unknown[] => Array.from({ length: 24 }, () => "");

export class CompanySheetRepository {
  constructor(private readonly transport: GoogleSheetsTransport) {}

  async syncBaseCompanies(
    companies: readonly BangaloreStartupCompany[],
  ): Promise<number> {
    const existing = await this.transport.getValues("'Companies'!A2:X2000");
    const byId = new Map(existing.map((row) => [text(row[0]), [...row]]));
    const baseRows = [...companies]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((company) => {
        const row = byId.get(company.id) ?? blankRow();
        while (row.length < 24) row.push("");
        row.splice(
          0,
          8,
          company.id,
          company.name,
          company.kind,
          company.stage,
          company.sector,
          company.area,
          company.localAddress,
          company.website,
        );
        row.splice(
          17,
          5,
          company.founders,
          company.founderProfiles,
          company.hiringSignal,
          company.openRolesHint,
          company.sourceUrl,
        );
        const existingNotes = text(row[23]);
        const scanNotes = existingNotes
          .split("\n")
          .filter((line) => line.startsWith("Public website scan"));
        row[23] = [company.notes, ...scanNotes].filter(Boolean).join("\n");
        return row;
      });
    const baseNames = new Set(
      baseRows.map((row) => normalizeCompanyName(text(row[1]))),
    );
    const importedRows = existing
      .filter((row) => text(row[0]).startsWith("lets-code:"))
      .filter((row) => !baseNames.has(normalizeCompanyName(text(row[1]))))
      .map((row) => {
        const copy = [...row];
        while (copy.length < 24) copy.push("");
        return copy.slice(0, 24);
      });
    const rows = [...baseRows, ...importedRows];
    if (rows.length > 1999) {
      throw new Error("Companies sheet capacity exceeded");
    }
    const updates = [
      {
        range: `'Companies'!A2:X${String(rows.length + 1)}`,
        values: rows,
      },
    ];
    if (existing.length > rows.length) {
      updates.push({
        range: `'Companies'!A${String(rows.length + 2)}:X${String(existing.length + 1)}`,
        values: Array.from({ length: existing.length - rows.length }, blankRow),
      });
    }
    await this.transport.batchUpdateValues(updates);
    return rows.length;
  }

  async companiesNeedingEnrichment(
    limit: number,
  ): Promise<readonly { rowNumber: number; website: string; name: string }[]> {
    const rows = await this.transport.getValues("'Companies'!A2:X2000");
    const countFromSignal = (signal: string, label: string): number => {
      const match = new RegExp(`(\\d+) ${label}`, "iu").exec(signal);
      return Number(match?.[1] ?? 0);
    };
    return rows
      .flatMap((row, index) => {
        const website = text(row[7]).trim();
        const lastEnriched = text(row[22]).trim();
        const signal = text(row[19]);
        return website !== "" && lastEnriched === ""
          ? [
              {
                rowNumber: index + 2,
                website,
                name: text(row[1]),
                priority:
                  countFromSignal(signal, "engineering") * 1000 +
                  countFromSignal(signal, "open-role signals"),
              },
            ]
          : [];
      })
      .sort(
        (left, right) =>
          right.priority - left.priority || left.name.localeCompare(right.name),
      )
      .slice(0, limit);
  }

  async writeEnrichment(
    rowNumber: number,
    enrichment: CompanyEnrichment,
  ): Promise<void> {
    const currentNotes = await this.transport.getValues(
      `'Companies'!X${String(rowNumber)}:X${String(rowNumber)}`,
    );
    const notes = [text(currentNotes[0]?.[0]), enrichment.notes]
      .filter(Boolean)
      .join("\n")
      .slice(0, 40_000);
    await this.transport.batchUpdateValues([
      {
        range: `'Companies'!I${String(rowNumber)}:Q${String(rowNumber)}`,
        values: [
          [
            enrichment.careersPage,
            enrichment.jobBoard,
            enrichment.contactPage,
            enrichment.linkedin,
            enrichment.twitter,
            enrichment.github,
            enrichment.otherSocials,
            enrichment.recruitingEmail,
            enrichment.otherEmails,
          ],
        ],
      },
      {
        range: `'Companies'!W${String(rowNumber)}:W${String(rowNumber)}`,
        values: [[enrichment.lastEnriched]],
      },
      {
        range: `'Companies'!X${String(rowNumber)}:X${String(rowNumber)}`,
        values: [[notes]],
      },
    ]);
  }
}
