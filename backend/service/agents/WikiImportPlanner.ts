import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { AGENT_IMPORT_LIMITS } from "@/definition/AgentImportManifest";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import {
  countCharacters,
  normalizeWikiTitle,
  WIKI_LIMITS,
  WIKI_SCOPE,
} from "@/definition/Wiki";

import { duplicateImportPaths, isValidImportPath } from "./ImportPathValidator";
import { readImportTitle } from "./ImportMarkdownTitle";
import { scanRelativeLinks } from "./RelativeLinkScanner";
import { wikiImportFingerprint } from "./WikiImportFingerprint";
import { readWikiImportManifest } from "./WikiImportManifestReader";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { WikiAccess, WikiViewer } from "@/backend/service/wiki/WikiAccess";
import type {
  AgentImportFile,
  AgentImportIndexEntry,
  AgentImportIssue,
  AgentImportPage,
  AgentImportParent,
  AgentImportPlan,
  AgentImportPlanInput,
} from "@/definition/AgentImportManifest";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { User } from "@/definition/User";
import type { WikiImportTargetState } from "./WikiImportFingerprint";

interface ProposedPage {
  readonly key: string;
  readonly parent: AgentImportParent;
  readonly isDirectory: boolean;
  readonly level: number;
  title: string;
  titleSource: AgentImportPage["titleSource"];
  readonly sourceKeys: string[];
  contentBytes: number | null;
}

interface SourceDiagnostics {
  readonly errors: AgentImportIssue[];
  readonly conflicts: AgentImportIssue[];
}

interface TargetState extends WikiImportTargetState {
  readonly isTemplate: boolean;
}

function groupDirectory(sourceKey: string): string | null {
  const slash = sourceKey.lastIndexOf("/");
  const filename = sourceKey.slice(slash + 1);
  if (!/^(?:readme|index)\.md$/i.test(filename)) return null;
  return sourceKey.slice(0, Math.max(slash, 0));
}

function directoryKey(directory: string): string {
  return `directory:${directory || "."}`;
}

function indexMismatch(
  entry: AgentImportIndexEntry,
  file: AgentImportFile | undefined,
): boolean {
  if (!file && entry.titleSource !== "filename") return false;
  const derived = readImportTitle(
    file ?? { sourceKey: entry.sourceKey, content: "" },
  );
  return (
    derived.title !== normalizeWikiTitle(entry.title) ||
    derived.titleSource !== entry.titleSource
  );
}

function diagnoseSources(input: AgentImportPlanInput): SourceDiagnostics {
  const { index, files } = input.manifest;
  const errors: AgentImportIssue[] = [];
  const conflicts = [
    ...duplicateImportPaths(index.map((entry) => entry.sourceKey)),
    ...duplicateImportPaths(files.map((file) => file.sourceKey)).map(
      (issue): AgentImportIssue => ({ ...issue, reason: "duplicate_content" }),
    ),
  ];
  const keys = new Set([...index, ...files].map((entry) => entry.sourceKey));
  for (const sourceKey of [...keys].sort()) {
    if (!isValidImportPath(sourceKey))
      errors.push({
        code: "INVALID_REQUEST",
        reason: "invalid_path",
        sourceKeys: [sourceKey],
      });
    else if (sourceKey.split("/").length > WIKI_LIMITS.treeDepth)
      errors.push({
        code: "INVALID_REQUEST",
        reason: "tree_too_deep",
        sourceKeys: [sourceKey],
        limit: WIKI_LIMITS.treeDepth,
      });
  }
  for (const file of files) {
    if (!index.some((entry) => entry.sourceKey === file.sourceKey))
      errors.push({
        code: "INVALID_REQUEST",
        reason: "missing_index_entry",
        sourceKeys: [file.sourceKey],
      });
  }
  for (const entry of index) {
    if (
      indexMismatch(
        entry,
        files.find((file) => file.sourceKey === entry.sourceKey),
      )
    )
      errors.push({
        code: "INVALID_REQUEST",
        reason: "index_mismatch",
        sourceKeys: [entry.sourceKey],
      });
  }
  return { errors, conflicts };
}

function ensureDirectory(
  pages: Map<string, ProposedPage>,
  directory: string,
  parent: AgentImportParent,
  level: number,
): ProposedPage {
  const key = directoryKey(directory);
  const previous = pages.get(key);
  if (previous) return previous;
  const page: ProposedPage = {
    key,
    parent,
    level,
    isDirectory: true,
    title: normalizeWikiTitle(directory.slice(directory.lastIndexOf("/") + 1)),
    titleSource: "directory",
    sourceKeys: [],
    contentBytes: 0,
  };
  pages.set(key, page);
  return page;
}

