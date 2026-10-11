import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_IMPORT_LIMITS } from "@/definition/AgentImportManifest";
import { AGENT_STRUCTURED_IMPORT_LIMITS } from "@/definition/AgentStructuredImportManifest";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { isMilestoneLinkType, isWorkItemType } from "@/definition/Task";

import type {
  AgentStructuredAsset,
  AgentStructuredImportApplyInput,
  AgentStructuredImportInput,
  AgentStructuredLink,
  AgentStructuredManifest,
  AgentStructuredSource,
  AgentStructuredWikiTarget,
} from "@/definition/AgentStructuredImportManifest";
import type { AgentLimitDetails } from "@/definition/PagesAgentOperations";

const NON_WIKI_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function record(
  input: unknown,
  allowed: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  const fields = input as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !allowed.includes(key)))
    throw new AgentOperationError("INVALID_REQUEST");
  return fields;
}

function text(input: unknown): string {
  if (typeof input !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function optionalText(input: unknown, fallback: string): string {
  return input === undefined ? fallback : text(input);
}

function nullableText(input: unknown): string | null {
  return input === undefined || input === null ? null : text(input);
}

function identifier(input: unknown): string {
  const result = text(input);
  if (!result.trim() || result.length > 200)
    throw new AgentOperationError("INVALID_REQUEST");
  return result;
}

function requireLimit(
  count: number,
  constraint: AgentLimitDetails["constraint"],
  limit: number,
): void {
  if (count > limit)
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", { constraint, limit });
}

function readKey(input: unknown): string {
  const key = text(input);
  if (key.length > AGENT_STRUCTURED_IMPORT_LIMITS.keyLength)
    throw new AgentOperationError("INVALID_REQUEST");
  return key;
}

function readPath(input: unknown): string {
  const path = text(input);
  requireLimit(
    Buffer.byteLength(path),
    "importPathBytes",
    AGENT_IMPORT_LIMITS.pathBytes,
  );
  return path;
}

type RawSource = Readonly<Record<string, unknown>>;

function readSource(input: unknown): AgentStructuredSource {
  const kind =
    typeof input === "object" && input !== null && "kind" in input
      ? (input as RawSource).kind
      : undefined;
  if (kind === "project") {
    const fields = record(input, ["kind", "key", "projectId"]);
    return {
      kind,
      key: readKey(fields.key),
      projectId: identifier(fields.projectId),
    };
  }
  if (kind === "milestone") {
    const fields = record(input, [
      "kind",
      "key",
      "project",
      "name",
      "description",
      "startAt",
      "dueAt",
    ]);
    return {
      kind,
      key: readKey(fields.key),
      project: optionalText(fields.project, ""),
      name: text(fields.name),
      description: optionalText(fields.description, ""),
      startAt: nullableText(fields.startAt),
      dueAt: nullableText(fields.dueAt),
    };
  }
  if (kind === "ticket") {
    const fields = record(input, [
      "kind",
      "key",
      "project",
      "type",
      "title",
      "description",
    ]);
    if (!isWorkItemType(fields.type))
      throw new AgentOperationError("INVALID_REQUEST");
    return {
      kind,
      key: readKey(fields.key),
      project: optionalText(fields.project, ""),
      type: fields.type,
      title: text(fields.title),
      description: optionalText(fields.description, ""),
    };
  }
  if (kind === "wiki") {
    const fields = record(input, ["kind", "key", "content", "title"]);
    const content = text(fields.content);
    requireLimit(
      Buffer.byteLength(content),
      "importFileBytes",
      AGENT_IMPORT_LIMITS.fileBytes,
    );
    return {
      kind,
      key: readPath(fields.key),
      content,
      ...(fields.title === undefined ? {} : { title: text(fields.title) }),
    };
  }
  throw new AgentOperationError("INVALID_REQUEST");
}

function readLink(input: unknown): AgentStructuredLink {
  const fields = record(input, ["type", "from", "to", "linkType"]);
  const link = { from: readKey(fields.from), to: readKey(fields.to) };
  if (fields.type === "dependency") {
    if (!isMilestoneLinkType(fields.linkType))
      throw new AgentOperationError("INVALID_REQUEST");
    return { type: "dependency", ...link, linkType: fields.linkType };
  }
  if (
    (fields.type !== "parent" && fields.type !== "milestone") ||
    fields.linkType !== undefined
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return { type: fields.type, ...link };
}

function readAsset(input: unknown): AgentStructuredAsset {
  const fields = record(input, ["path", "assetId"]);
  return { path: readPath(fields.path), assetId: identifier(fields.assetId) };
}

function readWikiTarget(input: unknown): AgentStructuredWikiTarget | null {
  if (input === undefined || input === null) return null;
  const fields = record(input, ["project", "parentId"]);
  if (fields.parentId === undefined)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    project: optionalText(fields.project, ""),
    parentId: fields.parentId === null ? null : identifier(fields.parentId),
  };
}

function readList(
  input: unknown,
  limit: number,
  constraint: AgentLimitDetails["constraint"],
): readonly unknown[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new AgentOperationError("INVALID_REQUEST");
  requireLimit(input.length, constraint, limit);
  return input;
}

/** Fills the project of a source when the manifest names exactly one project. */
function withDefaultProject(
  sources: readonly AgentStructuredSource[],
): readonly AgentStructuredSource[] {
  const projects = sources.filter((source) => source.kind === "project");
  const only = projects.length === 1 ? projects[0]?.key : undefined;
  return sources.map((source) =>
    (source.kind === "milestone" || source.kind === "ticket") &&
    source.project === "" &&
    only !== undefined
      ? { ...source, project: only }
      : source,
  );
}

/** Reads the manifest of a structured import; nothing is looked up before it is valid. */
export function readStructuredManifest(
  input: unknown,
): AgentStructuredManifest {
  const fields = record(input, [
    "version",
    "sources",
    "links",
    "assets",
    "wiki",
  ]);
  if (fields.version !== "1" || !Array.isArray(fields.sources))
    throw new AgentOperationError("INVALID_REQUEST");
  requireLimit(
    fields.sources.length,
    "importSources",
    AGENT_STRUCTURED_IMPORT_LIMITS.sources,
  );
  const sources = withDefaultProject(fields.sources.map(readSource));
  const wikiSources = sources.filter((source) => source.kind === "wiki");
  requireLimit(wikiSources.length, "importFiles", AGENT_IMPORT_LIMITS.files);
  requireLimit(
    wikiSources.reduce(
      (bytes, source) => bytes + Buffer.byteLength(source.content),
      0,
    ),
    "importContentBytes",
    AGENT_IMPORT_LIMITS.contentBytes,
  );
  const wiki = readWikiTarget(fields.wiki);
  const projects = sources.filter((source) => source.kind === "project");
  return {
    version: "1",
    sources,
    links: readList(
      fields.links,
      AGENT_STRUCTURED_IMPORT_LIMITS.links,
      "importLinks",
    ).map(readLink),
    assets: readList(
      fields.assets,
      AGENT_STRUCTURED_IMPORT_LIMITS.assets,
      "importAssets",
    ).map(readAsset),
    wiki:
      wiki && wiki.project === "" && projects.length === 1
        ? { ...wiki, project: projects[0].key }
        : wiki,
  };
}

function requireRequestSize(operation: string, parameters: unknown): void {
  requireLimit(
    Buffer.byteLength(JSON.stringify({ operation, parameters })),
    "requestBytes",
    PAGES_AGENT_LIMITS.requestBytes,
  );
}

/** Validates a preview request: only a manifest, within every transport limit. */
export function readStructuredImportPlan(
  input: unknown,
): AgentStructuredImportInput {
  const fields = record(input, ["manifest"]);
  const parsed: AgentStructuredImportInput = {
    manifest: readStructuredManifest(fields.manifest),
  };
  requireRequestSize("import.structured.plan", parsed);
  return parsed;
}

/** Validates a confirmed import: the manifest, the plan fingerprint and the client's operation ID. */
export function readStructuredImportApply(
  input: unknown,
): AgentStructuredImportApplyInput {
  const fields = record(input, ["operationId", "fingerprint", "manifest"]);
  if (
    typeof fields.operationId !== "string" ||
    !fields.operationId.trim() ||
    fields.operationId.length > 200 ||
    typeof fields.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(fields.fingerprint)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const parsed: AgentStructuredImportApplyInput = {
    operationId: fields.operationId,
    fingerprint: fields.fingerprint,
    manifest: readStructuredManifest(fields.manifest),
  };
  requireRequestSize("import.structured.apply", parsed);
  return parsed;
}

/** Tells whether a key can be a project, milestone or ticket key. */
export function isStructuredKey(key: string): boolean {
  return NON_WIKI_KEY.test(key);
}

/**
 * The canonical text of a manifest, so the order the client chose for its lists never matters.
 *
 * @param manifest - The validated manifest.
 * @returns A string that is equal for equal manifests.
 */
export function canonicalStructuredManifest(
  manifest: AgentStructuredManifest,
): string {
  return JSON.stringify({
    version: manifest.version,
    wiki: manifest.wiki,
    sources: manifest.sources.map((source) => JSON.stringify(source)).sort(),
    links: manifest.links.map((link) => JSON.stringify(link)).sort(),
    assets: manifest.assets.map((asset) => JSON.stringify(asset)).sort(),
  });
}
