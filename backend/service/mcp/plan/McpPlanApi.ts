import { AGENT_READ_LIMITS } from "@/definition/AgentReadChunks";

import { McpPlanError } from "./McpPlanError";

import type { AgentPlanOperationService } from "@/backend/service/agents/AgentPlanOperationService";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";

/** The operations an endpoint of the plan interface passes its request to unchanged. */
export type McpPlanOperation =
  | "plans.capabilities.read"
  | "plans.list"
  | "plans.create"
  | "plans.read"
  | "plans.update"
  | "plans.clone"
  | "plans.sources.read"
  | "plans.parameter.create"
  | "plans.parameter.update"
  | "plans.parameter.remove"
  | "plans.control.read"
  | "plans.templates.list"
  | "plans.templates.read"
  | "plans.templates.save"
  | "plans.templates.update";

/** What the plan API runs on: the plan operation layer on the `mcp` channel and the facts of the account. */
export interface McpPlanServices {
  readonly operations: Pick<AgentPlanOperationService, "handle">;
  readonly identities: Pick<AgentIdentityService, "verify">;
  /** The confirmation word of the account's interface language, which a deletion needs. */
  readonly confirmationWord: (userId: string) => Promise<string>;
}

/** What the plan API needs beyond its services: the token check and the accounts. */
export interface McpPlanAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/** One call: the body or query of the request and the path parameters of its resource. */
export interface McpPlanRequest {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly path: Readonly<Record<string, string>>;
}

type OperationResult = (
  PagesAgentReadResponse | PagesAgentWriteResponse
)["result"];

/** The fields the body of a deletion holds, by resource. */
const PLAN_DELETION_FIELDS: ReadonlySet<string> = new Set([
  "operationId",
  "expectedRevision",
  "confirmed",
]);
const TEMPLATE_DELETION_FIELDS: ReadonlySet<string> = new Set([
  "operationId",
  "workspaceId",
  "confirmed",
]);

/** The most parts a chunked plan read can have, so a faulty cursor never loops. */
const MAXIMUM_READ_PARTS = Math.ceil(
  AGENT_READ_LIMITS.totalBytes / AGENT_READ_LIMITS.minimumChunkBytes,
);

function invalid(): McpPlanError {
  return new McpPlanError("invalid_request");
}

/**
 * The input of an operation: the parameters of the request with the path parameters.
 *
 * @throws {McpPlanError} `invalid_request` when the request names a path parameter itself.
 */
function operationInput(request: McpPlanRequest): Record<string, unknown> {
  if (
    Object.keys(request.path).some((key) =>
      Object.hasOwn(request.parameters, key),
    )
  )
    throw invalid();
  return { ...request.parameters, ...request.path };
}

/**
 * Splits `confirmed` off the parameters of a deletion.
 *
 * @throws {McpPlanError} `invalid_request` for a `confirmed` that is not a
 * boolean and for a `confirmation`, which the API sets itself.
 */
function readDeletion(request: McpPlanRequest): {
  readonly isConfirmed: boolean;
  readonly rest: Record<string, unknown>;
} {
  const { confirmed, ...rest } = operationInput(request);
  if (confirmed !== undefined && typeof confirmed !== "boolean")
    throw invalid();
  if (Object.hasOwn(rest, "confirmation")) throw invalid();
  return { isConfirmed: confirmed === true, rest };
}

/** A question names nothing it does not ask about, so a mistyped field is not silently dropped. */
function requireQuestionFields(
  parameters: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): void {
  if (Object.keys(parameters).some((key) => !allowed.has(key))) throw invalid();
}

/** The name of a plan in a reassembled plan read. */
function readPlanName(text: string): string {
  const read: unknown = JSON.parse(text);
  if (
    typeof read === "object" &&
    read !== null &&
    "plan" in read &&
    typeof read.plan === "object" &&
    read.plan !== null &&
    "name" in read.plan &&
    typeof read.plan.name === "string"
  )
    return read.plan.name;
  throw new Error("The plan read has no name.");
}

/**
 * The plan API of the stand-alone Pages MCP program (PAGE-246).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, noting its use. Each endpoint then calls the plan operation
 * layer of the plan page with exactly one operation, with an identity
 * without a run, and answers its `result` unchanged: no projection and no
 * check beside the input readers of the layer. The layer runs on the `mcp`
 * channel: an account with the administrator role acts as an administrator
 * without the admin mode of the interface. Only the deletions ask back
 * first; once confirmed, the API sets the confirmation word itself.
 */
export class McpPlanApi {
  private readonly services: McpPlanServices;
  private readonly access: McpPlanAccess;