function addSource(
  pages: Map<string, ProposedPage>,
  entry: AgentImportIndexEntry,
  context: {
    readonly root: AgentImportParent;
    readonly rootLevel: number;
    readonly file: AgentImportFile | undefined;
  },
): void {
  const segments = entry.sourceKey.split("/");
  let parent = context.root;
  let level = context.rootLevel;
  const directories = segments.slice(0, -1);
  for (let index = 0; index < directories.length; index++) {
    const directory = directories.slice(0, index + 1).join("/");
    const page = ensureDirectory(pages, directory, parent, level++);
    parent = { kind: "planned", key: page.key };
  }
  const directory = groupDirectory(entry.sourceKey);
  const key =
    directory === null ? `file:${entry.sourceKey}` : directoryKey(directory);
  let page = pages.get(key);
  if (!page) {
    page = {
      key,
      parent,
      level,
      isDirectory: false,
      title: "",
      titleSource: "filename",
      sourceKeys: [],
      contentBytes: null,
    };
    pages.set(key, page);
  }
  if (!page.sourceKeys.length) {
    page.title = normalizeWikiTitle(entry.title);
    page.titleSource = entry.titleSource;
    page.contentBytes = context.file
      ? Buffer.byteLength(context.file.content)
      : null;
  }
  if (!page.sourceKeys.includes(entry.sourceKey))
    page.sourceKeys.push(entry.sourceKey);
}

function buildPages(
  input: AgentImportPlanInput,
  parentLevel: number,
): ProposedPage[] {
  const index = input.manifest.index.filter(
    (entry) =>
      isValidImportPath(entry.sourceKey) &&
      entry.sourceKey.split("/").length <= WIKI_LIMITS.treeDepth,
  );
  const pages = new Map<string, ProposedPage>();
  const existing: AgentImportParent = {
    kind: "existing",
    pageId: input.parentId,
  };
  let root: AgentImportParent = existing;
  let rootLevel = parentLevel + 1;
  if (index.some((entry) => groupDirectory(entry.sourceKey) === "")) {
    const page = ensureDirectory(pages, "", existing, rootLevel++);
    root = { kind: "planned", key: page.key };
  }
  for (const entry of index) {
    addSource(pages, entry, {
      root,
      rootLevel,
      file: input.manifest.files.find(
        (file) => file.sourceKey === entry.sourceKey,
      ),
    });
  }
  return [...pages.values()].sort(
    (left, right) =>
      left.level - right.level || left.key.localeCompare(right.key, "en"),
  );
}

function diagnosePages(
  pages: readonly ProposedPage[],
  diagnostics: SourceDiagnostics,
): void {
  for (const page of pages) {
    if (!page.title || countCharacters(page.title) > WIKI_LIMITS.titleLength)
      diagnostics.errors.push({
        code: "INVALID_REQUEST",
        reason: "invalid_title",
        sourceKeys: page.sourceKeys,
        targetKey: page.key,
        limit: WIKI_LIMITS.titleLength,
      });
    if (page.level > WIKI_LIMITS.treeDepth)
      diagnostics.errors.push({
        code: "INVALID_REQUEST",
        reason: "tree_too_deep",
        sourceKeys: page.sourceKeys,
        targetKey: page.key,
        limit: WIKI_LIMITS.treeDepth,
      });
    if (page.sourceKeys.length > 1)
      diagnostics.conflicts.push({
        code: "CONFLICT",
        reason: "group_content_conflict",
        sourceKeys: page.sourceKeys,
        targetKey: page.key,
      });
  }
}

function titleConflicts(
  pages: readonly ProposedPage[],
  state: TargetState,
): AgentImportIssue[] {
  const groups = new Map<string, ProposedPage[]>();
  for (const page of pages) {
    const key = JSON.stringify([page.parent, page.title]);
    const siblings = groups.get(key) ?? [];
    siblings.push(page);
    groups.set(key, siblings);
  }
  const childrenByTitle = new Map<string, string[]>();
  for (const child of state.children) {
    const title = normalizeWikiTitle(child.title);
    const identifiers = childrenByTitle.get(title) ?? [];
    identifiers.push(child.id);
    childrenByTitle.set(title, identifiers);
  }
  const conflicts: AgentImportIssue[] = [];
  for (const group of groups.values()) {
    for (const page of group) {
      const siblings = group.filter((other) => other.key !== page.key);
      const existing =
        page.parent.kind === "existing"
          ? (childrenByTitle.get(page.title) ?? [])
          : [];
      if (siblings.length || existing.length)
        conflicts.push({
          code: "CONFLICT",
          reason: "title_conflict",
          sourceKeys: [
            ...page.sourceKeys,
            ...siblings.flatMap((sibling) => sibling.sourceKeys),
          ],
          targetKey: page.key,
          existingPageIds: existing,
        });
    }
  }
  return conflicts;
}

