export const ALLOWED_PROSPECT_OPERATIONS = [
  "read_email_thread",
  "create_gmail_draft",
  "write_linkedin_copy_to_tracker",
] as const;

export type AllowedProspectOperation =
  (typeof ALLOWED_PROSPECT_OPERATIONS)[number];

export class ProhibitedProspectOperationError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`Prospect operation is prohibited: ${operation}`);
    this.name = "ProhibitedProspectOperationError";
    this.operation = operation;
  }
}

export const assertProspectOperationAllowed = (
  operation: string,
): asserts operation is AllowedProspectOperation => {
  if (!(ALLOWED_PROSPECT_OPERATIONS as readonly string[]).includes(operation)) {
    throw new ProhibitedProspectOperationError(operation);
  }
};
