import { isRecord } from "../is-record.js";
import { PagesOperationError } from "./operation-failure.js";

import type { McpServer } from "@modelcontextprotocol/server";
import type { McpOperations } from "../operations-server.js";

/** Obtains target-bound consent directly from the client UI, never from model tool arguments. */
export async function confirmPlanDeletion(
  server: McpServer,
  operations: McpOperations,
  parameters: Readonly<Record<string, unknown>>,
  consentSurface: "client_form" | "unavailable",
): Promise<Readonly<Record<string, unknown>>> {
  if (consentSurface === "unavailable")
    throw new PagesOperationError("CONFIRMATION_REQUIRED");
  const { planId, expectedRevision } = parameters;
  if (
    typeof planId !== "string" ||
    typeof expectedRevision !== "number" ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1
  )
    throw new PagesOperationError("INVALID_REQUEST");
  await validateDeletionTarget(operations, { planId, expectedRevision });
  requireClientForm(server);
  const confirmation = await requestConfirmation(
    server,
    planId,
    expectedRevision,
  );
  return { ...parameters, confirmation };
}

function requireClientForm(server: McpServer): void {
  const elicitation = server.server.getClientCapabilities()?.elicitation;
  if (
    !elicitation ||
    !("form" in elicitation || Object.keys(elicitation).length === 0)
  )
    throw new PagesOperationError("CONFIRMATION_REQUIRED");
}

async function requestConfirmation(
  server: McpServer,
  planId: string,
  expectedRevision: number,
): Promise<string> {
  let consent;
  try {
    consent = await server.server.elicitInput(
      {
        mode: "form",
        message: `Delete saved plan ${planId}, revision ${expectedRevision}? Only the saved plan is removed. Finished history remains stored but is no longer listed without the plan. Workspace files, templates and provider sessions remain untouched. Enter the existing confirmation word of your Pages language.`,
        requestedSchema: {
          type: "object",
          properties: {
            confirmation: { type: "string", enum: ["LÖSCHEN", "DELETE"] },
          },
          required: ["confirmation"],
        },
      },
      { timeout: 120_000 },
    );
  } catch {
    // Unsupported protocol eras and disconnected/cancelled clients cannot authorize deletion.
    throw new PagesOperationError("CONFIRMATION_REQUIRED");
  }
  if (consent.action !== "accept" || !isRecord(consent.content))
    throw new PagesOperationError("CONFIRMATION_REQUIRED");
  const confirmation = consent.content.confirmation;
  if (confirmation !== "LÖSCHEN" && confirmation !== "DELETE")
    throw new PagesOperationError("CONFIRMATION_REQUIRED");
  return confirmation;
}

async function validateDeletionTarget(
  operations: McpOperations,
  target: { readonly planId: string; readonly expectedRevision: number },
): Promise<void> {
  const { planId, expectedRevision } = target;
  let response;
  try {
    response = await operations.read("plans.control.read", { planId });
  } catch (error: unknown) {
    // A committed deletion is no longer readable; the backend can still return its minimal authorized replay.
    if (error instanceof PagesOperationError && error.code === "NOT_FOUND")
      return;
    throw error;
  }
  if (!isRecord(response.control)) throw new Error("Pages operation failed.");
  const control = response.control;
  if (
    typeof control.revision !== "number" ||
    typeof control.canDelete !== "boolean"
  )
    throw new PagesOperationError("INVALID_REQUEST", {
      reason: "plan_schema_unsupported",
    });
  if (control.revision !== expectedRevision)
    throw new PagesOperationError("CONFLICT");
  if (control.canDelete !== true) {
    if (isRecord(control.blockers) && control.blockers.delete === "plan_busy")
      throw new PagesOperationError("INVALID_REQUEST", {
        reason: "plan_running",
      });
    throw new PagesOperationError("FORBIDDEN");
  }
}