function matchesPage(issue: AgentImportIssue, page: ProposedPage): boolean {
  return (
    issue.targetKey === page.key ||
    issue.sourceKeys.some((key) => page.sourceKeys.includes(key))
  );
}

function presentPages(
  pages: readonly ProposedPage[],
  diagnostics: SourceDiagnostics,
): AgentImportPage[] {
  const actions = new Map<string, AgentImportPage["action"]>();
  return pages.map((page) => {
    let action: AgentImportPage["action"] = "create";
    if (diagnostics.conflicts.some((issue) => matchesPage(issue, page)))
      action = "conflict";
    if (
      diagnostics.errors.some(
        (issue) =>
          matchesPage(issue, page) ||
          (issue.sourceKeys.length === 0 && issue.targetKey === undefined),
      )
    )
      action = "invalid";
    if (
      action === "create" &&
      page.parent.kind === "planned" &&
      actions.get(page.parent.key) !== "create"
    )
      action = "blocked";
    actions.set(page.key, action);
    return {
      key: page.key,
      title: page.title,
      titleSource: page.titleSource,
      sourceKeys: page.sourceKeys,
      isDirectory: page.isDirectory,
      contentBytes: page.contentBytes,
      level: page.level,
      action,
    };
  });
}

/** Plans bounded Markdown packages using visibility-filtered reads and no persistence or UI state paths. */
export class WikiImportPlanner {
  private readonly repository: WikiRepository;
  private readonly access: WikiAccess;

  public constructor(repository: WikiRepository, access: WikiAccess) {
    this.repository = repository;
    this.access = access;
  }

  /** Returns source mappings, proposed edges, diagnostics, asset mentions and a deterministic state fingerprint. */
  public async plan(
    actor: User,
    request: unknown,
  ): Promise<PagesAgentReadResponse> {
    const input = readWikiImportManifest(request);
    const viewer = await this.access.resolve(actor);
    const state = await this.readTarget(viewer, input);
    const diagnostics = diagnoseSources(input);
    if (!state.canWrite)
      diagnostics.errors.push({
        code: "FORBIDDEN",
        reason: "write_permission_required",
        sourceKeys: [],
      });
    if (state.isTemplate)
      diagnostics.errors.push({
        code: "INVALID_REQUEST",
        reason: "invalid_parent",
        sourceKeys: [],
      });
    const pages = buildPages(input, state.parents.length);
    diagnosePages(pages, diagnostics);
    diagnostics.conflicts.push(...titleConflicts(pages, state));
    const result: AgentImportPlan = {
      projectId: input.projectId,
      parentId: input.parentId,
      fingerprint: wikiImportFingerprint(input, state),
      pages: presentPages(pages, diagnostics),
      edges: pages.map((page) => ({ childKey: page.key, parent: page.parent })),
      ...diagnostics,
      assets: input.manifest.files
        .filter((file) => isValidImportPath(file.sourceKey))
        .flatMap((file) => scanRelativeLinks(file.sourceKey, file.content)),
      contentComplete: input.manifest.index.every((entry) =>
        input.manifest.files.some((file) => file.sourceKey === entry.sourceKey),
      ),
      valid:
        diagnostics.errors.length === 0 && diagnostics.conflicts.length === 0,
      limits: AGENT_IMPORT_LIMITS,
      externalEffects: [],
    };
    const response: PagesAgentReadResponse = { apiVersion: "1", result };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
        constraint: "responseBytes",
        limit: PAGES_AGENT_LIMITS.responseBytes,
      });
    return response;
  }

  private async readTarget(
    viewer: WikiViewer,
    input: AgentImportPlanInput,
  ): Promise<TargetState> {
    if (!viewer.scope.projectIds.includes(input.projectId))
      throw new AgentOperationError("NOT_FOUND");
    const reader = new WikiPageReader(this.repository);
    const parents: WikiImportTargetState["parents"][number][] = [];
    let parentId = input.parentId;
    let isTemplate = false;
    try {
      while (parentId !== null) {
        const page = await reader.require(viewer.scope, parentId);
        if (
          page.projectId !== input.projectId ||
          page.scope !== WIKI_SCOPE.PROJECT
        )
          throw new AgentOperationError("NOT_FOUND");
        if (parentId === input.parentId) isTemplate = page.isTemplate;
        parents.push({
          id: page.id,
          revision: page.revision,
          parentId: page.parentId,
        });
        parentId = page.parentId;
      }
    } catch (error: unknown) {
      if (error instanceof WikiPageNotFoundError)
        throw new AgentOperationError("NOT_FOUND");
      throw error;
    }
    const children = await this.repository.pages.listProjectChildren(
      viewer.scope,
      input.projectId,
      input.parentId,
    );
    return { parents, children, canWrite: viewer.canWrite, isTemplate };
  }
}
