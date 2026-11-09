import {
  GOOGLE_DRIVE_FULL_SCOPE,
  GOOGLE_DRIVE_READ_SCOPE,
} from "@/backend/google/GoogleDriveConfig";
import { parseSimulatedQuery } from "@/backend/google/GoogleDriveSimulationQuery";
import {
  DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_EXPORT_FORMATS,
} from "@/backend/google/GoogleDriveFormats";
import { GoogleDriveSimulationStore } from "@/backend/google/GoogleDriveSimulationStore";
import {
  readSimulatedUpload,
  simulatedError,
  simulatedMedia,
} from "@/backend/google/GoogleDriveSimulationResponses";

import type { GoogleFetch } from "@/backend/google/GoogleDriveResponses";
import type { GoogleDriveSimulationScenario } from "@/backend/google/GoogleDriveSimulationConfig";
import type { SimulatedFile } from "@/backend/google/GoogleDriveSimulationSeed";

/** The only origin the simulation answers; every other address is refused. */
const DRIVE_ORIGIN = "https://www.googleapis.com";

/** The account the simulated connection is bound to. */
export const SIMULATED_ACCOUNT = {
  emailAddress: "simulation@pages.invalid",
  permissionId: "sim-permission",
} as const;

const QUOTA_LIMIT_BYTES = 15 * 1024 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 100;
const MAXIMUM_PAGE_SIZE = 1000;
const PAGE_TOKEN_PREFIX = "sim-page-";
const FILE_PATH = /^\/drive\/v3\/files\/([^/]+)$/u;
const EXPORT_PATH = /^\/drive\/v3\/files\/([^/]+)\/export$/u;
const COPY_PATH = /^\/drive\/v3\/files\/([^/]+)\/copy$/u;
const UPLOAD_PATH = /^\/upload\/drive\/v3\/files\/([^/]+)$/u;
const DRIVE_PATH = /^\/drive\/v3\/drives\/([^/]+)$/u;

/** One request as the simulation reads it. */
interface SimulatedRequest {
  readonly method: string;
  readonly url: URL;
  readonly init: RequestInit;
}

function isFolder(file: SimulatedFile): boolean {
  return file.mimeType === DRIVE_FOLDER_MIME_TYPE;
}

function isGoogleDocument(file: SimulatedFile): boolean {
  return GOOGLE_EXPORT_FORMATS[file.mimeType] !== undefined;
}

