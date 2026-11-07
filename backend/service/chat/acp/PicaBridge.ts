import { createHash, randomBytes, randomUUID } from "node:crypto";

import { RuntimeToolDeniedError } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { logDiagnostic } from "@/backend/logging/Logger";

import { PICA_TOOL_OUTCOME } from "../PicaToolSchemas";
import { isValidPicaToolImage } from "../PicaToolImageValidation";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type {
  RuntimeToolDescription,
  RuntimeToolRegistry,
} from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { ChatJobToolEvent } from "@/definition/ChatJob";
import type { ChatAttachment } from "@/definition/Chat";
import type { PicaToolOutcome } from "../PicaToolSchemas";

/** The maximum size of a tool request body. */
export const PICA_BRIDGE_MAXIMUM_BODY = 1024 * 1024;

/** The registry and server-owned identity of an active human turn. */
export interface PicaBridgeTurn {
  readonly id: string;
  readonly answerTurn: number;
  readonly tools: RuntimeToolRegistry;
  readonly context: RuntimeExecutionContext;
}

/** The server-owned job and callbacks associated with a lease. */
export interface PicaBridgeOwner {
  readonly jobId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly catalog: readonly RuntimeToolDescription[];
  readonly onTool: (event: Omit<ChatJobToolEvent, "kind">) => void;
  readonly onImages: (
    turn: number,
    images: NonNullable<PicaToolOutcome["images"]>,
    isCurrent: () => boolean,
  ) => Promise<PicaStagedImages>;
}

/** Staged attachments and the rollback for this one invocation. */
export interface PicaStagedImages {
  readonly attachments: readonly ChatAttachment[];
  readonly rollback: () => Promise<void>;
}

/** Tool result with safe attachment metadata and no image bytes. */
export type PicaBridgeOutcome = Omit<PicaToolOutcome, "images"> & {
  readonly attachments?: readonly ChatAttachment[];
};

/** Native tool response; images stay separate from the text result and journal. */
export type PicaBridgeNativeOutcome = PicaBridgeOutcome & {
  readonly images?: PicaToolOutcome["images"];
};

/** A turn credential and the endpoint that accepts it. */
export interface PicaBridgeDescriptor {
  readonly url: string;
  readonly authorization: string;
}

/** Access belonging to one job; rebinding revokes the previous turn credential. */
export interface PicaBridgeLease {
  readonly setTurn: (
    turn: PicaBridgeTurn | null,
  ) => PicaBridgeDescriptor | null;
  /** Issues a credential that refuses calls until its turn is determined. */
  readonly reserveTurn: (turn: PicaBridgeTurn) => PicaBridgeDescriptor | null;
  /** Activates only the outstanding reservation for the same human message. */
  readonly activateTurn: (turn: PicaBridgeTurn) => boolean;
  /** Waits for calls admitted before a credential was revoked. */
  readonly settle: (turn?: number) => Promise<void>;
  readonly close: () => void;
}

/** An HTTP request whose body is read only after authentication. */
export interface PicaBridgeRequest {
  readonly method: string;
  readonly authorization: string | null;
  readonly signal?: AbortSignal;
  readonly readBody: () => Promise<string | null>;
}

/** The HTTP status and JSON response, or an empty response. */
export interface PicaBridgeResponse {
  readonly status: number;
  readonly body: unknown;
}

interface Binding {
  readonly owner: PicaBridgeOwner;
  turn: PicaBridgeTurn;
  readonly key: string;
  isPending: boolean;
  readonly calls: Map<Promise<PicaBridgeNativeOutcome>, number>;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refused(error: string): PicaToolOutcome {
  return { ok: false, result: null, error };
}

function fields(input: unknown): Readonly<Record<string, unknown>> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

/** Provides the Pica catalog and validated tool calls to an active job turn. */
export class PicaBridge {
  private readonly url: string;
  private readonly bindings = new Map<string, Binding>();

  public constructor(url: string) {
    this.url = url;
  }

