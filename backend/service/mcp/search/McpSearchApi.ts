import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** What the search API runs on: the agent operation layer on the `mcp` channel and the facts of the account. */
export interface McpSearchServices {
  readonly operations: Pick<AgentOperationRouter, "handle">;
  readonly identities: Pick<AgentIdentityService, "verify">;
}

/** What the search API needs beyond its services: the token check and the accounts. */
export interface McpSearchAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/** The query parameters whose value is a number. */
const NUMBER_PARAMETERS: ReadonlySet<string> = new Set(["limit"]);

/** The query parameters whose value is a comma-separated list. */
const LIST_PARAMETERS: ReadonlySet<string> = new Set(["sourceTypes"]);

/** Longest number a query parameter may spell; longer values stay text and are refused. */
const NUMBER_PATTERN = /^\d{1,15}$/u;

/**
 * Reads one value of the query as the operation expects it.
 * @remarks
 * A value that is no number, or a list with an empty entry, is passed on as
 * text or with the empty entry, so the operation refuses it with `INVALID_REQUEST`.
 */
function readQueryValue(name: string, value: string): unknown {
  if (NUMBER_PARAMETERS.has(name) && NUMBER_PATTERN.test(value))
    return Number(value);
  if (LIST_PARAMETERS.has(name)) return value.split(",");
  return value;
}

/**
 * Turns the query of a search request into the parameters of `search.sources`.
 * @param query - The query of the request.
 * @returns `question`, `projectId`, `sourceTypes` (a comma-separated list),
 * `limit` and `cursor` as given; any other name is passed on and refused by the operation.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a parameter named twice.
 */
export function readMcpSearchQuery(
  query: URLSearchParams,
): Readonly<Record<string, unknown>> {
  const parameters: Record<string, unknown> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(parameters, name))
      throw new AgentOperationError("INVALID_REQUEST");
    parameters[name] = readQueryValue(name, value);
  }
  return parameters;
}

/**
 * The hybrid source search of the stand-alone Pages MCP program.
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, noting its use. The search then calls `search.sources` of
 * the agent operation layer that the agent tools and Pica use, with an
 * identity without a run, and answers its `result` unchanged. The operation
 * reads the rights of the account anew for every page, hands over only
 * sections of tickets, wiki pages and released ticket assets the account may
 * read in the interface, each with the Pages link of its source, and refuses
 * an empty or too long question with `INVALID_REQUEST` and a project the
 * account cannot see with `NOT_FOUND`.
 */
export class McpSearchApi {
  private readonly services: McpSearchServices;
  private readonly access: McpSearchAccess;

  /**
   * Creates the API.
   * @param services - The agent operation layer on the `mcp` channel and the account facts.
   * @param access - The device token check and the account lookup.
   */
  public constructor(services: McpSearchServices, access: McpSearchAccess) {
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
   * Runs one page of the search.
   * @param identity - The identity of the paired account.
   * @param parameters - The parameters of `search.sources`, still unchecked.
   * @returns The `result` of `search.sources`, unchanged: the sections with
   * source, title, text and link, `nextCursor`, the state of the vector
   * search and the number of outdated hits left out.
   * @throws {AgentOperationError} The refusal of the operation, such as
   * `INVALID_REQUEST` or `NOT_FOUND`.
   */
  public async search(
    identity: AgentIdentity,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const response = await this.services.operations.handle(identity, {
      operation: "search.sources",
      parameters,
    });
    return response.result;
  }
}