function readPageSize(url: URL): number {
  const requested = Number(url.searchParams.get("pageSize") ?? "");

  return Number.isInteger(requested) && requested > 0
    ? Math.min(requested, MAXIMUM_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}

function readOffset(url: URL): number | null {
  const token = url.searchParams.get("pageToken");

  if (token === null) {
    return 0;
  }

  const offset = Number(token.slice(PAGE_TOKEN_PREFIX.length));

  return token.startsWith(PAGE_TOKEN_PREFIX) && Number.isInteger(offset)
    ? offset
    : null;
}

function page<Entry>(
  url: URL,
  entries: readonly Entry[],
): {
  readonly entries: readonly Entry[];
  readonly nextPageToken?: string;
} | null {
  const offset = readOffset(url);

  if (offset === null) {
    return null;
  }

  const size = readPageSize(url);
  const next = offset + size;

  return {
    entries: entries.slice(offset, next),
    ...(next < entries.length
      ? { nextPageToken: `${PAGE_TOKEN_PREFIX}${next}` }
      : {}),
  };
}

function splitIds(text: string | null): string[] {
  return (text ?? "").split(",").filter(Boolean);
}

async function readBody(init: RequestInit): Promise<Record<string, unknown>> {
  if (init.body === undefined || init.body === null) {
    return {};
  }

  try {
    const parsed: unknown = await new Response(init.body).json();

    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? { ...parsed }
      : {};
  } catch {
    // Drive treats an unreadable body like an empty one for metadata changes.
    return {};
  }
}

function textField(body: Record<string, unknown>, key: string): string | null {
  const entry = body[key];

  return typeof entry === "string" ? entry : null;
}

function firstParent(body: Record<string, unknown>): string | null {
  const parents = body["parents"];

  return Array.isArray(parents) && typeof parents[0] === "string"
    ? parents[0]
    : null;
}

/**
 * A simulated Google Drive (PAGE-270) that answers at the `GoogleFetch` seam
 * of the Drive clients in the format of the Drive API v3.
 *
 * @remarks
 * It never calls the real `fetch`: an address outside the Drive API is
 * refused like a network failure, so nothing reaches Google. The content lives
 * in process memory and returns to its starting state with every restart. The
 * `fields` parameter is accepted but every answer carries the full resource.
 */
export class GoogleDriveSimulation {
  public readonly fetch: GoogleFetch;
  private readonly scenario: GoogleDriveSimulationScenario;
  private readonly store = new GoogleDriveSimulationStore();

  /**
   * Creates the simulation in its starting state.
   *
   * @param scenario - How the simulated Drive behaves.
   */
  public constructor(scenario: GoogleDriveSimulationScenario) {
    this.scenario = scenario;
    this.fetch = async (url, init) => this.handle(url, init);
  }

  /**
   * Names the scopes the simulated connection holds.
   *
   * @returns The full scope, or only the read scope in `read_only`.
   */
  public grantedScopes(): readonly string[] {
    return this.scenario === "read_only"
      ? [GOOGLE_DRIVE_READ_SCOPE]
      : [GOOGLE_DRIVE_FULL_SCOPE];
  }

  private async handle(address: string, init: RequestInit): Promise<Response> {
    const url = new URL(address);

    if (url.origin !== DRIVE_ORIGIN) {
      throw new TypeError(
        "The Google Drive simulation answers no other address.",
      );
    }

    if (this.scenario === "unreachable") {
      throw new TypeError("fetch failed (simulated: Google Drive unreachable)");
    }

    const method = (init.method ?? "GET").toUpperCase();

    if (method !== "GET" && this.scenario === "read_only") {
      return simulatedError(
        403,
        "insufficientPermissions",
        "Request had insufficient authentication scopes.",
      );
    }

    return this.route({ init, method, url });
  }

  private async route(request: SimulatedRequest): Promise<Response> {
    const { method, url } = request;
    const path = url.pathname;

    if (path === "/drive/v3/about" && method === "GET") {
      return this.about();
    }

    if (path === "/drive/v3/files") {
      return method === "POST" ? this.createMetadata(request) : this.list(url);
    }

    if (path === "/upload/drive/v3/files" && method === "POST") {
      return this.upload(request);
    }

    if (path === "/drive/v3/drives" && method === "GET") {
      return this.listDrives(url);
    }

    return this.routeById(request);
  }

  private async routeById(request: SimulatedRequest): Promise<Response> {
    const path = request.url.pathname;
    const driveId = DRIVE_PATH.exec(path)?.[1];

    if (driveId !== undefined) {
      return this.readDrive(driveId);
    }

    const target = this.findTarget(path);

    if (!target) {
      return simulatedError(404, "notFound", "Unknown Drive API address.");
    }

    const file = this.store.find(decodeURIComponent(target.id));

    if (!file) {
      return simulatedError(404, "notFound", `File not found: ${target.id}.`);
    }

    if (this.isLocked(file)) {
      return simulatedError(
        403,
        "insufficientFilePermissions",
        "The user does not have sufficient permissions for this file.",
      );
    }

    return this.routeFile(file, target.kind, request);
  }

  private findTarget(path: string): {
    readonly id: string;
    readonly kind: "export" | "copy" | "upload" | "file";
  } | null {
    const patterns = [
      ["export", EXPORT_PATH],
      ["copy", COPY_PATH],
      ["upload", UPLOAD_PATH],
      ["file", FILE_PATH],
    ] as const;

    for (const [kind, pattern] of patterns) {
      const id = pattern.exec(path)?.[1];

      if (id !== undefined) {
        return { id, kind };
      }
    }

    return null;
  }

  private async routeFile(
    file: SimulatedFile,
    kind: "export" | "copy" | "upload" | "file",
    request: SimulatedRequest,
  ): Promise<Response> {
    if (kind === "export") return this.export(file, request.url);
    if (kind === "copy") return this.copy(file, request);
    if (kind === "upload") return this.replaceContent(file, request);
    if (request.method === "PATCH") return this.patch(file, request);
    if (request.method === "DELETE") return this.remove(file);

    return request.url.searchParams.get("alt") === "media"
      ? this.download(file)
      : Response.json(this.resource(file));
  }

  private isLocked(file: SimulatedFile): boolean {
    return (
      this.scenario === "item_forbidden" &&
      file.name.toLowerCase().startsWith("gesperrt")
    );
  }

  private resource(file: SimulatedFile): Record<string, unknown> {
    const sizeBytes = file.virtualSize ?? file.content?.length ?? 0;
    const hasBytes = !isFolder(file) && !isGoogleDocument(file);
    const canEdit = this.scenario !== "read_only" && !this.isLocked(file);

    return {
      capabilities: {
        canCopy: !isFolder(file),
        canDelete: canEdit,
        canEdit,
        canRename: canEdit,
        canTrash: canEdit,
        canUntrash: canEdit,
      },
      createdTime: file.createdTime,
      explicitlyTrashed: file.isExplicitlyTrashed,
      id: file.id,
      kind: "drive#file",
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      name: file.name,
      parents: file.parents,
      trashed: this.store.isTrashed(file),
      version: String(file.version),
      ...(file.driveId === null ? {} : { driveId: file.driveId }),
      ...(hasBytes ? { size: String(sizeBytes) } : {}),
    };
  }

  private about(): Response {
    const usage = this.store.usage();

    return Response.json({
      exportFormats: GOOGLE_EXPORT_FORMATS,
      kind: "drive#about",
      maxUploadSize: String(5 * 1024 ** 4),
      storageQuota: {
        limit: String(QUOTA_LIMIT_BYTES),
        usage: String(usage.usage),
        usageInDrive: String(usage.usage),
        usageInDriveTrash: String(usage.trash),
      },
      user: {
        displayName: "Simulation",
        emailAddress: SIMULATED_ACCOUNT.emailAddress,
        kind: "drive#user",
        permissionId: SIMULATED_ACCOUNT.permissionId,
      },
    });
  }

  private list(url: URL): Response {
    const clauses = parseSimulatedQuery(url.searchParams.get("q") ?? "");

    if (clauses === null) {
      return simulatedError(400, "invalid", "Invalid Value");
    }

    const driveId =
      url.searchParams.get("corpora") === "drive"
        ? url.searchParams.get("driveId")
        : null;
    const result = page(url, this.store.search(clauses, driveId));

    if (!result) {
      return simulatedError(400, "invalid", "Invalid page token.");
    }

    return Response.json({
      files: result.entries.map((file) => this.resource(file)),
      incompleteSearch: false,
      kind: "drive#fileList",
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    });
  }

  private listDrives(url: URL): Response {
    const result = page(url, this.store.listDrives());

    if (!result) {
      return simulatedError(400, "invalid", "Invalid page token.");
    }

    return Response.json({
      drives: result.entries.map((drive) => ({
        ...drive,
        kind: "drive#drive",
      })),
      kind: "drive#driveList",
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    });
  }

  private readDrive(id: string): Response {
    const drive = this.store.findDrive(decodeURIComponent(id));

    return drive
      ? Response.json({ ...drive, kind: "drive#drive" })
      : simulatedError(404, "notFound", `Shared drive not found: ${id}.`);
  }

  private download(file: SimulatedFile): Response {
    if (isFolder(file) || isGoogleDocument(file)) {
      return simulatedError(
        403,
        "fileNotDownloadable",
        "Only files with binary content can be downloaded. Use Export with Docs Editors files.",
      );
    }

    return simulatedMedia(file, file.mimeType);
  }

  private export(file: SimulatedFile, url: URL): Response {
    const formats = GOOGLE_EXPORT_FORMATS[file.mimeType];
    const wanted = url.searchParams.get("mimeType") ?? "";

    if (!formats) {
      return simulatedError(
        403,
        "fileNotExportable",
        "Export only supports Docs Editors files.",
      );
    }

    if (!formats.includes(wanted)) {
      return simulatedError(
        400,
        "badRequest",
        "The requested conversion is not supported.",
      );
    }

    return simulatedMedia(file, wanted);
  }

  private parentProblem(parentId: string | null): Response | null {
    const parent = parentId === null ? null : this.store.find(parentId);

    if (!parent || !isFolder(parent)) {
      return simulatedError(
        404,
        "notFound",
        `File not found: ${parentId ?? ""}.`,
      );
    }

    if (this.isLocked(parent)) {
      return simulatedError(
        403,
        "insufficientFilePermissions",
        "The user does not have sufficient permissions for this file.",
      );
    }

    return null;
  }

  private async createMetadata(request: SimulatedRequest): Promise<Response> {
    const body = await readBody(request.init);
    const parentId = firstParent(body) ?? "root";
    const problem = this.parentProblem(parentId);

    if (problem) {
      return problem;
    }

    const file = this.store.create({
      content: null,
      mimeType: textField(body, "mimeType") ?? "application/octet-stream",
      name: textField(body, "name") ?? "Untitled",
      parentId,
    });

    return Response.json(this.resource(file));
  }

  private async upload(request: SimulatedRequest): Promise<Response> {
    const upload = await readSimulatedUpload(request.url, request.init);

    if (!upload) {
      return simulatedError(400, "badContent", "Unreadable upload body.");
    }

    const parentId = firstParent(upload.metadata) ?? "root";
    const problem = this.parentProblem(parentId);

    if (problem) {
      return problem;
    }

    const file = this.store.create({
      content: upload.content,
      mimeType: textField(upload.metadata, "mimeType") ?? upload.contentType,
      name: textField(upload.metadata, "name") ?? "Untitled",
      parentId,
    });

    return Response.json(this.resource(file));
  }

  private async replaceContent(
    file: SimulatedFile,
    request: SimulatedRequest,
  ): Promise<Response> {
    if (
      request.method !== "PATCH" ||
      isFolder(file) ||
      isGoogleDocument(file)
    ) {
      return simulatedError(
        403,
        "fileNotWritable",
        "The content of this file cannot be replaced.",
      );
    }

    const upload = await readSimulatedUpload(request.url, request.init);

    if (!upload) {
      return simulatedError(400, "badContent", "Unreadable upload body.");
    }

    file.content = upload.content;
    file.virtualSize = null;
    file.mimeType = textField(upload.metadata, "mimeType") ?? file.mimeType;
    this.store.touch(file, true);

    return Response.json(this.resource(file));
  }

  private async patch(
    file: SimulatedFile,
    request: SimulatedRequest,
  ): Promise<Response> {
    const body = await readBody(request.init);
    const name = textField(body, "name");
    const addParents = splitIds(request.url.searchParams.get("addParents"));
    const removeParents = splitIds(
      request.url.searchParams.get("removeParents"),
    );
    const moveProblem = this.moveProblem(file, addParents, removeParents);

    if (moveProblem) {
      return moveProblem;
    }

    if (name !== null) {
      file.name = name;
    }

    if (typeof body["trashed"] === "boolean") {
      file.isExplicitlyTrashed = body["trashed"];
    }

    const target = addParents[0];

    if (target !== undefined) {
      this.store.move(file, target);
    }

    this.store.touch(file, name !== null);

    return Response.json(this.resource(file));
  }

  private moveProblem(
    file: SimulatedFile,
    addParents: readonly string[],
    removeParents: readonly string[],
  ): Response | null {
    if (addParents.length === 0 && removeParents.length === 0) {
      return null;
    }

    const target = addParents[0] ?? null;
    const problem = this.parentProblem(target);

    if (problem) {
      return problem;
    }

    const parent = target === null ? null : this.store.find(target);

    if (
      addParents.length !== 1 ||
      (parent && this.store.isWithin(parent, file.id))
    ) {
      return simulatedError(
        400,
        "invalidParents",
        "A file must have exactly one parent outside of its own tree.",
      );
    }

    return removeParents.every((id) => file.parents.includes(id))
      ? null
      : simulatedError(400, "invalidParents", "Unknown parent to remove.");
  }

  private async copy(
    file: SimulatedFile,
    request: SimulatedRequest,
  ): Promise<Response> {
    if (isFolder(file)) {
      return simulatedError(
        403,
        "cannotCopyFile",
        "This file cannot be copied by the user.",
      );
    }

    const body = await readBody(request.init);
    const parentId = firstParent(body) ?? file.parents[0] ?? "root";
    const problem = this.parentProblem(parentId);

    if (problem) {
      return problem;
    }

    const copy = this.store.create({
      content: file.content,
      mimeType: file.mimeType,
      name: textField(body, "name") ?? `Copy of ${file.name}`,
      parentId,
    });

    copy.virtualSize = file.virtualSize;

    return Response.json(this.resource(copy));
  }

  private remove(file: SimulatedFile): Response {
    if (file.parents.length === 0) {
      return simulatedError(
        403,
        "cannotDeleteRoot",
        "The root cannot be deleted.",
      );
    }

    this.store.remove(file);

    return new Response(null, { status: 204 });
  }
}
