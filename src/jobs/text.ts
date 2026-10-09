export const stripMarkup = (value: string): string =>
  value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll(/&(?:nbsp|amp|quot|#39);/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
