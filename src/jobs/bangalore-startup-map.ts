import { z } from "zod";

import { fetchDiscoveryText, type FetchLike } from "../discovery/http.js";

const MAP_URL = new URL("https://www.bangalorestartupmap.com/");

const founderLinkSchema = z.object({
  name: z.string().default(""),
  url: z.string().default(""),
});

const startupSchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1),
    kind: z.string().default("startup"),
    tagline: z.string().default(""),
    description: z.string().default(""),
    stage: z.union([z.string(), z.number()]).optional(),
    sector: z.string().default(""),
    tags: z.array(z.string()).default([]),
    area: z.string().default(""),
    hsr_location: z.string().default(""),
    website: z.string().default(""),
    founders: z.string().default(""),
    founder_links: z.union([z.array(founderLinkSchema), z.string()]).optional(),
    founded_year: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const roleSchema = z.object({
  track: z.string().default("unknown"),
  seniority: z.string().default("unknown"),
  fresher_friendly: z.boolean().default(false),
  posted_day: z.number().nullable().optional(),
});

const payloadSchema = z.object({
  startups: z.array(startupSchema),
  roles: z.record(z.array(roleSchema)).default({}),
  roleKeywords: z.record(z.array(z.string())).default({}),
});

export interface BangaloreStartupCompany {
  id: string;
  name: string;
  kind: string;
  stage: string;
  sector: string;
  area: string;
  localAddress: string;
  website: string;
  founders: string;
  founderProfiles: string;
  hiringSignal: string;
  openRolesHint: string;
  sourceUrl: string;
  notes: string;
}

const extractBalancedObject = (text: string, start: number): string => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      return text.slice(start, index + 1);
    }
  }
  throw new Error("Bangalore Startup Map payload is incomplete");
};

const nextFlightChunks = (html: string): string[] => {
  const chunks: string[] = [];
  const pattern = /<script>self\.__next_f\.push\((\[.*?\])\)<\/script>/gu;
  for (const match of html.matchAll(pattern)) {
    const encoded = match[1];
    if (encoded === undefined) continue;
    try {
      const parsed = JSON.parse(encoded) as unknown;
      if (
        Array.isArray(parsed) &&
        typeof parsed[1] === "string" &&
        parsed[1].length > 0
      ) {
        chunks.push(parsed[1]);
      }
    } catch {
      // Ignore unrelated malformed flight chunks and require the data chunk below.
    }
  }
  return chunks;
};

const clean = (value: string | number | undefined): string => {
  if (value === undefined || value === "$undefined") return "";
  return String(value).trim();
};

const dayToDate = (day: number | null | undefined): string => {
  if (day === undefined || day === null) return "";
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
};

export function parseBangaloreStartupMap(
  html: string,
): readonly BangaloreStartupCompany[] {
  const chunk = nextFlightChunks(html).find(
    (value) => value.includes('"cartoKey"') && value.includes('"startups"'),
  );
  if (chunk === undefined) {
    throw new Error("Bangalore Startup Map company payload was not found");
  }
  const start = chunk.indexOf('{"cartoKey"');
  const payload = payloadSchema.parse(
    JSON.parse(extractBalancedObject(chunk, start)) as unknown,
  );
  return payload.startups.map((startup) => {
    const roles = payload.roles[startup.slug] ?? [];
    const engineering = roles.filter((role) => role.track === "engineering");
    const junior = engineering.filter(
      (role) =>
        role.fresher_friendly ||
        ["fresher", "junior", "mid"].includes(role.seniority),
    );
    const latestDay = roles.reduce<number | undefined>(
      (latest, role) =>
        role.posted_day === undefined || role.posted_day === null
          ? latest
          : Math.max(latest ?? role.posted_day, role.posted_day),
      undefined,
    );
    const founderLinks = Array.isArray(startup.founder_links)
      ? startup.founder_links
          .filter((link) => link.url !== "" && link.url !== "$undefined")
          .map((link) => `${link.name}: ${link.url}`)
          .join("\n")
      : "";
    const keywords = payload.roleKeywords[startup.slug] ?? [];
    return {
      id: `bangalore-startup-map:${startup.slug}`,
      name: startup.name,
      kind: clean(startup.kind),
      stage: clean(startup.stage),
      sector: clean(startup.sector),
      area: clean(startup.area),
      localAddress: clean(startup.hsr_location),
      website: clean(startup.website),
      founders: clean(startup.founders),
      founderProfiles: founderLinks,
      hiringSignal:
        roles.length === 0
          ? "No roles shown"
          : `${String(roles.length)} open-role signals; ${String(engineering.length)} engineering; ${String(junior.length)} junior/mid/fresher-friendly; latest ${dayToDate(latestDay)}`,
      openRolesHint: keywords.slice(0, 30).join(", "),
      sourceUrl: `${MAP_URL.toString()}#${startup.slug}`,
      notes: [startup.tagline, startup.description, startup.tags.join(", ")]
        .filter((value) => value !== "")
        .join(" | "),
    };
  });
}

export async function discoverBangaloreStartupCompanies(
  fetchImpl: FetchLike = fetch,
): Promise<readonly BangaloreStartupCompany[]> {
  const html = await fetchDiscoveryText(fetchImpl, MAP_URL, "text/html");
  return parseBangaloreStartupMap(html);
}
