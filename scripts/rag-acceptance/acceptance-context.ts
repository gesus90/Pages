import { Readable } from "node:stream";

import { UserRepository } from "../../backend/database/repositories/UserRepository";
import { SearchEmbeddingRepository } from "../../backend/database/repositories/search/SearchEmbeddingRepository";
import { SearchSourceRepository } from "../../backend/database/repositories/search/SearchSourceRepository";
import { WorkItemAttachmentRepository } from "../../backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemAccessDeniedError } from "../../backend/error/WorkItemErrors";
import { AgentSourceSearchService } from "../../backend/service/agents/AgentSourceSearchService";
import { createAgentTaskContext } from "../../backend/service/agents/AgentTaskAccess";
import { SearchIndexService } from "../../backend/service/search/SearchIndexService";
import { TaskAttachmentService } from "../../backend/service/task/TaskAttachmentService";
import { TicketFileStore } from "../../backend/storage/TicketFileStore";

import {
  ASSETS,
  DEPARTMENTS,
  PAGES,
  PERSONS,
  PROJECTS,
  ROLES,
  TICKETS,
} from "./acceptance-data";

import type {
  Database,
  DatabaseTransaction,
} from "../../backend/database/Database";
import type { AgentTaskContext } from "../../backend/service/agents/AgentTaskAccess";
import type {
  EmbeddingModel,
  EmbeddingModelFactory,
} from "../../backend/service/search/EmbeddingModels";
import type { SearchIndexRunReport } from "../../backend/service/search/SearchIndexService";
import type { UploadLimitSource } from "../../backend/service/task/TaskAttachmentService";
import type { AgentSourceSearch } from "../../definition/AgentSourceSearch";
import type { User } from "../../definition/User";

/** Upload limits of the disposable instance, those of a default installation. */
const UPLOAD_LIMITS: UploadLimitSource = {
  getSettings: async () =>
    Promise.resolve({
      mediaLimitBytes: 50 * 1024 * 1024,
      fileLimitBytes: 25 * 1024 * 1024,
    }),
};

/** What one search asks for. */
export interface AcceptanceSearch {
  readonly reader: string;
  readonly question: string;
  readonly projectId?: string;
  readonly limit?: number;
}

/** A file handed to the attachment service as a browser upload. */
export interface AcceptanceUpload {
  readonly fileName: string;
  readonly bytes: Buffer;
  /** Announced length; defaults to the number of bytes. */
  readonly contentLength?: number;
}

/**
 * The Pages services of one acceptance database, built exactly as the
 * server builds them for an agent call.
 */
export class AcceptanceContext {
  private readonly database: Database;
  private readonly dataDirectory: string;
  private readonly users: UserRepository;

  /**
   * Creates the services of a database.
   * @param database - An open, migrated database of the run.
   * @param dataDirectory - Its data directory with the asset files.
   */
  public constructor(database: Database, dataDirectory: string) {
    this.database = database;
    this.dataDirectory = dataDirectory;
    this.users = new UserRepository(database);
  }

  /** The open database. */
  public get db(): Database {
    return this.database;
  }

  /**
   * Reads a person anew, as every agent call does.
   * @param id - Person identifier.
   * @returns The account.
   */
  public async person(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new Error(`The acceptance person ${id} is missing.`);
    return user;
  }

  /**
   * Builds the ticket services of one person on the MCP channel.
   * @param id - Person identifier.
   * @returns Ticket, project and permission services of that person.
   */
  public async tasks(id: string): Promise<AgentTaskContext> {
    return createAgentTaskContext(this.database, await this.person(id));
  }

  /**
   * Builds the attachment service of one person, as the agent asset reads do.
   * @param id - Person identifier.
   * @returns The service and the person.
   */
  public async attachments(id: string): Promise<{
    readonly service: TaskAttachmentService;
    readonly actor: User;
  }> {
    const context = await this.tasks(id);
    return {
      actor: context.actor,
      service: new TaskAttachmentService(
        new WorkItemAttachmentRepository(this.database),
        context.tasks,
        UPLOAD_LIMITS,
        new TicketFileStore(this.dataDirectory),
      ),
    };
  }

