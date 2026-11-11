import { createHash, randomBytes, randomUUID } from "node:crypto";

import { RuntimeToolDeniedError } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { logDiagnostic } from "@/backend/logging/Logger";
import { answerPlanBridgeMessage } from "@/backend/service/agents/bridge/PlanBridgeProtocol";
import { countCharacters } from "@/definition/Wiki";

import {
  PICA_TOOL_OUTCOME,
  PICA_WIKI_CONTENT_CHARACTERS,
} from "../PicaToolSchemas";
import { isValidPicaToolImage } from "../PicaToolImageValidation";

import type { Tool } from "@modelcontextprotocol/server";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { PlanBridgeToolResult } from "@/backend/service/agents/bridge/PlanBridgeProtocol";
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
  /**
   * Issues the credential of an MCP client for the whole job, replacing an
   * earlier one; it lists the catalog and calls a tool only through the
   * binding of the running turn, so it admits no call between turns.
   */
  readonly openMcp: () => PicaBridgeDescriptor;
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
  /** The MCP session of an `initialize`; the credential alone binds later requests. */
  readonly sessionId?: string;
}

interface Binding {
  readonly owner: PicaBridgeOwner;
  turn: PicaBridgeTurn;
  readonly key: string;
  isPending: boolean;
  readonly calls: Map<Promise<PicaBridgeNativeOutcome>, number>;
}

/** The MCP access of one job: its catalog and the binding of its running turn. */
interface McpAccess {
  readonly owner: PicaBridgeOwner;
  readonly binding: () => Binding | null;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refused(error: string): PicaToolOutcome {
  return { ok: false, result: null, error };
}

function mcpTool(tool: RuntimeToolDescription): Tool {
  return {
    name: tool.id,
    description: tool.description,
    inputSchema: { ...tool.inputSchema, type: "object" },
  };
}

// The outcome travels as the text result; staged images are named by their attachments.
function mcpResult(outcome: PicaBridgeOutcome): PlanBridgeToolResult {
  const content = [{ type: "text", text: JSON.stringify(outcome) }] as const;
  return outcome.ok ? { content } : { content, isError: true };
}

function fields(input: unknown): Readonly<Record<string, unknown>> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

/** Refuses wiki content beyond the Pica limit before the tool runs, or returns `null`. */
function oversizedWikiContent(
  name: string,
  input: unknown,
): PicaToolOutcome | null {
  if (name !== "wiki_page_create" && name !== "wiki_page_set_content")
    return null;
  const content = fields(input)?.content;
  if (
    typeof content !== "string" ||
    countCharacters(content) <= PICA_WIKI_CONTENT_CHARACTERS
  )
    return null;
  return {
    ok: false,
    error: "INVALID_REQUEST",
    result: JSON.stringify({
      result: null,
      details: {
        reason: "content_too_long",
        maxLength: PICA_WIKI_CONTENT_CHARACTERS,
      },
    }),
  };
}

/** A parsed bridge request: the catalog, or one tool call. */
type BridgeAction =
  | { readonly action: "catalog" }
  | {
      readonly action: "call" | "native_call";
      readonly name: string;
      readonly input: unknown;
    };

/** Reads the JSON body of a bridge request; `null` for anything malformed. */
function readAction(body: string): BridgeAction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const input = fields(parsed);
  if (input?.action === "catalog") return { action: "catalog" };
  if (
    (input?.action !== "call" && input?.action !== "native_call") ||
    typeof input.name !== "string"
  )
    return null;
  if (
    input.action === "native_call" &&
    (!/^[A-Za-z0-9_-]{1,100}$/u.test(input.name) ||
      !Object.keys(input).every((key) =>
        ["action", "name", "arguments"].includes(key),
      ))
  )
    return null;
  return {
    action: input.action,
    name: input.name,
    input: input.arguments ?? {},
  };
}

/** Reports the end of one call to the journal. */
type CallReport = (
  status: "completed" | "failed",
  error: string | null,
) => void;

/** Provides the Pica catalog and validated tool calls to an active job turn. */
export class PicaBridge {
  private readonly url: string;
  private readonly bindings = new Map<string, Binding>();
  private readonly mcpAccesses = new Map<string, McpAccess>();

  public constructor(url: string) {
    this.url = url;
  }

  /** Opens a lease with no active credential. */
  public open(owner: PicaBridgeOwner): PicaBridgeLease {
    let current: Binding | null = null;
    let mcpKey: string | null = null;
    const calls = new Map<Promise<PicaBridgeNativeOutcome>, number>();
    const revoke = (): void => {
      if (current) this.bindings.delete(current.key);
      current = null;
    };
    const revokeMcp = (): void => {
      if (mcpKey) this.mcpAccesses.delete(mcpKey);
      mcpKey = null;
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
      openMcp: () => {
        revokeMcp();
        const token = randomBytes(32).toString("base64url");
        mcpKey = digest(token);
        this.mcpAccesses.set(mcpKey, { owner, binding: () => current });
        return { url: this.url, authorization: `Bearer ${token}` };
      },
      close: () => {
        revoke();
        revokeMcp();
      },
    };
  }

