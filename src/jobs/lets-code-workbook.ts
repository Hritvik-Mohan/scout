export const LETS_CODE_WORKBOOK_URL =
  "https://docs.google.com/spreadsheets/d/1F76IAJ9661keW37wFZqutIXOQf1vBJNx/edit";

export const LETS_CODE_SHEETS = [
  "Freshers Hiring Companies",
  "Remote-Friendly Companies",
  "Career Contacts",
  "Jobs",
  "Companies Hiring Freshers Above 20 LPA",
  "Resources",
] as const;

export interface ImportedCompanyIntel {
  name: string;
  sector: string;
  area: string;
  careersPage: string;
  linkedIn: string;
  recruitingEmail: string;
  roles: string;
  notes: readonly string[];
}

export interface ImportedJobReference {
  company: string;
  role: string;
  batches: string;
  location: string;
  url: string;
}

export interface ImportedResource {
  category: string;
  title: string;
  url: string;
}

export interface LetsCodeIntel {
  companies: readonly ImportedCompanyIntel[];
  jobs: readonly ImportedJobReference[];
  resources: readonly ImportedResource[];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(india\)/gu, "")
    .replace(/\b(?:india|blr)\b/gu, "")
    .replace(/[^a-z0-9]+/gu, "")
    .trim();
}

const nonEmpty = (value: string | undefined): string => value?.trim() ?? "";
const validCompanyRow = (row: readonly string[]): boolean => {
  const name = nonEmpty(row[0]);
  return (
    name !== "" &&
    !name.toLowerCase().includes("startup bundle") &&
    !name.toLowerCase().includes("startup list")
  );
};

const addCompany = (
  companies: Map<string, ImportedCompanyIntel>,
  candidate: ImportedCompanyIntel,
): void => {
  const key = normalizeCompanyName(candidate.name);
  if (key === "") return;
  const existing = companies.get(key);
  if (existing === undefined) {
    companies.set(key, candidate);
    return;
  }
  companies.set(key, {
    name: existing.name,
    sector: existing.sector || candidate.sector,
    area: existing.area || candidate.area,
    careersPage: existing.careersPage || candidate.careersPage,
    linkedIn: existing.linkedIn || candidate.linkedIn,
    recruitingEmail: existing.recruitingEmail || candidate.recruitingEmail,
    roles: [existing.roles, candidate.roles].filter(Boolean).join("; "),
    notes: [
      ...new Set([...existing.notes, ...candidate.notes].filter(Boolean)),
    ],
  });
};

const resourceCategories = new Set([
  "Placement & Career Resources",
  "Resume & LinkedIn Resources",
  "AI Career Tools",
  "Interview Preparation",
  "Previous Year Questions (PYQs)",
  "Learning Resources",
  "Blogs & Career Guides",
]);

