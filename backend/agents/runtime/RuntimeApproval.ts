import {
  isChatConfirmationOperation,
  isChatOperation,
} from "@/backend/service/chat/ChatToolCatalog";

import type { ChatTemporaryPassword } from "@/definition/AgentAdministration";
import type { ChatConfirmationWord } from "@/definition/Chat";
import type { ChatActionOutcome } from "@/backend/service/chat/ChatPrompt";
import type {
  ChatActionRequest,
  ChatToolExecutor,
} from "@/backend/service/chat/ChatToolExecutor";
import type { RuntimeExecutionContext } from "./RuntimeExecutionContext";

/** Confirmation words come from the current human message, never from a tool schema. */
export interface RuntimeApprovalOptions {
  readonly context: RuntimeExecutionContext;
  readonly tools: Pick<ChatToolExecutor, "run">;
  readonly confirmation: ChatConfirmationWord | null;
  readonly agentConfirmation: "LÖSCHEN" | null;
  /** Human-only receipt sink; passwords must not enter model output or history. */
  readonly onTemporaryPassword: (receipt: ChatTemporaryPassword) => void;
}

/** Keeps Pages confirmation semantics when Mastra invokes native Pages operations. */
export class RuntimeApproval {
  private readonly options: RuntimeApprovalOptions;
  private confirmation: ChatConfirmationWord | null;
  private agentConfirmation: "LÖSCHEN" | null;

  public constructor(options: RuntimeApprovalOptions) {
    this.options = Object.freeze({ ...options });
    this.confirmation = options.confirmation;
    this.agentConfirmation = options.agentConfirmation;
  }

  /** Reauthorizes, consumes a confirmation once and routes human-only receipts separately. */
  public async run(
    action: ChatActionRequest,
  ): Promise<Omit<ChatActionOutcome, "temporaryPassword">> {
    await this.options.context.authorize();
    const confirmation = this.confirmation;
    const agentConfirmation = this.agentConfirmation;
    if (
      isChatOperation(action.operation) &&
      isChatConfirmationOperation(action.operation)
    ) {
      this.confirmation = null;
      this.agentConfirmation = null;
    }
    const { temporaryPassword, ...outcome } = await this.options.tools.run(
      this.options.context.userId,
      action,
      confirmation,
      agentConfirmation,
    );
    if (temporaryPassword) this.options.onTemporaryPassword(temporaryPassword);
    return outcome;
  }
}
