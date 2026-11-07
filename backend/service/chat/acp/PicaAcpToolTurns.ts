import { createPicaTools, createPicaToolState } from "../PicaTools";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
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
    "tools" | "sessions" | "answerFiles" | "adminTools"
  >;
  private readonly controller = new AbortController();
  private turn = 0;
  private state: PicaToolState | null = null;
  private readonly answerRunId: (turn: number) => string;

  public constructor(
    dependencies: Pick<
      PicaToolsInput,
      "tools" | "sessions" | "answerFiles" | "adminTools"
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
        adminTools: this.dependencies.adminTools,
        onLimit: () => this.controller.abort("stepLimit"),
        ...(this.dependencies.answerFiles
          ? { answerFiles: this.dependencies.answerFiles }
          : {}),
      },
      state,
    );
    return { id: message.id, answerTurn, tools, context };
  }
}
