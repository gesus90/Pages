import { picaPlanOperationId } from "./PicaPlanConfirmation";
import { toolkitRefusal } from "./toolkit/AgentToolkitOutcome";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatActionOutcome } from "./ChatPrompt";
import type { ChatActionRequest } from "./ChatToolExecutor";
import type { PicaToolOutcome } from "./PicaToolSchemas";

type ArchiveConfirmationStatus = "held" | "asking" | "approved" | "closed";

/** Whether the operation uses a ticket archive preview. */
export function isTicketArchiveOperation(operation: string): boolean {
  return (
    operation === "ticket.archive" || operation === "ticket.archiveSelection"
  );
}

/** The archive calls held for confirmation cards in one human turn. */
export class PicaArchiveConfirmation {
  private readonly calls = new Map<string, ArchiveConfirmationStatus>();

  /**
   * Holds the execution call as soon as the read-only preview succeeds.
   * A preview of a selection supplies the token that the execution must use.
   */
  public holdPreview(
    action: ChatActionRequest,
    context: RuntimeExecutionContext,
    outcome: ChatActionOutcome,
  ): ChatActionOutcome | null {
    const preview = outcome.result;
    if (
      !isTicketArchiveOperation(action.operation) ||
      action.parameters.confirmed === true ||
      !outcome.ok ||
      typeof preview !== "object" ||
      preview === null ||
      !("confirmationRequired" in preview) ||
      preview.confirmationRequired !== true
    )
      return null;

    const parameters = {
      ...action.parameters,
      confirmed: true,
      ...(action.operation === "ticket.archive"
        ? { children: action.parameters.children ?? "include" }
        : {}),
      ...("selectionToken" in preview
        ? { selectionToken: preview.selectionToken }
        : {}),
    };
    const key = picaPlanOperationId({ ...action, parameters }, context);
    const status = this.calls.get(key);
    if (status !== undefined && status !== "held")
      return { ok: false, error: "CONFIRMATION_ALREADY_ASKED" };
    this.calls.set(key, "held");
    return {
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      result: {
        preview,
        tool: action.operation,
        parameters,
        scope:
          "Nothing changed. Use one `rueckfrage` with Archive as the recommended option and Cancel as the other. Describe the affected tickets from the preview and pass the returned tool and parameters unchanged as `confirms`. Repeat that exact call only after the card reports confirmed: true.",
      },
    };
  }

  /**
   * Reserves the card before any message is stored. Its answer settles this
   * exact call, and the reservation stays closed after a refusal or timeout.
   */
  public claimQuestion(
    action: ChatActionRequest,
    context: RuntimeExecutionContext,
  ): ((isApproved: boolean) => boolean) | null {
    const key = picaPlanOperationId(action, context);
    if (this.calls.get(key) !== "held") return null;
    this.calls.set(key, "asking");
    return (isApproved: boolean): boolean => {
      this.calls.set(key, isApproved ? "approved" : "closed");
      return isApproved;
    };
  }

  /** Consumes approval before dispatch can yield, or refuses the execution. */
  public guardExecution(
    action: ChatActionRequest,
    context: RuntimeExecutionContext,
  ): PicaToolOutcome | null {
    const key = picaPlanOperationId(action, context);
    const status = this.calls.get(key);
    if (status === "closed") return toolkitRefusal("CONFIRMATION_CLOSED");
    if (status !== "approved")
      return toolkitRefusal("CONFIRMATION_REQUIRED", {
        scope:
          "The archive preview without confirmed provides the exact call for one confirmation card. Run the confirmed call only after that card reports confirmed: true.",
      });
    this.calls.set(key, "closed");
    return null;
  }
}
