import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { AGENT_READ_LIMITS } from "@/definition/AgentReadChunks";

import {
  PicaPlanConfirmation,
  picaPlanOperationId,
} from "../PicaPlanConfirmation";
import { PICA_STORAGE_HINTS } from "./PicaStorageContracts";
import { PICA_STORAGE_HANDLERS } from "./PicaStorageHandlers";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type {
  StorageConfirmation,
  StorageError,
  StorageResult,
} from "@/definition/GoogleDriveFiles";
import type { PicaPlanTurn } from "../PicaPlanConfirmation";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaStorageTool } from "./PicaStorageContracts";
import type { PicaStorageFiles } from "./PicaStorageHandlers";

/** At most this many confirmations wait for the person's reply. */
const MAXIMUM_PENDING_CONFIRMATIONS = 1000;

/** One call of a native Storage tool. */
export interface PicaStorageCall {
  readonly tool: PicaStorageTool;
  /** The arguments the registry already checked against the tool schema. */
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly context: RuntimeExecutionContext;
  /** The raw human message of this turn and the person's confirmation word. */
  readonly turn: PicaPlanTurn;
}

/** A confirmation token Pages keeps for a call until the person approved it. */
interface PendingToken {
  readonly token: string;
  readonly expiresAt: number;
}

function withoutToken(
  confirmation: StorageConfirmation,
): Omit<StorageConfirmation, "token"> {
  return {
    action: confirmation.action,
    target: confirmation.target,
    scope: confirmation.scope,
    expiresAt: confirmation.expiresAt,
  };
}

/** The error details the model may read: never a confirmation token. */
function visibleDetails(error: StorageError): unknown {
  const { confirmation, ...details } = error;
  return confirmation === undefined
    ? details
    : { ...details, confirmation: withoutToken(confirmation) };
}

function serialize(result: unknown): string {
  return redactCredentials(JSON.stringify(result));
}

/**
 * Pica's access to the Storage interface (PAGE-270, PAGE-271).
 *
 * @remarks
 * Every tool calls the same reader and writer as `/storage-api/v1`, so the
 * checks of the connected Google account, conflicts, limits and the
 * confirmations bound to action, object and state apply unchanged. The
 * administrator right is checked by the caller on every call. A confirmation
 * token stays on the server: the model sees the target, the scope and the
 * confirmation word, and Pages spends the token only when the person replied
 * with that word alone in a later message and the model repeats the identical
 * call. The writer then refuses the token when the object changed meanwhile.
 */
export class PicaStorageService {
  private readonly files: PicaStorageFiles;
  private readonly consent = new PicaPlanConfirmation();
  private readonly pending = new Map<string, PendingToken>();

  /**
   * Creates the service.
   *
   * @param files - The Storage interface of the instance Drive.
   */
  public constructor(files: PicaStorageFiles) {
    this.files = files;
  }

  /**
   * Runs one Storage tool for the person of the job.
   *
   * @param call - Tool, checked arguments, job scope and human turn.
   * @returns The result as JSON, or a stable error code with an explanation.
   */
  public async run(call: PicaStorageCall): Promise<PicaToolOutcome> {
    const request = { operation: call.tool, parameters: call.parameters };
    // The key ignores the turn: a confirmation asked for in one turn is approved in a later one.
    const key = picaPlanOperationId(request, call.context, "storage");
    const approved = this.approvedToken(key, call);
    const result = await PICA_STORAGE_HANDLERS[call.tool](
      this.files,
      call.parameters,
      { userId: call.context.userId, confirmation: approved },
    );
    if (
      !result.ok &&
      result.error.confirmation !== undefined &&
      (result.error.code === "confirmation_required" ||
        result.error.code === "confirmation_invalid")
    )
      return this.askConfirmation(key, call, result.error);
    return this.outcome(result);
  }

  private approvedToken(key: string, call: PicaStorageCall): string | null {
    const stored = this.pending.get(key);
    if (!stored) return null;
    if (stored.expiresAt <= Date.now()) {
      this.pending.delete(key);
      return null;
    }
    const request = { operation: call.tool, parameters: call.parameters };
    if (!this.consent.consume(request, call.context, call.turn)) return null;
    this.pending.delete(key);
    return stored.token;
  }

  private askConfirmation(
    key: string,
    call: PicaStorageCall,
    error: StorageError,
  ): PicaToolOutcome {
    const confirmation = error.confirmation;
    if (confirmation === undefined) return this.outcome({ ok: false, error });
    // Arms the consent for exactly this call; it cannot be given in the asking turn.
    const isSpent = this.consent.consume(
      { operation: call.tool, parameters: call.parameters },
      call.context,
      call.turn,
    );
    // An approval this turn already used never covers a newly issued token.
    if (!isSpent) this.remember(key, confirmation);
    return {
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      result: serialize({
        ...withoutToken(confirmation),
        hasChanged: error.code === "confirmation_invalid",
        confirmation: call.turn.confirmation,
        simulation: this.files.isSimulation,
        instruction:
          "Name the target, the action and its effect (for a folder its scope: folders, files, bytes; isTruncated means more) to the person. Only their reply with the confirmation word alone in a new message allows exactly this action on this state; then repeat the identical call. Never type the word yourself.",
      }),
    };
  }

  private remember(key: string, confirmation: StorageConfirmation): void {
    const now = Date.now();
    for (const [stored, entry] of this.pending)
      if (entry.expiresAt <= now) this.pending.delete(stored);
    if (this.pending.size >= MAXIMUM_PENDING_CONFIRMATIONS) {
      const oldest = this.pending.keys().next();
      if (oldest.done !== true) this.pending.delete(oldest.value);
    }
    this.pending.set(key, {
      token: confirmation.token,
      expiresAt: Date.parse(confirmation.expiresAt),
    });
  }

  private outcome(result: StorageResult<unknown>): PicaToolOutcome {
    if (result.ok) return this.success(result.value);
    return {
      ok: false,
      error: result.error.code.toUpperCase(),
      result: serialize({
        hint: PICA_STORAGE_HINTS[result.error.code],
        details: visibleDetails(result.error),
        simulation: this.files.isSimulation,
      }),
    };
  }

  private success(value: unknown): PicaToolOutcome {
    const result = serialize({
      ...(typeof value === "object" && value !== null ? value : { value }),
      simulation: this.files.isSimulation,
    });
    // A tool result has a hard size; a long text is refused, never cut silently.
    return result.length > AGENT_READ_LIMITS.totalBytes
      ? {
          ok: false,
          error: "RESULT_TOO_LARGE",
          result: serialize({
            hint: "The result is too large for one answer; read a smaller file or offer storage_download.",
          }),
        }
      : { ok: true, result, error: null };
  }
}
