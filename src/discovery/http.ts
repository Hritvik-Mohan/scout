export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const MAX_DISCOVERY_RESPONSE_BYTES = 2 * 1024 * 1024;
const DISCOVERY_TIMEOUT_MS = 15_000;

export class DiscoveryHttpError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DiscoveryHttpError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

export const fetchDiscoveryText = async (
  fetchImpl: FetchLike,
  url: URL,
  accept: string,
): Promise<string> => {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: accept,
        "User-Agent": "scout/0.1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DiscoveryHttpError(`request failed for ${url.origin}`, {
      cause: error,
      retryable: true,
    });
  }

  if (!response.ok) {
    throw new DiscoveryHttpError(
      `request to ${url.origin} returned HTTP ${String(response.status)}`,
      {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      },
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_DISCOVERY_RESPONSE_BYTES
  ) {
    throw new DiscoveryHttpError("discovery response exceeds the size limit");
  }

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_DISCOVERY_RESPONSE_BYTES) {
    throw new DiscoveryHttpError("discovery response exceeds the size limit");
  }

  return body;
};