  /** Opens a lease with no active credential. */
  public open(owner: PicaBridgeOwner): PicaBridgeLease {
    let current: Binding | null = null;
    const calls = new Map<Promise<PicaBridgeNativeOutcome>, number>();
    const revoke = (): void => {
      if (current) this.bindings.delete(current.key);
      current = null;
    };
    const issue = (
      turn: PicaBridgeTurn | null,
      isPending: boolean,
    ): PicaBridgeDescriptor | null => {
      revoke();
      if (!turn || !this.owns(owner, turn)) return null;
      const token = randomBytes(32).toString("base64url");
      const key = digest(token);
      current = { owner, turn, key, isPending, calls };
      this.bindings.set(key, current);
      return { url: this.url, authorization: `Bearer ${token}` };
    };
    return {
      setTurn: (turn) => issue(turn, false),
      reserveTurn: (turn) => issue(turn, true),
      activateTurn: (turn) => {
        if (
          !current ||
          !current.isPending ||
          current.turn.id !== turn.id ||
          !this.owns(owner, turn)
        )
          return false;
        current.turn = turn;
        current.isPending = false;
        return true;
      },
      settle: async (turn) => {
        for (;;) {
          const selected = [...calls]
            .filter(
              ([, answerTurn]) => turn === undefined || answerTurn === turn,
            )
            .map(([call]) => call);
          if (selected.length === 0) return;
          await Promise.allSettled(selected);
        }
      },
      close: revoke,
    };
  }

  /** Authenticates before reading input and handles one catalog or call request. */
  public async handle(request: PicaBridgeRequest): Promise<PicaBridgeResponse> {
    const binding = this.authenticate(request.authorization);
    if (!binding) return { status: 401, body: null };
    if (binding.turn.context.signal.aborted) return { status: 401, body: null };
    if (binding.isPending)
      return { status: 409, body: { error: "TURN_PENDING" } };
    if (request.method !== "POST") return { status: 405, body: null };
    const body = await request.readBody();
    if (
      body === null ||
      Buffer.byteLength(body, "utf8") > PICA_BRIDGE_MAXIMUM_BODY
    )
      return { status: 413, body: null };
    if (!this.isCurrent(binding)) return { status: 401, body: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { status: 400, body: null };
    }
    const input = fields(parsed);
    if (input?.action === "catalog")
      return { status: 200, body: { tools: binding.owner.catalog } };
    if (
      (input?.action !== "call" && input?.action !== "native_call") ||
      typeof input.name !== "string"
    )
      return { status: 400, body: null };
    if (
      input.action === "native_call" &&
      (!/^[A-Za-z0-9_-]{1,100}$/u.test(input.name) ||
        !Object.keys(input).every((key) =>
          ["action", "name", "arguments"].includes(key),
        ))
    )
      return { status: 400, body: null };
    const pending = this.call(binding, input.name, input.arguments ?? {}, {
      includeImages: input.action === "native_call",
      signal: request.signal,
    });
    binding.calls.set(pending, binding.turn.answerTurn);
    try {
      return { status: 200, body: await pending };
    } finally {
      binding.calls.delete(pending);
    }
  }

  private authenticate(authorization: string | null): Binding | null {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
    return match ? (this.bindings.get(digest(match[1])) ?? null) : null;
  }

  private isCurrent(binding: Binding): boolean {
    return (
      this.bindings.get(binding.key) === binding &&
      !binding.isPending &&
      !binding.turn.context.signal.aborted
    );
  }

  private owns(owner: PicaBridgeOwner, turn: PicaBridgeTurn): boolean {
    return (
      turn.context.runId === owner.jobId &&
      turn.context.userId === owner.userId &&
      turn.context.sessionId === owner.sessionId &&
      turn.id.length > 0 &&
      Number.isSafeInteger(turn.answerTurn) &&
      turn.answerTurn > 0 &&
      !turn.context.signal.aborted
    );
  }