  /**
   * Uploads a file to a ticket as a person, through the attachment service.
   * @param personId - Uploading person.
   * @param ticketId - Target ticket.
   * @param upload - File name, bytes and announced length.
   * @returns The attachment identifier and stored checksum.
   */
  public async upload(
    personId: string,
    ticketId: string,
    upload: AcceptanceUpload,
  ): Promise<{ readonly id: string }> {
    const { service, actor } = await this.attachments(personId);
    const attachment = await service.upload(actor, ticketId, {
      fileName: upload.fileName,
      contentLength: upload.contentLength ?? upload.bytes.length,
      body: Readable.from([upload.bytes]),
    });
    return { id: attachment.id };
  }

  /**
   * Downloads an attachment as a person, through the attachment service.
   * @param personId - Reading person.
   * @param attachmentId - Attachment identifier.
   * @returns The bytes.
   */
  public async download(
    personId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const { service, actor } = await this.attachments(personId);
    const opened = await service.open(actor, attachmentId);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  /**
   * Runs the search operation `search.sources` as a person.
   * @param createModel - Model of the mode; `null` is the keyword search alone.
   * @param search - Reader, question, optional project and limit.
   * @returns The result the agent receives.
   */
  public async search(
    createModel: EmbeddingModelFactory | null,
    search: AcceptanceSearch,
  ): Promise<AgentSourceSearch> {
    const operation = new AgentSourceSearchService({
      database: this.database,
      users: { getById: async (id) => this.users.findById(id) },
      channel: "mcp",
      createModel,
    });
    const response = await operation.handle(
      { userId: search.reader, isAdmin: false, permissions: [] },
      "search.sources",
      {
        question: search.question,
        limit: search.limit ?? 5,
        ...(search.projectId === undefined
          ? {}
          : { projectId: search.projectId }),
      },
    );
    if (!response) throw new Error("search.sources was not answered.");
    // The operation answers with the search result of the agent contract.
    return response.result as AgentSourceSearch;
  }

  /**
   * Runs the local indexer once with a model, as `pnpm run search:index` does.
   * @param model - Embedding model of the inventory.
   * @returns The run report.
   */
  public async index(model: EmbeddingModel): Promise<SearchIndexRunReport> {
    const indexer = new SearchIndexService({
      embeddings: new SearchEmbeddingRepository(this.database),
      sources: new SearchSourceRepository(this.database),
      assets: new TaskAttachmentService(
        new WorkItemAttachmentRepository(this.database),
        {
          getById: async () => Promise.reject(new WorkItemAccessDeniedError()),
          actionPermissions: async () =>
            Promise.reject(new WorkItemAccessDeniedError()),
        },
        UPLOAD_LIMITS,
        new TicketFileStore(this.dataDirectory),
      ),
      model,
    });
    return indexer.runOnce();
  }

  /**
   * Reads the identifier of an attachment by its file name.
   * @param fileName - File name of a synthetic asset.
   * @returns The attachment identifier, or `null` when it no longer exists.
   */
  public async assetId(fileName: string): Promise<string | null> {
    const rows = await this.database.query(
      `
        SELECT attachment.id
        FROM work_item_attachments AS attachment
        WHERE attachment.file_name = $file_name
        ORDER BY attachment.created_at DESC
        LIMIT 1;
      `,
      { file_name: fileName },
    );
    const id = rows[0]?.[0];
    return typeof id === "string" ? id : null;
  }
}

async function insertOrganization(
  transaction: DatabaseTransaction,
): Promise<void> {
  for (const department of Object.values(DEPARTMENTS))
    await transaction.execute(
      "INSERT INTO departments (id, name) VALUES ($id, $name);",
      department,
    );
  for (const role of Object.values(ROLES)) {
    await transaction.execute(
      "INSERT INTO roles (id, name, hierarchy_rank, department_bound) VALUES ($id, $name, 10, 1);",
      { id: role.id, name: role.name },
    );
    for (const permission of role.permissions)
      await transaction.execute(
        "INSERT INTO role_permissions (role_id, permission) VALUES ($role_id, $permission);",
        { role_id: role.id, permission },
      );
  }
  for (const project of Object.values(PROJECTS)) {
    await transaction.execute(
      "INSERT INTO projects (id, name, owner_id, status) VALUES ($id, $name, $owner_id, 'active');",
      { id: project.id, name: project.name, owner_id: PERSONS.admin.id },
    );
    await transaction.execute(
      "INSERT INTO project_departments (project_id, department_id) VALUES ($project_id, $department_id);",
      { project_id: project.id, department_id: project.departmentId },
    );
  }
}

async function insertPersons(transaction: DatabaseTransaction): Promise<void> {
  for (const person of Object.values(PERSONS)) {
    await transaction.execute(
      "INSERT INTO users (id, username, display_name, password_hash, role) VALUES ($id, $username, $display_name, 'not-a-login', $role);",
      {
        id: person.id,
        username: person.username,
        display_name: person.displayName,
        role: person.isAdmin ? "admin" : "employee",
      },
    );
    await transaction.execute(
      "INSERT INTO user_authorization (user_id, role_id, is_admin, active_mode, first_name) VALUES ($user_id, $role_id, $is_admin, $active_mode, $first_name);",
      {
        user_id: person.id,
        role_id: person.roleId,
        is_admin: person.isAdmin ? 1 : 0,
        active_mode: person.isAdmin ? "admin" : "role",
        first_name: person.displayName,
      },
    );
    for (const departmentId of person.departmentIds)
      await transaction.execute(
        "INSERT INTO department_members (user_id, department_id) VALUES ($user_id, $department_id);",
        { user_id: person.id, department_id: departmentId },
      );
  }
}

async function insertSources(transaction: DatabaseTransaction): Promise<void> {
  for (const ticket of TICKETS) {
    await transaction.execute(
      `INSERT INTO work_items (id, project_id, "key", number, type, title, description, status_id, created_by)
       VALUES ($id, $project_id, $key, $number, 'task', $title, $description, 'status-todo', $created_by);`,
      {
        id: ticket.id,
        project_id: ticket.projectId,
        key: ticket.key,
        number: ticket.number,
        title: ticket.title,
        description: ticket.description,
        created_by: ticket.createdBy,
      },
    );
    for (const departmentId of ticket.departmentIds)
      await transaction.execute(
        "INSERT INTO work_item_departments (work_item_id, department_id) VALUES ($work_item_id, $department_id);",
        { work_item_id: ticket.id, department_id: departmentId },
      );
  }
  for (const page of PAGES)
    await transaction.execute(
      `INSERT INTO wiki_pages (id, scope, project_id, author_id, owner_id, title, "content", revision)
       VALUES ($id, $scope, $project_id, $author_id, $author_id, $title, $content, 1);`,
      {
        id: page.id,
        scope: page.scope,
        project_id: page.projectId,
        author_id: page.authorId,
        title: page.title,
        content: page.content,
      },
    );
}

/**
 * Writes departments, roles, persons, projects, tickets and wiki pages of
 * the synthetic data and uploads the assets through the attachment service.
 * @param context - Services of the empty, migrated source database.
 * @returns Attachment identifiers by file name.
 */
export async function loadSyntheticData(
  context: AcceptanceContext,
): Promise<ReadonlyMap<string, string>> {
  await context.db.transaction(async (transaction) => {
    await insertOrganization(transaction);
    await insertPersons(transaction);
    await insertSources(transaction);
  });
  return uploadAssets(context);
}

async function uploadAssets(
  context: AcceptanceContext,
): Promise<ReadonlyMap<string, string>> {
  const ids = new Map<string, string>();
  for (const asset of ASSETS) {
    const ticket = TICKETS.find((entry) => entry.key === asset.ticketKey);
    if (!ticket) throw new Error(`Unknown ticket ${asset.ticketKey}.`);
    const { id } = await context.upload(asset.uploadedBy, ticket.id, asset);
    if (asset.isReleased) {
      const { service, actor } = await context.attachments(asset.uploadedBy);
      await service.setSearchRelease(actor, id, true);
    }
    ids.set(asset.fileName, id);
  }
  return ids;
}