  /**
   * Creates the API.
   *
   * @param services - The plan operation layer on the `mcp` channel and the account facts.
   * @param access - The device token check and the account lookup.
   */
  public constructor(services: McpPlanServices, access: McpPlanAccess) {
    this.services = services;
    this.access = access;
  }

  /**
   * Checks the token of a request and names the identity it acts with.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The current rights of the paired account, without a run.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpPlanError} `invalid_token` when the account is gone or deactivated.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<AgentIdentity> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpPlanError("invalid_token");
    return this.services.identities.verify(account.id);
  }

  /**
   * Runs one operation with the parameters and path parameters of a request.
   *
   * @param identity - The identity of the paired account.
   * @param operation - The operation of the endpoint.
   * @param request - The body or query and the path parameters.
   * @returns The `result` of the operation, unchanged.
   * @throws {McpPlanError} `invalid_request` when a path parameter is also in the body.
   * @throws {AgentOperationError} The refusal of the operation layer.
   */
  public async run(
    identity: AgentIdentity,
    operation: McpPlanOperation,
    request: McpPlanRequest,
  ): Promise<OperationResult> {
    return this.result(identity, operation, operationInput(request));
  }

  /**
   * Deletes a plan after a question (`plans.delete`).
   *
   * @param identity - The identity of the paired account.
   * @param request - `{ operationId, expectedRevision, confirmed? }` and the `planId` of the path.
   * @returns Without `confirmed: true` the scope of the deletion, unchanged
   * plan; with it the `result` of `plans.delete`.
   */
  public async deletePlan(
    identity: AgentIdentity,
    request: McpPlanRequest,
  ): Promise<unknown> {
    const { isConfirmed, rest } = readDeletion(request);
    if (isConfirmed)
      return this.result(identity, "plans.delete", {
        ...rest,
        confirmation: await this.services.confirmationWord(identity.userId),
      });
    requireQuestionFields(request.parameters, PLAN_DELETION_FIELDS);
    const planId = request.path.planId;
    const read = await this.result(identity, "plans.control.read", { planId });
    const control = "control" in read ? read.control : undefined;
    if (control === undefined) throw new Error("The plan control is missing.");
    return {
      confirmationRequired: true,
      plan: { id: control.planId, name: await this.planName(identity, planId) },
      canDelete: control.canDelete,
      blocker: control.blockers.delete,
      runId: control.runId ?? null,
    };
  }

  /**
   * Deletes a node template after a question (`plans.templates.delete`).
   *
   * @param identity - The identity of the paired account.
   * @param request - `{ operationId, workspaceId, confirmed? }` and the `templateId` of the path.
   * @returns Without `confirmed: true` the template that would go, unchanged;
   * with it the `result` of `plans.templates.delete`.
   */
  public async deleteTemplate(
    identity: AgentIdentity,
    request: McpPlanRequest,
  ): Promise<unknown> {
    const { isConfirmed, rest } = readDeletion(request);
    if (isConfirmed)
      return this.result(identity, "plans.templates.delete", {
        ...rest,
        confirmation: await this.services.confirmationWord(identity.userId),
      });
    requireQuestionFields(request.parameters, TEMPLATE_DELETION_FIELDS);
    const read = await this.result(identity, "plans.templates.read", {
      workspaceId: rest.workspaceId,
      templateId: rest.templateId,
    });
    const template = "template" in read ? read.template : undefined;
    if (template === undefined) throw new Error("The template is missing.");
    const { id, name, type, isShared } = template;
    return {
      confirmationRequired: true,
      template: { id, name, type, isShared },
    };
  }

  /** Calls the operation layer with one operation and returns its `result`. */
  private async result(
    identity: AgentIdentity,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<OperationResult> {
    const response = await this.services.operations.handle(
      identity,
      operation,
      input,
    );
    if (response === null) throw new Error("The plan operation is unknown.");
    return response.result;
  }

  /**
   * Reads the name of a plan for a deletion question.
   *
   * @remarks
   * A large plan is read in chunks; the parts are joined to the complete
   * JSON, which holds the name.
   */
  private async planName(
    identity: AgentIdentity,
    planId: string,
  ): Promise<string> {
    const parts: string[] = [];
    let cursor: string | null = null;
    for (let part = 0; part < MAXIMUM_READ_PARTS; part += 1) {
      const read = await this.result(
        identity,
        "plans.read",
        cursor === null ? { planId } : { planId, cursor },
      );
      if ("plan" in read) return read.plan.name;
      if (!("chunk" in read)) break;
      parts.push(read.chunk.text);
      cursor = read.chunk.nextCursor;
      if (cursor === null) return readPlanName(parts.join(""));
    }
    throw new Error("The plan read did not end.");
  }
}
