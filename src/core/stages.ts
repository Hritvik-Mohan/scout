import type { Stage } from "../models/enums.js";

const allowedTransitions: Readonly<Record<Stage, readonly Stage[]>> = {
  New: ["Researched", "Disqualified"],
  Researched: ["Drafted", "Disqualified"],
  Disqualified: [],
  Drafted: ["Contacted", "Researched"],
  Contacted: ["Replied", "Nurture", "Lost", "Call booked"],
  Replied: ["Call booked", "Nurture", "Lost", "Contacted"],
  "Call booked": ["Proposal drafted", "Nurture", "Lost"],
  "Proposal drafted": ["Proposal sent", "Call booked"],
  "Proposal sent": ["Won", "Lost", "Nurture"],
  Won: [],
  Lost: [],
  Nurture: ["Contacted", "Lost"],
};

export interface StageTransitionRequest {
  leadId: string;
  from: Stage;
  to: Stage;
  actor: string;
  reason: string;
  occurredAt: string;
}

export class InvalidStageTransitionError extends Error {
  readonly request: StageTransitionRequest;

  constructor(request: StageTransitionRequest) {
    super(
      `Invalid stage transition for ${request.leadId}: ${request.from} -> ${request.to}`,
    );
    this.name = "InvalidStageTransitionError";
    this.request = request;
  }
}

export const allowedNextStages = (stage: Stage): readonly Stage[] =>
  allowedTransitions[stage];

export const canTransition = (from: Stage, to: Stage): boolean =>
  allowedTransitions[from].includes(to);

export const assertValidTransition = (
  request: StageTransitionRequest,
): void => {
  if (!canTransition(request.from, request.to)) {
    throw new InvalidStageTransitionError(request);
  }
};
