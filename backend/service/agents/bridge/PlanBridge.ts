import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";
import { READ_ANNOTATIONS } from "@/definition/AgentTools/ToolDefinition";
import {
  PAGES_AGENT_LIMITS,
  agentEnvelopeLimit,
} from "@/definition/PagesAgentOperations";

import {
  PlanOperationFailure,
  planOperationFailure,
} from "./PlanBridgeFailure";
import {
  PlanBridgeRpcError,
  answerPlanBridgeMessage,
} from "./PlanBridgeProtocol";

import type { Tool } from "@modelcontextprotocol/server";
import type { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PlanBridgeGrants } from "./PlanBridgeGrants";
import type {
  PlanBridgeResponse,
  PlanBridgeToolResult,
} from "./PlanBridgeProtocol";

/** The largest MCP message the bridge reads; a plan edit stays far below it. */
export const PLAN_BRIDGE_MAXIMUM_BODY = PAGES_AGENT_LIMITS.wikiEnvelopeBytes;

/** The tool that lists project names; it has no entry in the shared catalog. */
const LIST_PROJECT_NAMES_TOOL = {
  name: "list_project_names",
  title: "List project names",
  description:
    "Lists the names of the Pages projects the connected account may see. Returns names only, without identifiers, descriptions or content.",
  inputSchema: { type: "object", additionalProperties: false },
  annotations: READ_ANNOTATIONS,
} as const satisfies Tool;

/** One HTTP request to the bridge; the body is read only after the token was accepted. */
export interface PlanBridgeRequest {
  readonly method: string;
  readonly authorization: string | null;
  /** The body, or `null` when it exceeds {@link PLAN_BRIDGE_MAXIMUM_BODY}. */
  readonly readBody: () => Promise<string | null>;
}

function authorizationFailed(): PlanBridgeRpcError {
  return new PlanBridgeRpcError(-32603, "Pages authorization failed.");
}

function textResult(value: unknown, isError: boolean): PlanBridgeToolResult {
  const content = [{ type: "text", text: JSON.stringify(value) }] as const;
  return isError ? { content, isError: true } : { content };
}

function failureResult(failure: PlanOperationFailure): PlanBridgeToolResult {
  return textResult(
    {
      code: failure.code,
      ...(failure.code === "NOT_FOUND" ? { message: failure.message } : {}),
      ...(failure.details === undefined ? {} : { details: failure.details }),
    },
    true,
  );
}

/**
 * The tools of an agent plan step as one MCP endpoint inside Pages.
 *
 * @remarks
 * ACP runners reach MCP servers over HTTP, so Pages offers the run-bound
 * tools of a step itself instead of starting a separate process. The bearer
 * is a random token of exactly one step. It exists only in the memory of the
 * API process ({@link PlanBridgeGrants}) and in the session of the step, so a
 * restart, the end of the step or the end of its run makes it unknown. Behind
 * it stands the credential of the step, which only this process knows in
 * clear text. Every request is verified anew and every call runs through the
 * agent API with the current rights of the executor, narrowed to the
 * operations and tickets of the step. Plans are never deleted here, because
 * no consent surface exists for it.
 */
export class PlanBridge {
  private readonly api: Pick<PagesAgentApiService, "handle" | "verify">;
  private readonly grants: Pick<PlanBridgeGrants, "resolve">;

  /**
   * Creates the bridge of this server.
   *
   * @param api - The agent API every call runs through.
   * @param grants - The bearers of the active steps of this process.
   */
  public constructor(
    api: Pick<PagesAgentApiService, "handle" | "verify">,
    grants: Pick<PlanBridgeGrants, "resolve">,
  ) {
    this.api = api;
    this.grants = grants;
  }

  /** Answers one HTTP request of an agent session. */
  public async handle(request: PlanBridgeRequest): Promise<PlanBridgeResponse> {
    // No server stream: the client falls back to plain request and response.
    if (request.method === "GET") return { status: 405, body: null };
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(
      request.authorization ?? "",
    )?.[1];
    const token =
      bearer === undefined ? null : await this.grants.resolve(bearer);
    if (token === null || !(await this.isStepToken(token)))
      return { status: 401, body: null };
    if (request.method === "DELETE") return { status: 200, body: null };
    if (request.method !== "POST") return { status: 405, body: null };
    const body = await request.readBody();
    if (body === null || Buffer.byteLength(body) > PLAN_BRIDGE_MAXIMUM_BODY)
      return { status: 413, body: null };
    return answerPlanBridgeMessage(body, {
      list: () => this.list(token),
      call: (name, input) => this.call(token, name, input),
    });
  }

