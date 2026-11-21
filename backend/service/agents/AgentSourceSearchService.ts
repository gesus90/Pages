import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { SearchEmbeddingRepository } from "@/backend/database/repositories/search/SearchEmbeddingRepository";
import { SourceSearchRepository } from "@/backend/database/repositories/search/SourceSearchRepository";
import { WikiSearchRepository } from "@/backend/database/repositories/wiki/WikiSearchRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { ProjectAccessService } from "@/backend/service/project/ProjectAccessService";
import { HybridSearchService } from "@/backend/service/search/HybridSearchService";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";
import {
  AGENT_SOURCE_SEARCH_MAX_QUESTION,
  AGENT_SOURCE_SEARCH_MAX_SECTIONS,
  AGENT_SOURCE_SEARCH_OPERATIONS,
  AGENT_SOURCE_TYPES,
} from "@/definition/AgentSourceSearch";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { createAgentCursor, readAgentCursor } from "./AgentCursor";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { Database } from "@/backend/database/Database";
import type { EmbeddingModelFactory } from "@/backend/service/search/EmbeddingModels";
import type { HybridSearchPosition } from "@/backend/service/search/HybridSearchService";
import type { UserService } from "@/backend/service/UserService";
import type {
  AgentSourceSearchOperation,
  AgentSourceType,
} from "@/definition/AgentSourceSearch";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { User } from "@/definition/User";
import type { WikiVisibilityScope } from "@/definition/Wiki";

/** Sections handed over when the agent names no limit. */
const DEFAULT_SECTIONS = 10;

/** Longest project identifier accepted. */
const MAX_IDENTIFIER_LENGTH = 200;

const PARAMETERS = new Set([
  "question",
  "projectId",
  "sourceTypes",
  "limit",
  "cursor",
]);

/** What the search runs with; the reader comes from the verified identity only. */
export interface AgentSourceSearchDependencies {
  readonly database: Database;
  readonly users: Pick<UserService, "getById">;
  /** The agent surface; it decides how an administrator is read. */
  readonly channel: AgentChannel;
  /** Builds the model that embeds questions; `null` keeps to the keyword search. */
  readonly createModel: EmbeddingModelFactory | null;
}

/** The checked parameters of `search.sources`. */
interface SourceSearchParameters {
  readonly question: string;
  readonly projectId: string | null;
  /** Kinds of sources in catalog order; `null` keeps every kind. */
  readonly sourceTypes: readonly AgentSourceType[] | null;
  readonly limit: number;
  /** The continuation as received; checked against account and query later. */
  readonly cursor: unknown;
}

function isSourceSearchOperation(
  value: unknown,
): value is AgentSourceSearchOperation {
  return AGENT_SOURCE_SEARCH_OPERATIONS.some((name) => name === value);
}