  private async call(
    binding: Binding,
    name: string,
    input: unknown,
    options: { readonly includeImages: boolean; readonly signal?: AbortSignal },
  ): Promise<PicaBridgeNativeOutcome> {
    const isCurrent = (): boolean =>
      this.isCurrent(binding) && !options.signal?.aborted;
    if (!isCurrent()) return refused("TURN_INACTIVE");
    const { turn, owner } = binding;
    const callId = randomUUID();
    const tool = name.slice(0, 100);
    const privileged =
      turn.tools.accessOf(name) === "administrator"
        ? { isPrivileged: true }
        : {};
    owner.onTool({
      callId,
      tool,
      status: "running",
      error: null,
      ...privileged,
    });
    const outcome = await this.invoke(binding, name, input, options.signal);
    if (!isCurrent()) {
      owner.onTool({
        callId,
        tool,
        status: "failed",
        error: "TURN_INACTIVE",
        ...privileged,
      });
      return refused("TURN_INACTIVE");
    }
    const { images, ...answer } = outcome;
    if (
      options.includeImages &&
      images?.some((image) => !isValidPicaToolImage(image))
    ) {
      owner.onTool({
        callId,
        tool,
        status: "failed",
        error: "IMAGE_INVALID",
        ...privileged,
      });
      return refused("IMAGE_INVALID");
    }
    let staged: PicaStagedImages | null = null;
    try {
      if (images?.length)
        staged = await owner.onImages(turn.answerTurn, images, isCurrent);
    } catch {
      const error = isCurrent() ? "IMAGE_STAGING_FAILED" : "TURN_INACTIVE";
      owner.onTool({ callId, tool, status: "failed", error, ...privileged });
      return refused(error);
    }
    if (!isCurrent()) {
      if (staged) {
        try {
          await staged.rollback();
        } catch {
          owner.onTool({
            callId,
            tool,
            status: "failed",
            error: "IMAGE_ROLLBACK_FAILED",
            ...privileged,
          });
          return refused("IMAGE_ROLLBACK_FAILED");
        }
      }
      owner.onTool({
        callId,
        tool,
        status: "failed",
        error: "TURN_INACTIVE",
        ...privileged,
      });
      return refused("TURN_INACTIVE");
    }
    owner.onTool({
      callId,
      tool,
      status: answer.ok ? "completed" : "failed",
      error: answer.ok ? null : answer.error,
      ...privileged,
    });
    return {
      ...answer,
      ...(staged ? { attachments: staged.attachments } : {}),
      ...(options.includeImages && images?.length ? { images } : {}),
    };
  }

  private async invoke(
    binding: Binding,
    name: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<PicaToolOutcome> {
    const { turn } = binding;
    const context: RuntimeExecutionContext = {
      ...turn.context,
      signal: signal
        ? AbortSignal.any([turn.context.signal, signal])
        : turn.context.signal,
      authorize: async () => {
        if (!this.isCurrent(binding) || signal?.aborted)
          throw new ChatError("accessDenied");
        await turn.context.authorize();
        if (!this.isCurrent(binding) || signal?.aborted)
          throw new ChatError("accessDenied");
      },
    };
    try {
      if (!this.isCurrent(binding)) return refused("TURN_INACTIVE");
      const invoked = await turn.tools.invoke(name, input, context);
      if (invoked === null) return refused("UNKNOWN_TOOL");
      if (!invoked.isValid) return refused("INVALID_ARGUMENTS");
      return PICA_TOOL_OUTCOME.parse(invoked.output);
    } catch (error: unknown) {
      if (error instanceof RuntimeToolDeniedError)
        return refused("ADMIN_REQUIRED");
      if (turn.context.signal.aborted || signal?.aborted)
        return refused("CANCELLED");
      if (error instanceof ChatError || error instanceof AgentExecutionError)
        return refused(error.code === "accessDenied" ? "FORBIDDEN" : "FAILED");
      logDiagnostic(
        "PicaBridge",
        "error",
        "[pages] A Pica bridge call failed.",
      );
      return refused("FAILED");
    }
  }
}
