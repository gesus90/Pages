/** How often a background run looks whether the agent still works in a chat. */
const POLL_MILLISECONDS = 2_000;
/** How long a background run waits for the agent to leave its chats at most. */
const WAIT_MAXIMUM_MILLISECONDS = 30 * 60_000;

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref();
  });
}

/** What the wait for an idle agent runs on. */
export interface AgentChatIdleWait {
  /** Tells whether the agent works in a chat now, rounds that wait for a place included. */
  readonly isBusy: () => boolean;
  /** Waits between two looks; tests pass a fast one. */
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly maximumMilliseconds?: number;
}

/**
 * Which agents answer in a chat now (PAGE-376).
 *
 * @remarks
 * Background work of an agent, such as the upkeep of its memory and its
 * learning, runs only while the agent works in no chat: it never competes
 * with a chat session for the agent's places and never delays an answer.
 */
export class AgentChatActivity {
  private readonly jobs = new Map<string, number>();

  /**
   * Notes that a round of a chat of the agent begins.
   *
   * @returns Ends the round once; calling it again changes nothing.
   */
  public begin(agentId: string): () => void {
    this.jobs.set(agentId, (this.jobs.get(agentId) ?? 0) + 1);
    let isEnded = false;
    return () => {
      if (isEnded) return;
      isEnded = true;
      const remaining = (this.jobs.get(agentId) ?? 1) - 1;
      if (remaining <= 0) this.jobs.delete(agentId);
      else this.jobs.set(agentId, remaining);
    };
  }

  /** Whether a round of a chat of the agent runs now. */
  public isWorking(agentId: string): boolean {
    return (this.jobs.get(agentId) ?? 0) > 0;
  }

  /**
   * Waits until the agent works in no chat.
   *
   * @returns Whether it is free; `false` after the longest wait.
   */
  public async whenIdle(waiting: AgentChatIdleWait): Promise<boolean> {
    const maximum = waiting.maximumMilliseconds ?? WAIT_MAXIMUM_MILLISECONDS;
    const wait = waiting.wait ?? defaultWait;
    for (let waited = 0; waited <= maximum; waited += POLL_MILLISECONDS) {
      if (!waiting.isBusy()) return true;
      await wait(POLL_MILLISECONDS);
    }
    return !waiting.isBusy();
  }
}
