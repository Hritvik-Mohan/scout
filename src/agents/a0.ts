import type {
  AgentExecutionContext,
  AgentWorkResult,
  PipelineAgent,
} from "../runtime/run.js";

export type A0PreflightResult =
  { ready: true } | { ready: false; reason: string };

export type A0Preflight = (
  context: AgentExecutionContext,
) => Promise<A0PreflightResult>;

const readyPreflight: A0Preflight = () => Promise.resolve({ ready: true });

export class A0NoOpAgent implements PipelineAgent {
  readonly id = "A0" as const;

  constructor(private readonly preflight: A0Preflight = readyPreflight) {}

  async execute(context: AgentExecutionContext): Promise<AgentWorkResult> {
    const preflight = await this.preflight(context);
    if (!preflight.ready) {
      return {
        status: "skipped",
        leadsProcessed: 0,
        leadIds: [],
        error: preflight.reason,
      };
    }
    return {
      status: "success",
      leadsProcessed: 0,
      leadIds: [],
    };
  }
}
