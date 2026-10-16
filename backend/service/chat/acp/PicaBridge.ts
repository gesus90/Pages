import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ChatError } from "@/backend/error/ChatErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { PICA_TOOL_OUTCOME } from "../PicaToolSchemas";
import { answerPicaBridgeMessage } from "./PicaBridgeProtocol";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type {
  RuntimeToolDescription,
  RuntimeToolRegistry,
} from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { ChatJobToolEvent } from "@/definition/ChatJob";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaBridgeResponse } from "./PicaBridgeProtocol";

/** The largest MCP message the bridge reads; a tool call is a few kilobytes. */
export const PICA_BRIDGE_MAXIMUM_BODY = 1024 * 1024;

/** The tools of the turn that runs now, bound to its person, conversation and job. */
export interface PicaBridgeTurn {
  readonly tools: RuntimeToolRegistry;
  readonly context: RuntimeExecutionContext;
}

/** The job a bridge token belongs to. */
export interface PicaBridgeOwner {
  readonly jobId: string;
  /** The tool names and schemas the job offers; the same in every turn. */
  readonly catalog: readonly RuntimeToolDescription[];
  /** Receives the status of every call; parameters and results stay out. */
  readonly onTool: (event: Omit<ChatJobToolEvent, "kind">) => void;
}

/** The bridge access of one running job. */
export interface PicaBridgeLease {
  /** The MCP server entry the agent session connects to; it carries the token. */
  readonly server: McpServer;
  /** Binds calls to a turn; `null` refuses every call until the next turn. */
  readonly setTurn: (turn: PicaBridgeTurn | null) => void;
  /** Invalidates the token. */
  readonly close: () => void;
}

/** One HTTP request to the bridge; the body is read only after the token was accepted. */
export interface PicaBridgeRequest {
  readonly method: string;
  readonly authorization: string | null;
  /** The body, or `null` when it is declared larger than {@link PICA_BRIDGE_MAXIMUM_BODY}. */
  readonly readBody: () => Promise<string | null>;
}

interface Binding {
  readonly owner: PicaBridgeOwner;
  turn: PicaBridgeTurn | null;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refused(error: string): PicaToolOutcome {
  return { ok: false, result: null, error };
}

/**
 * The Pica tool bridge for Codex over ACP (PAGE-68).
 *
 * @remarks
 * codex-acp reaches MCP servers over HTTP, so Pages offers the five Pica tools
 * as one MCP endpoint. Every job gets a random token that exists only in
 * memory and reaches the adapter only inside `session/new`. A call runs only
 * while a turn of that job is active, through the same tool registry and
 * executor as the API path, which reauthorizes the person, the conversation
 * and the connection before the handler runs. There is no other write path.
 */
export class PicaBridge {
  private readonly url: string;
  private readonly bindings = new Map<string, Binding>();

  /**
   * Creates the bridge of this server.
   *
   * @param url - Where local agent processes reach the bridge endpoint.
   */
  public constructor(url: string) {
    this.url = url;
  }

  /** Issues the token of a job. */
  public open(owner: PicaBridgeOwner): PicaBridgeLease {
    const token = randomBytes(32).toString("base64url");
    const key = digest(token);
    const binding: Binding = { owner, turn: null };
    this.bindings.set(key, binding);
    return {
      server: {
        type: "http",
        name: "pages",
        url: this.url,
        headers: [{ name: "Authorization", value: `Bearer ${token}` }],
      },
      setTurn: (turn) => {
        binding.turn = turn;
      },
      close: () => {
        binding.turn = null;
        this.bindings.delete(key);
      },
    };
  }

  /** Answers one HTTP request of an agent session. */
  public async handle(request: PicaBridgeRequest): Promise<PicaBridgeResponse> {
    // No server stream: the client falls back to plain request and response.
    if (request.method === "GET") return { status: 405, body: null };
    const binding = this.authenticate(request.authorization);
    if (binding === null) return { status: 401, body: null };
    if (request.method === "DELETE") return { status: 200, body: null };
    if (request.method !== "POST") return { status: 405, body: null };
    const body = await request.readBody();
    if (body === null || body.length > PICA_BRIDGE_MAXIMUM_BODY)
      return { status: 413, body: null };
    return answerPicaBridgeMessage(body, {
      catalog: binding.owner.catalog,
      call: (name, input) => this.call(binding, name, input),
    });
  }

  private authenticate(authorization: string | null): Binding | null {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
    return match ? (this.bindings.get(digest(match[1])) ?? null) : null;
  }

  private async call(
    binding: Binding,
    name: string,
    input: unknown,
  ): Promise<PicaToolOutcome> {
    const turn = binding.turn;
    if (turn === null) return refused("TURN_INACTIVE");
    const callId = randomUUID();
    const tool = name.slice(0, 100);
    binding.owner.onTool({ callId, tool, status: "running", error: null });
    const outcome = await this.invoke(turn, name, input);
    binding.owner.onTool({
      callId,
      tool,
      status: outcome.ok ? "completed" : "failed",
      error: outcome.ok ? null : outcome.error,
    });
    return outcome;
  }

  private async invoke(
    turn: PicaBridgeTurn,
    name: string,
    input: unknown,
  ): Promise<PicaToolOutcome> {
    try {
      const invoked = await turn.tools.invoke(name, input, turn.context);
      if (invoked === null) return refused("UNKNOWN_TOOL");
      if (!invoked.isValid) return refused("INVALID_ARGUMENTS");
      return PICA_TOOL_OUTCOME.parse(invoked.output);
    } catch (error: unknown) {
      if (turn.context.signal.aborted) return refused("CANCELLED");
      if (error instanceof ChatError || error instanceof TextAssistantError)
        return refused(error.code === "accessDenied" ? "FORBIDDEN" : "FAILED");
      // Only the tool and the kind of error are logged, never arguments or results.
      console.error(
        "[pages] A Pica bridge call failed.",
        name.slice(0, 100),
        error instanceof Error ? error.name : typeof error,
      );
      return refused("FAILED");
    }
  }
}
