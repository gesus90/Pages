import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { PagesOperationError } from "../../../src/tools/operation-failure.ts";
import { confirmPlanDeletion } from "../../../src/tools/plan-confirmation.ts";

import type {
  ClientCapabilities,
  ElicitResult,
} from "@modelcontextprotocol/server";
import type { Mock, MockInstance } from "vitest";
import type { McpOperations } from "../../../src/operations-server.ts";

const PARAMETERS = {
  operationId: "delete-plan-1",
  planId: "plan-1",
  expectedRevision: 7,
  confirmation: "model-supplied word",
};
const CONTROL = { control: { revision: 7, canDelete: true } };
const INVALID_PARAMETERS: readonly Record<string, unknown>[] = [
  { expectedRevision: 7 },
  { planId: 1, expectedRevision: 7 },
  { planId: "plan-1" },
  { planId: "plan-1", expectedRevision: "7" },
  { planId: "plan-1", expectedRevision: NaN },
  { planId: "plan-1", expectedRevision: Infinity },
  { planId: "plan-1", expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
  { planId: "plan-1", expectedRevision: 1.5 },
  { planId: "plan-1", expectedRevision: 0 },
  { planId: "plan-1", expectedRevision: -1 },
];
const ACCEPTED_FORMS: readonly AcceptedForm[] = [
  { capabilities: { elicitation: { form: {} } }, confirmation: "DELETE" },
  { capabilities: { elicitation: { form: {} } }, confirmation: "LÖSCHEN" },
  { capabilities: { elicitation: {} }, confirmation: "DELETE" },
];
const UNSUPPORTED_CAPABILITIES: readonly (ClientCapabilities | undefined)[] = [
  undefined,
  {},
  { elicitation: { url: {} } },
];
const REFUSED_RESPONSES: readonly ElicitResult[] = [
  { action: "decline", content: { confirmation: "DELETE" } },
  { action: "cancel", content: { confirmation: "DELETE" } },
  { action: "accept" },
  { action: "accept", content: {} },
  { action: "accept", content: { confirmation: "delete" } },
  { action: "accept", content: { confirmation: " DELETE" } },
  { action: "accept", content: { confirmation: "yes" } },
  { action: "accept", content: { confirmation: true } },
];

interface AcceptedForm {
  readonly capabilities: ClientCapabilities;
  readonly confirmation: string;
}

interface ConfirmationFixture {
  readonly server: McpServer;
  readonly operations: McpOperations;
  readonly read: Mock<McpOperations["read"]>;
  readonly capabilities: MockInstance<
    McpServer["server"]["getClientCapabilities"]
  >;
  readonly elicit: MockInstance<McpServer["server"]["elicitInput"]>;
}

function createFixture(): ConfirmationFixture {
  const server = new McpServer({ name: "unit-test", version: "1.0.0" });
  const read = vi.fn<McpOperations["read"]>().mockResolvedValue(CONTROL);
  const operations: McpOperations = {
    verify: vi.fn<McpOperations["verify"]>(),
    names: vi.fn<McpOperations["names"]>(),
    read,
  };
  const capabilities = vi
    .spyOn(server.server, "getClientCapabilities")
    .mockReturnValue({ elicitation: { form: {} } });
  const elicit = vi.spyOn(server.server, "elicitInput").mockResolvedValue({
    action: "accept",
    content: { confirmation: "DELETE" },
  });
  return { server, operations, read, capabilities, elicit };
}

describe("confirmPlanDeletion client consent", () => {
  it.each(ACCEPTED_FORMS)(
    "uses the client's $confirmation with capabilities $capabilities",
    async ({ capabilities, confirmation }) => {
      const fixture = createFixture();
      fixture.capabilities.mockReturnValue(capabilities);
      fixture.elicit.mockResolvedValue({
        action: "accept",
        content: { confirmation },
      });

      const result = await confirmPlanDeletion(
        fixture.server,
        fixture.operations,
        PARAMETERS,
        "client_form",
      );

      expect(result).toEqual({ ...PARAMETERS, confirmation });
      expect(PARAMETERS.confirmation).toBe("model-supplied word");
      expect(fixture.read).toHaveBeenCalledExactlyOnceWith(
        "plans.control.read",
        { planId: "plan-1" },
      );
      expect(fixture.elicit).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          mode: "form",
          requestedSchema: {
            type: "object",
            properties: {
              confirmation: { type: "string", enum: ["LÖSCHEN", "DELETE"] },
            },
            required: ["confirmation"],
          },
        }),
        { timeout: 120_000 },
      );
      expect(fixture.elicit.mock.calls[0]?.[0].message).toContain(
        "plan-1, revision 7?",
      );
      expect(fixture.elicit.mock.calls[0]?.[0].message).toContain(
        "Only the saved plan is removed. Finished history remains stored but is no longer listed without the plan.",
      );
      expect(fixture.elicit.mock.calls[0]?.[0].message).toContain(
        "Workspace files, templates and provider sessions remain untouched.",
      );
    },
  );

  it("refuses an unavailable consent surface before reading the target", async () => {
    const fixture = createFixture();
    await expect(
      confirmPlanDeletion(
        fixture.server,
        fixture.operations,
        PARAMETERS,
        "unavailable",
      ),
    ).rejects.toEqual(new PagesOperationError("CONFIRMATION_REQUIRED"));
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.capabilities).not.toHaveBeenCalled();
    expect(fixture.elicit).not.toHaveBeenCalled();
  });

  it.each(UNSUPPORTED_CAPABILITIES)(
    "refuses a client without form support: %j",
    async (capabilities) => {
      const fixture = createFixture();
      fixture.capabilities.mockReturnValue(capabilities);
      await expect(
        confirmPlanDeletion(
          fixture.server,
          fixture.operations,
          PARAMETERS,
          "client_form",
        ),
      ).rejects.toEqual(new PagesOperationError("CONFIRMATION_REQUIRED"));
      expect(fixture.read).toHaveBeenCalledOnce();
      expect(fixture.elicit).not.toHaveBeenCalled();
    },
  );
});

