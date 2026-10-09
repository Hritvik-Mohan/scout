import { fetchDiscoveryText, type FetchLike } from "../discovery/http.js";

export interface CompanyEnrichment {
  careersPage: string;
  jobBoard: string;
  contactPage: string;
  linkedin: string;
  twitter: string;
  github: string;
  otherSocials: string;
  recruitingEmail: string;
  otherEmails: string;
  lastEnriched: string;
  notes: string;
}

const decodeHtml = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const linksFromHtml = (html: string, base: URL): URL[] => {
  const links: URL[] = [];
  const pattern = /href\s*=\s*["']([^"'#]+)["']/giu;
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    if (href === undefined || href.startsWith("javascript:")) continue;
    try {
      links.push(new URL(decodeHtml(href), base));
    } catch {
      // Ignore malformed third-party links.
    }
  }
  return links;
};

const unique = (values: readonly string[]): string[] => [
  ...new Set(values.filter((value) => value !== "")),
];

const boundedList = (values: readonly string[], limit = 50): string =>
  unique(values).slice(0, limit).join("\n").slice(0, 20_000);

const firstMatching = (links: readonly URL[], pattern: RegExp): string =>
  links.find((link) => pattern.test(link.href))?.href ?? "";

const publicEmails = (html: string, links: readonly URL[]): string[] => {
  const fromMailto = links
    .filter((link) => link.protocol === "mailto:")
    .map((link) => decodeURIComponent(link.pathname).toLowerCase());
  const fromText = [...html.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu)].map(
    (match) => match[0].toLowerCase(),
  );
  return unique([...fromMailto, ...fromText]).filter(
    (email) =>
      !email.endsWith("@example.com") &&
      !email.endsWith("@sentry.io") &&
      email.length <= 254,
  );
};

const atsName = (url: string): string => {
  if (url === "") return "";
  const host = new URL(url).hostname.toLowerCase();
  const providers: readonly [string, string][] = [
    ["greenhouse.io", "Greenhouse"],
    ["lever.co", "Lever"],
    ["ashbyhq.com", "Ashby"],
    ["smartrecruiters.com", "SmartRecruiters"],
    ["myworkdayjobs.com", "Workday"],
    ["workable.com", "Workable"],
    ["icims.com", "iCIMS"],
    ["jobvite.com", "Jobvite"],
    ["successfactors.com", "SAP SuccessFactors"],
    ["teamtailor.com", "Teamtailor"],
    ["recruitee.com", "Recruitee"],
    ["bamboohr.com", "BambooHR"],
    ["personio.com", "Personio"],
    ["breezy.hr", "Breezy HR"],
  ];
  return providers.find(([domain]) => host.endsWith(domain))?.[1] ?? "Direct";
};

export async function enrichCompanyWebsite(
  website: string,
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<CompanyEnrichment> {
  const root = new URL(website);
  const pages: { url: URL; html: string }[] = [];
  const homepage = await fetchDiscoveryText(fetchImpl, root, "text/html");
  pages.push({ url: root, html: homepage });
  const homepageLinks = linksFromHtml(homepage, root);
  const careersPage = firstMatching(
    homepageLinks,
    /(?:careers?|jobs?|join-us|work-with-us|opportunities)/iu,
  );
  const contactPage = firstMatching(
    homepageLinks,
    /(?:contact|about-us|company\/about)/iu,
  );
  for (const candidate of unique([careersPage, contactPage]).slice(0, 2)) {
    const url = new URL(candidate);
    if (url.origin !== root.origin) continue;
    try {
      pages.push({
        url,
        html: await fetchDiscoveryText(fetchImpl, url, "text/html"),
      });
    } catch {
      // Homepage evidence is still useful when a secondary page is unavailable.
    }
  }
  const allLinks = pages.flatMap((page) => linksFromHtml(page.html, page.url));
  const emails = unique(
    pages.flatMap((page) => publicEmails(page.html, allLinks)),
  );
  const recruiting = emails.filter((email) =>
    /^(?:career|careers|job|jobs|talent|recruit|recruiting|hr|people)@/iu.test(
      email,
    ),
  );
  const socials = unique(
    allLinks
      .filter((link) =>
        /(?:facebook\.com|instagram\.com|youtube\.com|medium\.com|discord\.(?:gg|com)|t\.me)$/iu.test(
          link.hostname,
        ),
      )
      .map((link) => link.href),
  );
  const resolvedCareers =
    careersPage ||
    firstMatching(
      allLinks,
      /(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|workable\.com)/iu,
    );
  const jobBoard = firstMatching(
    allLinks,
    /(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|workable\.com|icims\.com|jobvite\.com|successfactors\.com|teamtailor\.com|recruitee\.com|bamboohr\.com|personio\.com|breezy\.hr)/iu,
  );
  return {
    careersPage: resolvedCareers,
    jobBoard: jobBoard === "" ? "" : `${atsName(jobBoard)}: ${jobBoard}`,
    contactPage,
    linkedin: firstMatching(
      allLinks,
      /linkedin\.com\/(?:company|showcase)\//iu,
    ),
    twitter: firstMatching(allLinks, /(?:x|twitter)\.com\//iu),
    github: firstMatching(allLinks, /github\.com\//iu),
    otherSocials: boundedList(socials),
    recruitingEmail: boundedList(recruiting),
    otherEmails: boundedList(
      emails.filter((email) => !recruiting.includes(email)),
    ),
    lastEnriched: now.toISOString(),
    notes: `Public website scan: ${pages.map((page) => page.url.href).join(", ")}`,
  };
}
