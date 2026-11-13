import { logCaughtError } from "@/backend/logging/Logger";

import { createPicaTools, createPicaToolState } from "../PicaTools";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolDescription } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { PicaToolsInput, PicaToolState } from "../PicaTools";
import type {
  PicaBridgeDescriptor,
  PicaBridgeLease,
  PicaBridgeTurn,
} from "./PicaBridge";

interface HumanMessage {
  readonly id: string;
  readonly text: string;
}

/** Owns ACP tool budgets and the human message bound to each turn. */
export class PicaAcpToolTurns {
  private readonly dependencies: Pick<
    PicaToolsInput,
    | "tools"
    | "sessions"
    | "answerFiles"
    | "agentBrowsers"
    | "adminTools"
    | "agentDeletions"
    | "searchMemory"
    | "readConversationContext"
    | "readOwnChat"
    | "attachHostFile"
    | "agentChat"
  >;
  private readonly controller = new AbortController();
  private turn = 0;
  private state: PicaToolState | null = null;
  private readonly answerRunId: (turn: number) => string;

  public constructor(
    dependencies: Pick<
      PicaToolsInput,
      | "tools"
      | "sessions"
      | "answerFiles"
      | "agentBrowsers"
      | "adminTools"
      | "agentDeletions"
      | "searchMemory"
      | "readConversationContext"
      | "readOwnChat"
      | "attachHostFile"
      | "agentChat"
    >,
    answerRunId: (turn: number) => string,
  ) {
    this.dependencies = dependencies;
    this.answerRunId = answerRunId;
  }

  /** Aborts the job when an additional call would exceed its turn's budget. */
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Lists the tools a job offers its agent session.
   *
   * @param userId - The person of the job.
   * @returns The catalog; administrator tools only for an administrator.
   *
   * @remarks
   * Only the listing depends on the right. Every call resolves it afresh, so
   * a person who is none cannot call a tool by guessing its name, and an
   * unknown answer lists none.
   */
  public async catalog(
    userId: string,
  ): Promise<readonly RuntimeToolDescription[]> {
    return createPicaTools({
      tools: this.dependencies.tools,
      sessions: this.dependencies.sessions,
      authorize: () => Promise.resolve(),
      answerFiles: this.dependencies.answerFiles,
      agentBrowsers: this.dependencies.agentBrowsers,
      adminTools: this.dependencies.adminTools,
      agentDeletions: this.dependencies.agentDeletions,
      searchMemory: this.dependencies.searchMemory,
      readConversationContext: this.dependencies.readConversationContext,
      readOwnChat: this.dependencies.readOwnChat,
      attachHostFile: this.dependencies.attachHostFile,
      agentChat: this.dependencies.agentChat,
    }).describe({ includeAdministrator: await this.isAdministrator(userId) });
  }

  /** Binds a new turn with a fresh budget and credential. */
  public bind(
    turn: number,
    context: RuntimeExecutionContext,
    bridge: PicaBridgeLease,
    message: HumanMessage,
  ): PicaBridgeDescriptor | null {
    if (turn <= this.turn) return null;
    this.turn = turn;
    this.state = createPicaToolState();
    return this.rebind(context, bridge, message);
  }

  /** Rotates a credential while retaining the running turn's budget. */
  public rebind(
    context: RuntimeExecutionContext,
    bridge: PicaBridgeLease,
    message: HumanMessage,
  ): PicaBridgeDescriptor | null {
    if (!this.state) return null;
    return bridge.setTurn(
      this.createTurn(context, message, this.state, this.turn),
    );
  }

  /** Issues an inactive credential while the adapter decides how it will steer. */
  public reserve(
    context: RuntimeExecutionContext,
    bridge: PicaBridgeLease,
    message: HumanMessage,
  ): PicaBridgeDescriptor | null {
    if (!this.state) return null;
    return bridge.reserveTurn(
      this.createTurn(context, message, this.state, this.turn),
    );
  }

  /** Selects a retained or fresh budget before activating the reserved credential. */
  public activate(
    context: RuntimeExecutionContext,
    bridge: PicaBridgeLease,
    message: HumanMessage,
    nextTurn: number | null,
  ): boolean {
    if (!this.state || (nextTurn !== null && nextTurn <= this.turn))
      return false;
    const state = nextTurn === null ? this.state : createPicaToolState();
    if (
      !bridge.activateTurn(
        this.createTurn(context, message, state, nextTurn ?? this.turn),
      )
    )
      return false;
    if (nextTurn !== null) {
      this.turn = nextTurn;
      this.state = state;
    }
    return true;
  }

  private async isAdministrator(userId: string): Promise<boolean> {
    const tools = this.dependencies.adminTools;
    if (!tools) return false;
    try {
      return await tools.isAdministrator(userId);
    } catch (error: unknown) {
      logCaughtError("PicaAcpJob", error);

      return false;
    }
  }

  private createTurn(
    context: RuntimeExecutionContext,
    message: HumanMessage,
    state: PicaToolState,
    answerTurn: number,
  ): PicaBridgeTurn {
    const tools = createPicaTools(
      {
        message: message.text,
        planTurnId: message.id,
        answerRunId: this.answerRunId(answerTurn),
        tools: this.dependencies.tools,
        sessions: this.dependencies.sessions,
        authorize: context.authorize,
        agentBrowsers: this.dependencies.agentBrowsers,
        adminTools: this.dependencies.adminTools,
        agentDeletions: this.dependencies.agentDeletions,
        onLimit: () => this.controller.abort("stepLimit"),
        ...(this.dependencies.answerFiles
          ? { answerFiles: this.dependencies.answerFiles }
          : {}),
        ...(this.dependencies.searchMemory
          ? { searchMemory: this.dependencies.searchMemory }
          : {}),
        ...(this.dependencies.readConversationContext
          ? {
              readConversationContext:
                this.dependencies.readConversationContext,
            }
          : {}),
        ...(this.dependencies.readOwnChat
          ? { readOwnChat: this.dependencies.readOwnChat }
          : {}),
        ...(this.dependencies.attachHostFile
          ? { attachHostFile: this.dependencies.attachHostFile }
          : {}),
        ...(this.dependencies.agentChat
          ? { agentChat: this.dependencies.agentChat }
          : {}),
      },
      state,
    );
    return { id: message.id, answerTurn, tools, context };
  }
}