  /** The credential behind a bearer must still be a valid credential of a plan step. */
  private async isStepToken(token: string): Promise<boolean> {
    let identity: AgentIdentity;
    try {
      identity = await this.api.verify(token);
    } catch (caughtError: unknown) {
      if (!(caughtError instanceof McpAuthorizationError)) throw caughtError;
      return false;
    }
    return identity.run !== undefined;
  }

  private async allowedOperations(token: string): Promise<readonly string[]> {
    try {
      const response = await this.api.handle(token, { operation: "verify" });
      if (!("tools" in response)) throw authorizationFailed();
      return response.tools;
    } catch (caughtError: unknown) {
      if (caughtError instanceof PlanBridgeRpcError) throw caughtError;
      logCaughtError("PlanBridge", caughtError);

      throw authorizationFailed();
    }
  }

  private async list(token: string): Promise<readonly Tool[]> {
    const allowed = await this.allowedOperations(token);
    return [
      ...(allowed.includes("projects.names.list")
        ? [LIST_PROJECT_NAMES_TOOL]
        : []),
      ...TOOL_ENTRIES.filter((entry) => allowed.includes(entry.operation)).map(
        (entry) => entry.tool,
      ),
    ];
  }

  private async call(
    token: string,
    name: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<PlanBridgeToolResult> {
    const entry = TOOL_ENTRIES.find(
      (candidate) => candidate.tool.name === name,
    );
    const allowed = await this.allowedOperations(token);
    if (entry) {
      if (!allowed.includes(entry.operation)) throw authorizationFailed();
      return this.run(token, entry.operation, input);
    }
    if (name !== LIST_PROJECT_NAMES_TOOL.name)
      throw new PlanBridgeRpcError(-32602, "Unknown tool.");
    if (Object.keys(input).length > 0)
      throw new PlanBridgeRpcError(-32602, "This tool takes no arguments.");
    return this.listProjectNames(token);
  }

  private async listProjectNames(token: string): Promise<PlanBridgeToolResult> {
    try {
      const response = await this.api.handle(token, {
        operation: "projects.names.list",
        parameters: {},
      });
      if (!("projectNames" in response)) throw authorizationFailed();
      return textResult([...response.projectNames], false);
    } catch (caughtError: unknown) {
      if (caughtError instanceof PlanBridgeRpcError) throw caughtError;
      logCaughtError("PlanBridge", caughtError);

      throw authorizationFailed();
    }
  }

  private async run(
    token: string,
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<PlanBridgeToolResult> {
    try {
      // Consent for a deletion would have to come from a person at a client form; the bridge has none.
      if (
        operation === "plans.delete" ||
        operation === "plans.templates.delete"
      )
        throw new PlanOperationFailure("CONFIRMATION_REQUIRED");
      this.requireEnvelopeBudget(operation, parameters);
      const response = await this.api.handle(token, { operation, parameters });
      if (
        !("result" in response) ||
        typeof response.result !== "object" ||
        response.result === null
      )
        throw new Error("Pages operation failed.");
      return textResult(response.result, false);
    } catch (caughtError: unknown) {
      return this.refusal(caughtError);
    }
  }

  private requireEnvelopeBudget(
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
  ): void {
    const limit = agentEnvelopeLimit(operation);
    if (Buffer.byteLength(JSON.stringify({ operation, parameters })) > limit)
      throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
        constraint: "requestBytes",
        limit,
      });
  }

  private refusal(caughtError: unknown): PlanBridgeToolResult {
    if (caughtError instanceof PlanOperationFailure)
      return failureResult(caughtError);
    if (caughtError instanceof AgentOperationError) {
      const failure = planOperationFailure(caughtError);
      if (failure) return failureResult(failure);
    }
    logCaughtError("PlanBridge", caughtError);
    logDiagnostic(
      "PlanBridge",
      "error",
      "A plan bridge operation failed unexpectedly.",
      caughtError,
    );

    throw authorizationFailed();
  }
}
