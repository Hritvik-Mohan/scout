import type { OpenIssue } from "../jobs/run-monitor.js";

export interface GitHubIssuesOptions {
  /** "owner/name" */
  repository: string;
  token: string;
  fetch?: typeof fetch;
}

interface IssueResponse {
  number: number;
  body: string | null;
  html_url: string;
  pull_request?: unknown;
}

/** The few GitHub issue operations the run monitor needs. */
export class GitHubIssues {
  private readonly repository: string;
  private readonly token: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: GitHubIssuesOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/u.test(options.repository)) {
      throw new Error('The issue repository must look like "owner/name"');
    }
    this.repository = options.repository;
    this.token = options.token;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImplementation(
      `https://api.github.com/repos/${this.repository}${path}`,
      {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(
        `GitHub request failed with HTTP ${String(response.status)}`,
      );
    }
    return (await response.json()) as T;
  }

  async listOpen(): Promise<readonly OpenIssue[]> {
    const issues = await this.request<IssueResponse[]>(
      "/issues?state=open&per_page=100",
    );
    return issues
      .filter((issue) => issue.pull_request === undefined)
      .map((issue) => ({ number: issue.number, body: issue.body ?? "" }));
  }

  async create(title: string, body: string): Promise<string> {
    const issue = await this.request<IssueResponse>("/issues", {
      method: "POST",
      body: JSON.stringify({ title, body }),
    });
    return issue.html_url;
  }

  async close(number: number, comment: string): Promise<void> {
    await this.request(`/issues/${String(number)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: comment }),
    });
    await this.request(`/issues/${String(number)}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    });
  }
}
