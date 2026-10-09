export interface DiscoveredJob {
  id: string;
  provider: string;
  title: string;
  company: string;
  url: string;
  publishedAt: string;
  candidateLocation: string;
  jobType: string | null;
  salary: string | null;
  description: string;
  tags: readonly string[];
}

export interface JobSearchRequest {
  startAt: Date;
  endAt: Date;
  maxResults: number;
}

export interface JobDiscoveryAdapter {
  readonly provider: string;
  discover(request: JobSearchRequest): Promise<readonly DiscoveredJob[]>;
}
