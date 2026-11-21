import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** The milestone operations an endpoint passes its request to unchanged. */
export type McpMilestoneOperation =
  | "milestones.read"
  | "milestone.create"
  | "milestone.dependency.add"
  | "milestone.dependency.remove"
  | "milestone.initiative.add"
  | "milestone.initiative.remove"
  | "milestone.delete";

/** What the milestone API runs on: the agent operation layer on the `mcp` channel and the facts of the account. */
export interface McpMilestoneServices {
  readonly operations: Pick<AgentOperationRouter, "handle">;
  readonly identities: Pick<AgentIdentityService, "verify">;
}

/** What the milestone API needs beyond its services: the token check and the accounts. */
export interface McpMilestoneAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/** One call: the body or query of the request and the path parameters of its resource. */
export interface McpMilestoneRequest {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly path: Readonly<Record<string, string>>;
}

/** The operation and the parameter names of each field a change may name. */
const FIELD_OPERATIONS: Readonly<
  Record<
    string,
    {
      readonly operation: string;
      readonly expected: string;
      readonly value: string;
    }
  >
> = {
  name: {
    operation: "milestone.setName",
    expected: "expectedName",
    value: "name",
  },
  description: {
    operation: "milestone.setDescription",
    expected: "expectedDescription",
    value: "description",
  },
  status: {
    operation: "milestone.setStatus",
    expected: "expectedStatus",
    value: "status",
  },
  startAt: {
    operation: "milestone.setStartAt",
    expected: "expectedStartAt",
    value: "startAt",
  },
  dueAt: {
    operation: "milestone.setDueAt",
    expected: "expectedDueAt",
    value: "dueAt",
  },
};

/** The fields of the body of a field change. */
const FIELD_CHANGE_KEYS: ReadonlySet<string> = new Set([
  "operationId",
  "field",
  "expected",
  "value",
]);

/**
 * The input of an operation: the parameters of the request with the path parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` when the request names a path parameter itself.
 */
function operationInput(request: McpMilestoneRequest): Record<string, unknown> {
  if (
    Object.keys(request.path).some((key) =>
      Object.hasOwn(request.parameters, key),
    )
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return { ...request.parameters, ...request.path };
}

/**
 * The milestone API of the stand-alone Pages MCP program.
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, noting its use. Each endpoint then calls the agent
 * operation layer that the agent tools and Pica use with exactly one
 * milestone operation, with an identity without a run, and answers its
 * `result` unchanged. The layer decides every right and every check: the
 * project management right for changes, the archive right for archiving,
 * the expected old value of a field, and the operation ID that returns the
 * stored result on repetition. It runs on the `mcp` channel, where an
 * account with the administrator role acts as an administrator without the
 * admin mode of the interface.
 */
export class McpMilestoneApi {
  private readonly services: McpMilestoneServices;
  private readonly access: McpMilestoneAccess;

  /**
   * Creates the API.
   * @param services - The agent operation layer on the `mcp` channel and the account facts.
   * @param access - The device token check and the account lookup.
   */
  public constructor(
    services: McpMilestoneServices,
    access: McpMilestoneAccess,
  ) {
    this.services = services;
    this.access = access;
  }

  /**
   * Checks the token of a request and names the identity it acts with.
   * @param authorization - The `Authorization` header of the request.
   * @returns The current rights of the paired account, without a run.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpAuthorizationError} `invalid_token` when the account is gone or deactivated.
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
      throw new McpAuthorizationError("invalid_token", 401);
    return this.services.identities.verify(account.id);
  }

  /**
   * Runs one operation with the parameters and path parameters of a request.
   * @param identity - The identity of the paired account.
   * @param operation - The operation of the endpoint.
   * @param request - The body or query and the path parameters.
   * @returns The `result` of the operation, unchanged.
   * @throws {AgentOperationError} `INVALID_REQUEST` when a path parameter is
   * also in the body, or the refusal of the operation layer.
   */
  public async run(
    identity: AgentIdentity,
    operation: McpMilestoneOperation,
    request: McpMilestoneRequest,
  ): Promise<unknown> {
    return this.result(identity, operation, operationInput(request));
  }

  /**
   * Changes one field of a milestone while it holds the value the caller read.
   * @param identity - The identity of the paired account.
   * @param request - `{ operationId, field, expected, value }` and the `milestoneId` of the path.
   * @returns The `result` of the matching `milestone.set…` operation, unchanged.
   * @throws {AgentOperationError} `INVALID_REQUEST` for an unknown field or
   * body field, or the refusal of the operation layer, such as `CONFLICT`
   * when the field changed meanwhile.
   * @remarks
   * Milestones carry no revision; the value the field had when the caller
   * read it takes its place, as in the agent tools.
   */
  public async changeField(
    identity: AgentIdentity,
    request: McpMilestoneRequest,
  ): Promise<unknown> {
    const { parameters, path } = request;
    if (Object.keys(parameters).some((key) => !FIELD_CHANGE_KEYS.has(key)))
      throw new AgentOperationError("INVALID_REQUEST");
    const field = parameters.field;
    const names =
      typeof field === "string" && Object.hasOwn(FIELD_OPERATIONS, field)
        ? FIELD_OPERATIONS[field]
        : undefined;
    if (
      names === undefined ||
      !("expected" in parameters) ||
      !("value" in parameters)
    )
      throw new AgentOperationError("INVALID_REQUEST");
    return this.result(identity, names.operation, {
      operationId: parameters.operationId,
      milestoneId: path.milestoneId,
      [names.expected]: parameters.expected,
      [names.value]: parameters.value,
    });
  }

  /** Calls the operation layer with one operation and returns its `result`. */
  private async result(
    identity: AgentIdentity,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const response = await this.services.operations.handle(identity, {
      operation,
      parameters: input,
    });
    return response.result;
  }
}
