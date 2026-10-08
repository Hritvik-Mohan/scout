import type { AgentId } from "../models/enums.js";
import type { TrackerRepository } from "../tracker/repository.js";
import type { ProposedLeadWrite } from "../tracker/repository.js";

export interface RouteLeadWriteRequest {
  runId: string;
  agent: AgentId;
  createdAt: string;
  write: ProposedLeadWrite;
}

export interface RoutedWriteResult {
  destination: "dry_run_output" | "live_pipeline";
  outcome: "applied" | "replayed";
}

export class TrackerWriteRouter {
  constructor(
    private readonly tracker: Pick<
      TrackerRepository,
      "appendDryRunOutput" | "proposeLeadWrite"
    >,
    private readonly dryRun: boolean,
  ) {}

  async routeLeadWrite(
    request: RouteLeadWriteRequest,
  ): Promise<RoutedWriteResult> {
    if (this.dryRun) {
      const result = await this.tracker.appendDryRunOutput(
        {
          runId: request.runId,
          agent: request.agent,
          leadId: request.write.leadId,
          proposedOperation: "update_pipeline_lead",
          target: `Pipeline:${request.write.leadId}`,
          proposedValue: request.write.changes,
          createdAt: request.createdAt,
        },
        request.write.idempotencyKey,
      );
      return { destination: "dry_run_output", outcome: result.outcome };
    }

    const result = await this.tracker.proposeLeadWrite(request.write);
    return { destination: "live_pipeline", outcome: result.outcome };
  }
}
