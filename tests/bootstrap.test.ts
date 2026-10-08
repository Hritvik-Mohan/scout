import { describe, expect, it } from "vitest";

import { serviceIdentity } from "../src/index.js";

describe("service foundation", () => {
  it("fails closed for prospect sending and LinkedIn automation", () => {
    expect(serviceIdentity.prospectSendingEnabled).toBe(false);
    expect(serviceIdentity.linkedInAutomationEnabled).toBe(false);
  });
});