  /** Authenticates before reading input and handles one catalog or call request. */
  public async handle(request: PicaBridgeRequest): Promise<PicaBridgeResponse> {
    const binding = this.authenticate(request.authorization);
    if (!binding) {
      const access = this.authenticateMcp(request.authorization);
      return access
        ? this.handleMcp(access, request)
        : { status: 401, body: null };
    }
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
    const parsed = readAction(body);
    if (parsed === null) return { status: 400, body: null };
    if (parsed.action === "catalog")
      return { status: 200, body: { tools: binding.owner.catalog } };
    const pending = this.call(binding, parsed.name, parsed.input, {
      includeImages: parsed.action === "native_call",
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

  private authenticateMcp(authorization: string | null): McpAccess | null {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
    return match ? (this.mcpAccesses.get(digest(match[1])) ?? null) : null;
  }

  /**
   * Answers one MCP message of a job's client (Streamable HTTP, JSON only).
   *
   * @remarks
   * Listing needs no running turn, because the catalog belongs to the job.
   * A call runs through the binding of the running turn exactly like a call
   * of the native route, with the same authorization, journal and image
   * staging; between turns it is refused.
   */
  private async handleMcp(
    access: McpAccess,
    request: PicaBridgeRequest,
  ): Promise<PicaBridgeResponse> {
    if (request.method === "DELETE") return { status: 200, body: null };
    if (request.method !== "POST") return { status: 405, body: null };
    const body = await request.readBody();
    if (
      body === null ||
      Buffer.byteLength(body, "utf8") > PICA_BRIDGE_MAXIMUM_BODY
    )
      return { status: 413, body: null };
    return answerPlanBridgeMessage(body, {
      serverName: "pages-pica",
      list: () => Promise.resolve(access.owner.catalog.map(mcpTool)),
      call: (name, input) =>
        this.callMcp(access, { name, input, signal: request.signal }),
    });
  }

  private async callMcp(
    access: McpAccess,
    request: {
      readonly name: string;
      readonly input: unknown;
      readonly signal?: AbortSignal;
    },
  ): Promise<PlanBridgeToolResult> {
    const binding = access.binding();
    if (!binding || !this.isCurrent(binding))
      return mcpResult(refused("TURN_INACTIVE"));
    const pending = this.call(binding, request.name, request.input, {
      includeImages: false,
      signal: request.signal,
    });
    binding.calls.set(pending, binding.turn.answerTurn);
    try {
      return mcpResult(await pending);
    } finally {
      binding.calls.delete(pending);
    }
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
    const report: CallReport = (status, error) =>
      owner.onTool({ callId, tool, status, error, ...privileged });
    const fail = (error: string): PicaToolOutcome => {
      report("failed", error);
      return refused(error);
    };
    const outcome = await this.invoke(binding, name, input, options.signal);
    if (!isCurrent()) return fail("TURN_INACTIVE");
    const { images, ...answer } = outcome;
    if (
      options.includeImages &&
      images?.some((image) => !isValidPicaToolImage(image))
    )
      return fail("IMAGE_INVALID");
    const staged = await this.stage(binding, images, isCurrent);
    if (typeof staged === "string") return fail(staged);
    report(answer.ok ? "completed" : "failed", answer.ok ? null : answer.error);
    return {
      ...answer,
      ...(staged ? { attachments: staged.attachments } : {}),
      ...(options.includeImages && images?.length ? { images } : {}),
    };
  }

  /**
   * Stages the images of a result for the turn.
   *
   * @returns The staged images, `null` without images, or the error of a call
   * that failed or whose turn ended meanwhile; staged images are rolled back then.
   */
  private async stage(
    binding: Binding,
    images: PicaToolOutcome["images"],
    isCurrent: () => boolean,
  ): Promise<PicaStagedImages | null | string> {
    let staged: PicaStagedImages | null = null;
    try {
      if (images?.length)
        staged = await binding.owner.onImages(
          binding.turn.answerTurn,
          images,
          isCurrent,
        );
    } catch {
      return isCurrent() ? "IMAGE_STAGING_FAILED" : "TURN_INACTIVE";
    }
    if (isCurrent()) return staged;
    try {
      await staged?.rollback();
    } catch {
      return "IMAGE_ROLLBACK_FAILED";
    }
    return "TURN_INACTIVE";
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
      const oversized = oversizedWikiContent(name, input);
      if (oversized) return oversized;
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
