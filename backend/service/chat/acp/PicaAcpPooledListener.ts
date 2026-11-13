import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";

import type {
  AgentCapabilities,
  PromptCapabilities,
  SessionUpdate,
  Usage,
} from "@agentclientprotocol/sdk";
import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type { PicaCodexListener } from "@/backend/agents/acp/PicaCodexRequests";

interface Negotiated {
  readonly canSteer: boolean;
  readonly capabilities: PromptCapabilities | null | undefined;
}

/**
 * The listener of a chat session that outlives its jobs (PAGE-335).
 *
 * @remarks
 * The native session reads its listener once, when it starts. This one
 * passes every update to the job that holds the session now and drops the
 * updates between jobs. The adapter negotiates steering and announces its
 * capabilities only once per process, so a job that takes the session over
 * receives both again when it attaches.
 */
export class PicaAcpPooledListener implements AcpSessionListener {
  public readonly picaCodex: PicaCodexListener | undefined;
  public readonly picaHelper: (() => string | null) | undefined;
  private current: AcpSessionListener | null;
  private negotiated: Negotiated | null = null;
  private announcement: {
    readonly capabilities: AgentCapabilities | null | undefined;
  } | null = null;

  /** @param first - The listener of the job that starts the session. */
  public constructor(first: AcpSessionListener) {
    this.current = first;
    this.picaCodex = first.picaCodex
      ? {
          catalog: () => this.requirePicaCodex().catalog(),
          capture: () => this.requirePicaCodex().capture(),
        }
      : undefined;
    this.picaHelper = first.picaHelper
      ? () => this.current?.picaHelper?.() ?? null
      : undefined;
  }

  /** Hands the session to the listener of the next job and repeats what the adapter negotiated. */
  public attach(listener: AcpSessionListener): void {
    this.current = listener;
    if (this.negotiated)
      listener.initialized?.(
        this.negotiated.canSteer,
        this.negotiated.capabilities,
      );
    if (this.announcement) listener.announced?.(this.announcement.capabilities);
  }

  /** Lets the session rest: nothing reaches a job until the next one attaches. */
  public detach(): void {
    this.current = null;
  }

  /** Keeps the negotiated steering contract for later jobs. */
  public readonly initialized = (
    canSteer: boolean,
    capabilities: PromptCapabilities | null | undefined,
  ): void => {
    this.negotiated = { canSteer, capabilities };
    this.current?.initialized?.(canSteer, capabilities);
  };

  /** Keeps the announced capabilities for later jobs. */
  public readonly announced = (
    capabilities: AgentCapabilities | null | undefined,
  ): void => {
    this.announcement = { capabilities };
    this.current?.announced?.(capabilities);
  };

  /** Passes an update to the job that holds the session. */
  public readonly update = (update: SessionUpdate): void => {
    this.current?.update(update);
  };

  /** Passes the usage of a prompt to the job that holds the session. */
  public readonly prompted = (
    usage: Usage | null,
    isContinued?: boolean,
  ): void => {
    this.current?.prompted(usage, isContinued);
  };

  /** Tells the job that holds the session that the connection ended. */
  public readonly closed = (): void => {
    this.current?.closed();
  };

  /** Waits for the journal writes of the job that holds the session. */
  public readonly drained = async (): Promise<void> => {
    await this.current?.drained?.();
  };

  private requirePicaCodex(): PicaCodexListener {
    const listener = this.current?.picaCodex;
    if (!listener) throw new PicaAcpJobError("general");
    return listener;
  }
}