export function collectLetsCodeIntel(
  sheets: Readonly<Record<(typeof LETS_CODE_SHEETS)[number], string[][]>>,
): LetsCodeIntel {
  const companies = new Map<string, ImportedCompanyIntel>();

  for (const row of sheets["Freshers Hiring Companies"].slice(1)) {
    if (!validCompanyRow(row)) continue;
    addCompany(companies, {
      name: nonEmpty(row[0]),
      sector: nonEmpty(row[1]),
      area: nonEmpty(row[7]),
      careersPage: nonEmpty(row[3]),
      linkedIn: nonEmpty(row[4]),
      recruitingEmail: "",
      roles: nonEmpty(row[5]),
      notes: [
        nonEmpty(row[2]) && `Reported fresher CTC: ${nonEmpty(row[2])}`,
        nonEmpty(row[6]) && `Reported hiring process: ${nonEmpty(row[6])}`,
      ].filter(Boolean),
    });
  }

  for (const row of sheets["Remote-Friendly Companies"].slice(1)) {
    if (!validCompanyRow(row)) continue;
    addCompany(companies, {
      name: nonEmpty(row[0]),
      sector: nonEmpty(row[2]),
      area: nonEmpty(row[6]),
      careersPage: nonEmpty(row[4]),
      linkedIn: nonEmpty(row[5]),
      recruitingEmail: "",
      roles: nonEmpty(row[3]),
      notes: [
        nonEmpty(row[1]) && `Reported work model: ${nonEmpty(row[1])}`,
      ].filter(Boolean),
    });
  }

  for (const row of sheets["Career Contacts"].slice(1)) {
    if (!validCompanyRow(row) || !nonEmpty(row[4]).startsWith("http")) continue;
    addCompany(companies, {
      name: nonEmpty(row[0]),
      sector: "",
      area: nonEmpty(row[6]),
      careersPage: nonEmpty(row[4]),
      linkedIn: nonEmpty(row[5]),
      recruitingEmail: nonEmpty(row[2]),
      roles: "",
      notes: [
        nonEmpty(row[1]) && `Reported recruiting contact: ${nonEmpty(row[1])}`,
        nonEmpty(row[3]) && `Recruiting page: ${nonEmpty(row[3])}`,
        nonEmpty(row[7]) && `Source tip: ${nonEmpty(row[7])}`,
      ].filter(Boolean),
    });
  }

  for (const row of sheets["Companies Hiring Freshers Above 20 LPA"].slice(1)) {
    if (!validCompanyRow(row)) continue;
    addCompany(companies, {
      name: nonEmpty(row[0]),
      sector: "",
      area: "",
      careersPage: nonEmpty(row[3]),
      linkedIn: "",
      recruitingEmail: "",
      roles: nonEmpty(row[2]),
      notes: [
        nonEmpty(row[1]) &&
          `Reported typical fresher package: ${nonEmpty(row[1])}`,
      ].filter(Boolean),
    });
  }

  const jobs = sheets.Jobs.slice(1)
    .filter(
      (row) => validCompanyRow(row) && nonEmpty(row[4]).startsWith("http"),
    )
    .map((row) => ({
      company: nonEmpty(row[0]),
      role: nonEmpty(row[1]),
      batches: nonEmpty(row[2]),
      location: nonEmpty(row[3]),
      url: nonEmpty(row[4]),
    }));

  const resourcesByUrl = new Map<
    string,
    { categories: Set<string>; titles: Set<string> }
  >();
  let category = "Other";
  let previous = "";
  for (const row of sheets.Resources) {
    const value = nonEmpty(row[0]);
    if (value === "") continue;
    if (resourceCategories.has(value)) {
      category = value;
      previous = "";
      continue;
    }
    if (/^https?:\/\//iu.test(value)) {
      const current = resourcesByUrl.get(value) ?? {
        categories: new Set<string>(),
        titles: new Set<string>(),
      };
      current.categories.add(category);
      if (previous !== "") current.titles.add(previous);
      resourcesByUrl.set(value, current);
    } else {
      previous = value;
    }
  }
  const resources = [...resourcesByUrl.entries()].map(([url, details]) => ({
    category: [...details.categories].join("; "),
    title: [...details.titles].join("; "),
    url,
  }));

  return {
    companies: [...companies.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    jobs,
    resources,
  };
}

export async function fetchLetsCodeSheets(
  fetchImplementation: typeof fetch = fetch,
): Promise<Readonly<Record<(typeof LETS_CODE_SHEETS)[number], string[][]>>> {
  const entries = await Promise.all(
    LETS_CODE_SHEETS.map(async (sheet) => {
      const endpoint = new URL(
        "https://docs.google.com/spreadsheets/d/1F76IAJ9661keW37wFZqutIXOQf1vBJNx/gviz/tq",
      );
      endpoint.searchParams.set("sheet", sheet);
      endpoint.searchParams.set("tqx", "out:csv");
      const response = await fetchImplementation(endpoint);
      if (!response.ok) {
        throw new Error(
          `Lets Code workbook fetch failed for ${sheet}: HTTP ${String(response.status)}`,
        );
      }
      return [sheet, parseCsv(await response.text())] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    (typeof LETS_CODE_SHEETS)[number],
    string[][]
  >;
}
