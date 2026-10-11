import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_IMPORT_LIMITS } from "@/definition/AgentImportManifest";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import type {
  AgentImportFile,
  AgentImportIndexEntry,
  AgentImportPlanInput,
} from "@/definition/AgentImportManifest";
import type { AgentLimitDetails } from "@/definition/PagesAgentOperations";

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

function sourceKey(input: unknown): string {
  const key = text(input);
  requireLimit(
    Buffer.byteLength(key),
    "importPathBytes",
    AGENT_IMPORT_LIMITS.pathBytes,
  );
  return key;
}

function indexEntry(input: unknown): AgentImportIndexEntry {
  const fields = record(input, ["sourceKey", "title", "titleSource"]);
  const titleSource = fields.titleSource;
  if (
    titleSource !== "explicit" &&
    titleSource !== "h1" &&
    titleSource !== "filename"
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    sourceKey: sourceKey(fields.sourceKey),
    title: text(fields.title),
    titleSource,
  };
}

function contentFile(input: unknown): AgentImportFile {
  const fields = record(input, ["sourceKey", "content", "title"]);
  const content = text(fields.content);
  requireLimit(
    Buffer.byteLength(content),
    "importFileBytes",
    AGENT_IMPORT_LIMITS.fileBytes,
  );
  return {
    sourceKey: sourceKey(fields.sourceKey),
    content,
    ...(fields.title === undefined ? {} : { title: text(fields.title) }),
  };
}

/** Validates strict JSON structure and all transport/package limits before reading target state. */
export function readWikiImportManifest(input: unknown): AgentImportPlanInput {
  const fields = record(input, ["projectId", "parentId", "manifest"]);
  const manifest = record(fields.manifest, ["version", "index", "files"]);
  if (
    manifest.version !== "1" ||
    !Array.isArray(manifest.index) ||
    !manifest.index.length ||
    !Array.isArray(manifest.files)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  requireLimit(
    manifest.index.length,
    "importIndexEntries",
    AGENT_IMPORT_LIMITS.indexEntries,
  );
  requireLimit(manifest.files.length, "importFiles", AGENT_IMPORT_LIMITS.files);
  const files = manifest.files.map(contentFile);
  requireLimit(
    files.reduce((bytes, file) => bytes + Buffer.byteLength(file.content), 0),
    "importContentBytes",
    AGENT_IMPORT_LIMITS.contentBytes,
  );
  const parsed: AgentImportPlanInput = {
    projectId: identifier(fields.projectId),
    parentId: fields.parentId === null ? null : identifier(fields.parentId),
    manifest: { version: "1", index: manifest.index.map(indexEntry), files },
  };
  requireLimit(
    Buffer.byteLength(
      JSON.stringify({ operation: "wiki.import.plan", parameters: parsed }),
    ),
    "requestBytes",
    PAGES_AGENT_LIMITS.requestBytes,
  );
  return parsed;
}
