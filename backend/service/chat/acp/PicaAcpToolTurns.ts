import { createPicaTools } from "../PicaTools";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { PicaToolsInput } from "../PicaTools";
import type { PicaBridgeLease } from "./PicaBridge";

/** Owns ACP tool budgets across prompt boundaries, independent of the follow-up queue. */
export class PicaAcpToolTurns {
  private readonly dependencies: Pick<PicaToolsInput, "tools" | "sessions">;
  private readonly controller = new AbortController();
  private turn = 0;

  public constructor(dependencies: Pick<PicaToolsInput, "tools" | "sessions">) {
    this.dependencies = dependencies;
  }

  /** Aborts the job when an additional call would exceed its turn's budget. */
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The prompt boundary and queue may name the same turn; only the first binds a fresh budget. */
  public bind(
    turn: number,
    context: RuntimeExecutionContext,
    bridge: PicaBridgeLease,
  ): void {
    if (turn <= this.turn) return;
    this.turn = turn;
    bridge.setTurn({
      tools: createPicaTools({
        tools: this.dependencies.tools,
        sessions: this.dependencies.sessions,
        authorize: context.authorize,
        onLimit: () => this.controller.abort("stepLimit"),
      }),
      context,
    });
  }
}