function readQuestion(value: unknown): string {
  if (typeof value !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  const question = value.trim();
  if (
    !question ||
    Array.from(question).length > AGENT_SOURCE_SEARCH_MAX_QUESTION
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return question;
}

function readProjectId(value: unknown): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_IDENTIFIER_LENGTH
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return value.trim();
}

function isSourceType(value: unknown): value is AgentSourceType {
  return AGENT_SOURCE_TYPES.some((type) => type === value);
}

/**
 * Reads the kinds of sources a search keeps.
 * @returns The kinds in catalog order, so the same choice binds the same cursor.
 * @throws {AgentOperationError} `INVALID_REQUEST` for no list, an empty list,
 * an unknown kind or a repeated kind.
 */
function readSourceTypes(value: unknown): readonly AgentSourceType[] | null {
  if (value === undefined) return null;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    new Set(value).size !== value.length ||
    !value.every(isSourceType)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return AGENT_SOURCE_TYPES.filter((type) => value.includes(type));
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SECTIONS;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > AGENT_SOURCE_SEARCH_MAX_SECTIONS
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return value;
}

/**
 * Reads and checks the parameters of a search.
 * @param input - The raw parameters.
 * @returns Question, optional project and number of sections.
 * @throws {AgentOperationError} `INVALID_REQUEST` for an unknown or invalid parameter.
 */
function readSearchParameters(input: unknown): SourceSearchParameters {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  if (Object.keys(input).some((key) => !PARAMETERS.has(key)))
    throw new AgentOperationError("INVALID_REQUEST");
  const parameters: ReadonlyMap<string, unknown> = new Map<string, unknown>(
    Object.entries(input),
  );
  return {
    question: readQuestion(parameters.get("question")),
    projectId: readProjectId(parameters.get("projectId")),
    sourceTypes: readSourceTypes(parameters.get("sourceTypes")),
    limit: readLimit(parameters.get("limit")),
    cursor: parameters.get("cursor"),
  };
}

/**
 * Names what a cursor is bound to: the account, the question, the project
 * and the kinds of sources. The page size may change between pages.
 */
function cursorContext(
  identity: AgentIdentity,
  parameters: SourceSearchParameters,
): string {
  return JSON.stringify([
    "search.sources",
    identity.userId,
    parameters.question,
    parameters.projectId,
    parameters.sourceTypes,
  ]);
}

function isPositionIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Reads the place a continuation starts after.
 * @param context - What the cursor must be bound to.
 * @param cursor - The cursor as received; absent or `null` starts with the best section.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a cursor of another
 * account or query, or one Pages did not issue.
 */
function readPosition(
  context: string,
  cursor: unknown,
): HybridSearchPosition | null {
  const after = readAgentCursor({ cursor, context });
  if (after === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(after);
  } catch (caughtError: unknown) {
    logCaughtError("AgentSourceSearchService", caughtError);

    throw new AgentOperationError("INVALID_REQUEST");
  }
  if (typeof parsed !== "object" || parsed === null)
    throw new AgentOperationError("INVALID_REQUEST");
  const fields: ReadonlyMap<string, unknown> = new Map<string, unknown>(
    Object.entries(parsed),
  );
  const keyRank = fields.get("keyRank");
  const score = fields.get("score");
  const sourceType = fields.get("sourceType");
  const sourceId = fields.get("sourceId");
  const sectionIndex = fields.get("sectionIndex");
  if (
    (keyRank !== null && !isPositionIndex(keyRank)) ||
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    !isSourceType(sourceType) ||
    typeof sourceId !== "string" ||
    !isPositionIndex(sectionIndex)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return { keyRank, score, sourceType, sourceId, sectionIndex };
}

/**
 * Answers `search.sources`: the hybrid search over tickets, wiki pages and
 * released ticket assets, for the account of the verified identity.
 * @remarks
 * The rights are read anew from the database for every search, without a
 * cache, so a withdrawn right or a removed project membership takes effect
 * with the next search. Only sections the reader may see now are handed over,
 * each with the link of its source.
 */
export class AgentSourceSearchService {
  private readonly dependencies: AgentSourceSearchDependencies;
  private readonly search: HybridSearchService;

  /**
   * Creates the operation.
   * @param dependencies - Database, accounts, channel and the optional model.
   */
  public constructor(dependencies: AgentSourceSearchDependencies) {
    this.dependencies = dependencies;
    const { database } = dependencies;
    this.search = new HybridSearchService({
      sources: new SourceSearchRepository(database),
      pages: new WikiSearchRepository(database),
      embeddings: new SearchEmbeddingRepository(database),
      createModel: dependencies.createModel,
    });
  }

  /**
   * Runs the search, or returns `null` when another service owns the operation.
   * @param identity - The verified identity of the call.
   * @param operation - The operation name as received.
   * @param input - The raw parameters.
   * @returns One page of sections, the cursor of the next page, the state
   * of the vector search and the number of outdated hits left out.
   * @throws {AgentOperationError} `INVALID_REQUEST`, also for a cursor of
   * another account or query, `NOT_FOUND` for a hidden or missing project,
   * or `PAYLOAD_TOO_LARGE`.
   */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | null> {
    if (!isSourceSearchOperation(operation)) return null;
    const parameters = readSearchParameters(input ?? {});
    const context = cursorContext(identity, parameters);
    const after = readPosition(context, parameters.cursor);
    const actor = await this.requireActor(identity);
    const scope = await this.resolveScope(actor);
    if (
      parameters.projectId !== null &&
      !scope.projectIds.includes(parameters.projectId)
    )
      throw new AgentOperationError("NOT_FOUND");
    const { next, ...page } = await this.search.search({
      scope,
      question: parameters.question,
      projectId: parameters.projectId,
      sourceTypes: parameters.sourceTypes,
      limit: parameters.limit,
      after,
    });
    const response: PagesAgentReadResponse = {
      apiVersion: "1",
      result: {
        ...page,
        nextCursor:
          next === null
            ? null
            : createAgentCursor(context, JSON.stringify(next)),
      },
    };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    return response;
  }

  private async requireActor(identity: AgentIdentity): Promise<User> {
    const actor = await this.dependencies.users.getById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    return actor;
  }

  /** Resolves what the reader may see from the current accounts, projects and departments. */
  private async resolveScope(actor: User): Promise<WikiVisibilityScope> {
    const access = new ProjectAccessService(
      new ProjectRepository(this.dependencies.database),
      ServerCache.disabled(),
      agentChannelPolicy(this.dependencies.channel).actor,
    );
    const wikiAccess = new WikiAccess(
      {
        workItemVisibility: async (user) =>
          (await access.scope(user)).visibility,
      },
      new PermissionService((id) => access.account({ ...actor, id })),
    );
    return (await wikiAccess.resolve(actor)).scope;
  }
}