describe("confirmPlanDeletion form responses", () => {
  it.each(REFUSED_RESPONSES)("refuses the response %j", async (response) => {
    const fixture = createFixture();
    fixture.elicit.mockResolvedValue(response);
    await expect(
      confirmPlanDeletion(
        fixture.server,
        fixture.operations,
        PARAMETERS,
        "client_form",
      ),
    ).rejects.toEqual(new PagesOperationError("CONFIRMATION_REQUIRED"));
    expect(fixture.elicit).toHaveBeenCalledOnce();
  });

  it("maps a failed form request to a fixed confirmation error", async () => {
    const fixture = createFixture();
    fixture.elicit.mockRejectedValue(new Error("Disconnected client details"));
    await expect(
      confirmPlanDeletion(
        fixture.server,
        fixture.operations,
        PARAMETERS,
        "client_form",
      ),
    ).rejects.toEqual(new PagesOperationError("CONFIRMATION_REQUIRED"));
  });
});

describe("confirmPlanDeletion target validation", () => {
  it.each(INVALID_PARAMETERS)(
    "rejects invalid parameters %j before reading",
    async (parameters) => {
      const fixture = createFixture();
      await expect(
        confirmPlanDeletion(
          fixture.server,
          fixture.operations,
          parameters,
          "client_form",
        ),
      ).rejects.toEqual(new PagesOperationError("INVALID_REQUEST"));
      expect(fixture.read).not.toHaveBeenCalled();
      expect(fixture.elicit).not.toHaveBeenCalled();
    },
  );

  it("still obtains consent when a deleted target may have an authorized replay", async () => {
    const fixture = createFixture();
    fixture.read.mockRejectedValue(new PagesOperationError("NOT_FOUND"));
    await expect(
      confirmPlanDeletion(
        fixture.server,
        fixture.operations,
        PARAMETERS,
        "client_form",
      ),
    ).resolves.toEqual({ ...PARAMETERS, confirmation: "DELETE" });
    expect(fixture.elicit).toHaveBeenCalledOnce();
  });

  it.each([new PagesOperationError("FORBIDDEN"), new Error("Read failed")])(
    "propagates a target read failure: %s",
    async (failure) => {
      const fixture = createFixture();
      fixture.read.mockRejectedValue(failure);
      await expect(
        confirmPlanDeletion(
          fixture.server,
          fixture.operations,
          PARAMETERS,
          "client_form",
        ),
      ).rejects.toBe(failure);
      expect(fixture.elicit).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, [], "invalid"])(
    "rejects non-object control %j",
    async (control) => {
      const fixture = createFixture();
      fixture.read.mockResolvedValue({ control });
      await expect(
        confirmPlanDeletion(
          fixture.server,
          fixture.operations,
          PARAMETERS,
          "client_form",
        ),
      ).rejects.toEqual(new Error("Pages operation failed."));
      expect(fixture.elicit).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { revision: "7", canDelete: true },
    { revision: 7 },
    { revision: 7, canDelete: "true" },
  ])("rejects unsupported control fields %j", async (control) => {
    const fixture = createFixture();
    fixture.read.mockResolvedValue({ control });
    await expect(
      confirmPlanDeletion(
        fixture.server,
        fixture.operations,
        PARAMETERS,
        "client_form",
      ),
    ).rejects.toEqual(
      new PagesOperationError("INVALID_REQUEST", {
        reason: "plan_schema_unsupported",
      }),
    );
    expect(fixture.elicit).not.toHaveBeenCalled();
  });

  it("refuses a changed revision before requesting consent", async () => {
    const fixture = createFixture();
    fixture.read.mockResolvedValue({
      control: { revision: 8, canDelete: true },
    });
    await expect(
      confirmPlanDeletion(
        fixture.server,
        fixture.operations,
        PARAMETERS,
        "client_form",
      ),
    ).rejects.toEqual(new PagesOperationError("CONFLICT"));
    expect(fixture.elicit).not.toHaveBeenCalled();
  });
});

describe("confirmPlanDeletion deletion blockers", () => {
  it("reports an active plan before requesting consent", async () => {
    const fixture = createFixture();
    fixture.read.mockResolvedValue({
      control: {
        revision: 7,
        canDelete: false,
        blockers: { delete: "plan_busy" },
      },
    });
    await expect(
      confirmPlanDeletion(
        fixture.server,
        fixture.operations,
        PARAMETERS,
        "client_form",
      ),
    ).rejects.toEqual(
      new PagesOperationError("INVALID_REQUEST", { reason: "plan_running" }),
    );
    expect(fixture.elicit).not.toHaveBeenCalled();
  });

  it.each([undefined, null, [], {}, { delete: "not_owner" }])(
    "refuses deletion for other blockers %j",
    async (blockers) => {
      const fixture = createFixture();
      fixture.read.mockResolvedValue({
        control: { revision: 7, canDelete: false, blockers },
      });
      await expect(
        confirmPlanDeletion(
          fixture.server,
          fixture.operations,
          PARAMETERS,
          "client_form",
        ),
      ).rejects.toEqual(new PagesOperationError("FORBIDDEN"));
      expect(fixture.elicit).not.toHaveBeenCalled();
    },
  );
});
