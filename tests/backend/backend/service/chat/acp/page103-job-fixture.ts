import { vi } from "vitest";

import { PicaAcpJob } from "@/backend/service/chat/acp/PicaAcpJob";
import { picaAcpRunner } from "@/backend/service/chat/acp/PicaAcpRunners";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";

import { deferred } from "../../agents/page81-resource-fixture";
import { ASSIGNMENT, FIRST, OWNER, SESSION } from "../page48-chat-fixture";

import type {
  AcpSessionListener,
  AcpSteerOutcome,
} from "@/backend/agents/acp/AcpChat";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { PicaBridgeTurn } from "@/backend/service/chat/acp/PicaBridge";
import type { PicaAcpJobDependencies } from "@/backend/service/chat/acp/PicaAcpJob";
import type { PicaAcpProvider } from "@/backend/service/chat/acp/PicaAcpRunners";
import type { StoredChatMessage } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ChatJobEvent } from "@/definition/ChatJob";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";

/** A completed fake runner turn; no provider, transport or child process is used. */
export function completedTurn(output = "Answer"): PlanSessionTurn {
  return {
    output,
    sessionId: "native-session",
    failure: null,
    errorCode: null,
    endedAt: "2026-10-18",
    permissionDenials: 0,
    effective: {},
    events: [],
  };
}

/** Real job, turn registry and journal with all persistence and runner boundaries mocked. */
export class PicaJobWorld {
  public readonly controller = new AbortController();
  public readonly events: ChatJobEvent[] = [];
  public readonly messages: StoredChatMessage[] = [];
  public readonly tools = vi.fn<PicaAcpJobDependencies["tools"]["run"]>(
    async () => ({ ok: true, result: {} }),
  );
  public readonly finish = vi.fn<PicaAcpJobDependencies["jobs"]["finish"]>(
    async () => undefined,
  );
  public readonly close = vi.fn(async () => ({
    exit: null,
    endedAt: "2026-10-18",
    leftovers: 0,
    isConfirmed: true,
  }));
  public readonly steers = {
    update: vi.fn(async () => undefined),
    select: vi.fn(async () => undefined),
    answer: vi.fn(async () => undefined),
  };
  public readonly authorize = vi.fn(async () => undefined);
  public readonly opened = vi.fn<PicaAcpJobDependencies["plans"]["open"]>(
    async (input, signal, observer) => {
      this.listener = input.chat?.listener ?? null;
      this.resumeSessionId = input.chat?.resumeSessionId ?? null;
      this.listener?.initialized?.(true, {});
      observer.identified("native-session");
      signal.addEventListener(
        "abort",
        () => this.first.resolve({ ...completedTurn(), failure: "cancelled" }),
        {
          once: true,
        },
      );
      return {
        turn: this.first.promise,
        close: this.close,
        steer: () => this.steer(),
        next: () => this.next(),
      };
    },
  );
  public readonly job: PicaAcpJob;
  public listener: AcpSessionListener | null = null;
  public resumeSessionId: string | null = null;
  private binding: PicaBridgeTurn | null = null;
  private readonly first = deferred<PlanSessionTurn>();

  public constructor(
    provider: PicaAcpProvider = "codex_cli",
    resumeSessionId: string | null = null,
  ) {
    const agent = {
      ...ASSIGNMENT,
      connection: { ...ASSIGNMENT.connection, provider },
    };
    const runner = picaAcpRunner(agent);
    this.job = new PicaAcpJob(
      {
        plans: { open: this.opened },
        jobs: {
          append: async (jobId, sequence, event) => {
            this.events.push(event);
          },
          finish: this.finish,
          saveContext: async () => undefined,
          saveTurn: async () => undefined,
        },
        steers: this.steers,
        acpSessions: { save: async () => undefined },
        messages: {
          append: async (userId, sessionId, input) => {
            const message = {
              ...input,
              id: `message-${this.messages.length}`,
              createdAt: "2026-10-18",
            };
            this.messages.push(message);
            return message;
          },
          messages: async () => this.messages,
        },
        attachments: {
          readText: async () => "",
          readBytes: async () => Buffer.from(""),
        },
        bridge: {
          open: () => ({
            server: {
              type: "http",
              name: "pages",
              url: "http://pages.test/bridge",
              headers: [],
            },
            setTurn: (turn) => {
              this.binding = turn;
            },
            close: () => {
              this.binding = null;
            },
          }),
        },
        tools: { run: this.tools },
        access: {
          requireUser: this.authorize,
        },
        sessions: {
          require: async () => SESSION,
          confirmationWord: async () => "LÖSCHEN",
        },
      },
      {
        id: "job",
        actor: OWNER,
        sessionId: FIRST,
        agent,
        run: { runner, options: runner.runOptions(agent) },
        directory: "/synthetic",
        message: { id: "question", text: "Read", attachments: [] },
        brief: {
          instructions: "Synthetic",
          prompt: {
            personName: "Owner",
            interfaceLanguage: "de",
            today: "2026-10-18",
            history: [],
          },
        },
        resumeSessionId,
        gate: (task) => task(),
      },
    );
  }

  public steer: () => Promise<AcpSteerOutcome> = async () => "injected";
  public next: () => Promise<PlanSessionTurn> = async () => {
    this.listener?.prompted(null);
    return completedTurn("Follow-up answer");
  };

  /** Starts the real job and waits until the fake runner is ready for steering. */
  public async start(): Promise<{ readonly completion: Promise<void> }> {
    const completion = this.job.run(this.controller.signal);
    await vi.waitFor(() => {
      if (
        !this.events.some(
          (event) => event.kind === "phase" && event.phase === "running",
        )
      )
        throw new Error("Not ready");
    });
    return { completion };
  }

  /** Calls the actual turn-bound native registry used by the ACP bridge. */
  public async call(): Promise<PicaToolOutcome> {
    if (!this.binding) throw new Error("No active turn");
    const invoked = await this.binding.tools.invoke(
      "projects_list",
      {},
      this.binding.context,
    );
    if (!invoked?.isValid) throw new Error("Invalid fake tool input");
    return PICA_TOOL_OUTCOME.parse(invoked.output);
  }

  /** Ends the first prompt, at the same synchronous boundary as ACP's prompt response. */
  public complete(result: PlanSessionTurn = completedTurn()): void {
    this.listener?.prompted(null);
    this.first.resolve(result);
  }

  /** Sends partial text without completing the prompt. */
  public text(content: string): void {
    this.listener?.update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: content },
    });
  }

  /** Reports Codex's activity for an adapter-started follow-up. */
  public thread(isActive: boolean): void {
    this.listener?.update({
      sessionUpdate: "session_info_update",
      _meta: {
        codex: { threadStatus: { type: isActive ? "active" : "idle" } },
      },
    });
  }
}
