import type { Evidence } from "../models/common.js";

const normalizeClaim = (claim: string): string =>
  claim.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

export interface EvidenceCoverageResult {
  valid: boolean;
  missingClaims: readonly string[];
  unlistedSourceUrls: readonly string[];
}

export const validateEvidenceCoverage = (
  claims: readonly string[],
  evidence: readonly Evidence[],
  listedSources: readonly string[],
): EvidenceCoverageResult => {
  const evidencedClaims = new Set(
    evidence.map(({ claim }) => normalizeClaim(claim)),
  );
  const listedSourceSet = new Set(listedSources);
  const missingClaims = claims.filter(
    (claim) => !evidencedClaims.has(normalizeClaim(claim)),
  );
  const unlistedSourceUrls = [
    ...new Set(
      evidence
        .map(({ sourceUrl }) => sourceUrl)
        .filter((sourceUrl) => !listedSourceSet.has(sourceUrl)),
    ),
  ];

  return {
    valid: missingClaims.length === 0 && unlistedSourceUrls.length === 0,
    missingClaims,
    unlistedSourceUrls,
  };
};
