import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { readAgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";
import { AGENT_EMPLOYEE_ACCESS_MODES } from "@/definition/AgentEmployee";
import { PERSON_COLORS } from "@/definition/PersonColor";

import { McpAgentError } from "./McpAgentError";
import {
  pageOf,
  projectActivity,
  projectAgent,
  projectAgentSummary,
  projectArchiveEntry,
  projectMemoryVersion,
  projectModelOption,
  projectTemplate,
  projectUsages,
} from "./McpAgentProjection";

import type {
  AgentAvatarUpload,
  AgentEmployeeAdministration,
} from "@/backend/service/employee/AgentEmployeeAdministration";
import type { AgentTemplateService } from "@/backend/service/employee/AgentTemplateService";
import type { AgentEmployee } from "@/definition/AgentEmployee";
import type { AgentInstructionTemplate } from "@/definition/AgentInstructionTemplate";
import type {
  McpAgentActivityResponse,
  McpAgentArchiveEntryResponse,
  McpAgentMemoryVersionResponse,
  McpAgentModelOption,
  McpAgentOptionsResponse,
  McpAgentRemovalQuestion,
  McpAgentResponse,
  McpAgentSummary,
} from "./McpAgentContract";
import type {
  McpAgentActivityRequest,
  McpAgentArchiveRequest,
  McpAgentCreateRequest,
  McpAgentListRequest,
  McpAgentRemovalRequest,
  McpAgentRestoreRequest,
  McpAgentUpdateRequest,
} from "./McpAgentRequest";

/** Archive entries of one page. */
const ARCHIVE_PAGE_SIZE = 25;
/** Activity lines of one page. */
const ACTIVITY_PAGE_SIZE = 25;

/** The fields of the agent panel, as the shared input check of the interface reads them. */
type PanelFields = Readonly<Record<string, unknown>>;

/** The panel fields of a new agent; a template fills `AGENT.md` when it is absent. */
function createFields(
  request: McpAgentCreateRequest,
  template: AgentInstructionTemplate | null,
): PanelFields {
  return {
    displayName: request.name,
    username: request.username,
    position: request.position,
    avatarColor: request.color ?? null,
    roleId: request.roleId,
    departments: request.departmentIds ?? [],
    connectionId: request.model.connectionId,
    model: request.model.modelId,
    reasoningEffort: request.reasoning ?? null,
    access: request.access,
    soul: request.soul ?? "",
    instructions: request.agentInstructions ?? template?.content ?? "",
    isLearningEnabled: request.isLearningEnabled ?? true,
  };
}

/** Picks the changed value; `undefined` keeps the stored one, `null` clears it. */
function changed<Value>(next: Value | undefined, stored: Value): Value {
  if (next === undefined) return stored;
  return next;
}

/** Model, reasoning and access of a change laid over the stored ones. */
function mergedSettings(
  agent: AgentEmployee,
  request: McpAgentUpdateRequest,
): PanelFields {
  const { settings } = agent;
  return {
    connectionId: request.model?.connectionId ?? settings.connectionId,
    model: request.model?.modelId ?? settings.model,
    reasoningEffort: changed(request.reasoning, settings.reasoningEffort),
    access: request.access ?? settings.access,
  };
}

/** The stored panel with the fields of a change laid over it; an absent field stays. */
function mergedFields(
  agent: AgentEmployee,
  request: McpAgentUpdateRequest,
): PanelFields {
  return {
    displayName: request.name ?? agent.displayName,
    username: request.username ?? agent.username,
    position: request.position ?? agent.position,
    avatarColor: changed(request.color, agent.avatarColor),
    roleId: request.roleId ?? agent.roleId,
    departments: request.departmentIds ?? agent.departmentIds,
    ...mergedSettings(agent, request),
    soul: request.soul ?? agent.documents.soul,
    instructions: request.agentInstructions ?? agent.documents.instructions,
    memory: request.memory ?? null,
    // The limits and DREAM.md stay as they are (PAGE-305).
    memoryCharacters: agent.memoryLimits.memoryCharacters,
    dreamCharacters: agent.memoryLimits.dreamCharacters,
    isLearningEnabled: request.isLearningEnabled ?? agent.learning.isEnabled,
  };
}

/** Whether a change names nothing but the activation. */
function isOnlyActivation(request: McpAgentUpdateRequest): boolean {
  return (
    request.isActive !== undefined &&
    Object.keys(request).every(
      (key) =>
        key === "revision" ||
        key === "isActive" ||
        key === "costLimitUsdPerMonth",
    )
  );
}

function matchesText(agent: AgentEmployee, text: string): boolean {
  const needle = text.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return [agent.displayName, agent.username, agent.position ?? ""].some(
    (field) => field.toLocaleLowerCase().includes(needle),
  );
}

/**
 * Manages agent employees for a paired machine (PAGE-267).
 *
 * @remarks
 * Every call runs through the administration of agents of the user
 * administration on the MCP channel, with the same checks of rights, role,
 * departments, model, limits and revision as the agents tab, so a change
 * appears in both at once. This class only adds what the interface of the
 * program needs: the shape of the answers, the question before a removal
 * and pages of long lists. The archive is only read here.
 */
export class McpAgentService {
  private readonly administration: AgentEmployeeAdministration;
  private readonly templates: AgentTemplateService;

  /**
   * Creates the service.
   *
   * @param administration - The administration of agents, already on the MCP channel.
   * @param templates - The stored templates of `AGENT.md`, already on the MCP channel.
   */
  public constructor(
    administration: AgentEmployeeAdministration,
    templates: AgentTemplateService,
  ) {
    this.administration = administration;
    this.templates = templates;
  }

  /** Lists the agents matching the search, by name. */
  public async list(
    actorId: string,
    request: McpAgentListRequest,
  ): Promise<{ readonly agents: readonly McpAgentSummary[] }> {
    const agents = await this.administration.employees(actorId);
    return {
      agents: agents
        .filter((agent) => matchesText(agent, request.text ?? ""))
        .filter(
          (agent) =>
            request.status === undefined ||
            agent.isActive === (request.status === "active"),
        )
        .map(projectAgentSummary),
    };
  }

  /** The choices of the panel: models, roles, departments, colors, access modes and templates. */
  public async options(actorId: string): Promise<McpAgentOptionsResponse> {
    const [page, choices, templates] = await Promise.all([
      this.administration.page(actorId),
      this.administration.choices(actorId),
      this.templates.list(actorId),
    ]);
    return {
      models: page.models
        .map(projectModelOption)
        .filter((model): model is McpAgentModelOption => model !== null),
      roles: choices.roles.map((role) => ({ id: role.id, name: role.name })),
      departments: choices.departments.map((department) => ({
        id: department.id,
        name: department.name,
      })),
      colors: PERSON_COLORS,
      accessModes: AGENT_EMPLOYEE_ACCESS_MODES,
      templates: templates.templates.map(projectTemplate),
    };
  }

  /** Creates an agent and answers it as stored. */
  public async create(
    actorId: string,
    request: McpAgentCreateRequest,
  ): Promise<{ readonly agent: McpAgentResponse }> {
    const template =
      request.templateId === undefined
        ? null
        : await this.templates.find(request.templateId);
    if (request.templateId !== undefined && template === null)
      throw new AgentEmployeeError("invalidInput");
    const input = readAgentEmployeeInput(createFields(request, template));
    const agentId = await this.administration.create(actorId, input, null);
    return this.read(actorId, agentId);
  }

  /** Reads one agent. */
  public async read(
    actorId: string,
    agentId: string,
  ): Promise<{ readonly agent: McpAgentResponse }> {
    const detail = await this.administration.detail(actorId, agentId);
    return { agent: projectAgent(detail.agent) };
  }

  /**
   * Changes the named fields of an agent when its revision is current.
   *
   * @throws {McpAgentError} `conflict` with the current revision, `running`
   * for the deactivation of a working agent, and the codes of the input check.
   */
  public async update(
    actorId: string,
    agentId: string,
    request: McpAgentUpdateRequest,
  ): Promise<{ readonly agent: McpAgentResponse }> {
    const { agent } = await this.administration.detail(actorId, agentId);
    if (agent.revision !== request.revision)
      throw new McpAgentError("conflict", agent.revision);
    await this.withCurrentRevision(actorId, agentId, async () => {
      if (isOnlyActivation(request) && request.isActive !== undefined) {
        await this.administration.setActive(actorId, agentId, {
          isActive: request.isActive,
          revision: request.revision,
        });
        return;
      }
      await this.administration.update(
        actorId,
        agentId,
        {
          input: readAgentEmployeeInput(mergedFields(agent, request)),
          revision: request.revision,
          ...(request.isActive === undefined
            ? {}
            : { isActive: request.isActive }),
        },
        null,
      );
    });
    return this.read(actorId, agentId);
  }

  /** Replaces the image of an agent with a validated upload. */
  public async setImage(
    actorId: string,
    agentId: string,
    image: AgentAvatarUpload,
  ): Promise<{ readonly agent: McpAgentResponse }> {
    await this.administration.setAvatar(actorId, agentId, image);
    return this.read(actorId, agentId);
  }

  /** Removes the image of an agent. */
  public async removeImage(
    actorId: string,
    agentId: string,
  ): Promise<{ readonly agent: McpAgentResponse }> {
    await this.administration.removeAvatar(actorId, agentId);
    return this.read(actorId, agentId);
  }

  /**
   * Removes an agent after a confirmed question.
   *
   * @returns Without `confirmed: true` the question with what the removal
   * takes with it, changing nothing; with it `{ removed: true }`.
   */
  public async remove(
    actorId: string,
    agentId: string,
    request: McpAgentRemovalRequest,
  ): Promise<McpAgentRemovalQuestion | { readonly removed: true }> {
    const scope = await this.administration.removalScope(actorId, agentId);
    if (scope.agent.revision !== request.revision)
      throw new McpAgentError("conflict", scope.agent.revision);
    if (request.confirmed !== true)
      return {
        confirmationRequired: true,
        agent: projectAgentSummary(scope.agent),
        usages: projectUsages(scope.usages),
        canRemove: !scope.isRunning,
        blocker: scope.isRunning ? "running" : null,
      };
    await this.withCurrentRevision(actorId, agentId, () =>
      this.administration.remove(actorId, agentId, request.revision),
    );
    return { removed: true };
  }

  /** Lists the versions of `MEMORY.md`, the newest first. */
  public async memoryVersions(
    actorId: string,
    agentId: string,
  ): Promise<{ readonly versions: readonly McpAgentMemoryVersionResponse[] }> {
    const detail = await this.administration.detail(actorId, agentId);
    return {
      versions: detail.memoryDetails.versions.map(projectMemoryVersion),
    };
  }

  /** Restores a version of `MEMORY.md` and its archive. */
  public async restoreMemory(
    actorId: string,
    agent: { readonly id: string; readonly versionId: string },
    request: McpAgentRestoreRequest,
  ): Promise<{ readonly agent: McpAgentResponse }> {
    await this.withCurrentRevision(actorId, agent.id, () =>
      this.administration.restoreMemory(actorId, agent.id, {
        id: agent.versionId,
        expectedRevision: request.revision,
      }),
    );
    return this.read(actorId, agent.id);
  }

  /** Searches the archive, the newest entries first, one page at a time. */
  public async archive(
    actorId: string,
    agentId: string,
    request: McpAgentArchiveRequest,
  ): Promise<{
    readonly entries: readonly McpAgentArchiveEntryResponse[];
    readonly nextCursor: string | null;
  }> {
    const detail = await this.administration.detail(actorId, agentId);
    const terms = (request.text ?? "")
      .toLocaleLowerCase()
      .split(/\s+/u)
      .filter((term) => term !== "");
    const found = detail.memoryDetails.archive.filter((entry) => {
      const text = `${entry.title} ${entry.content}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
    const page = pageOf(found, {
      cursor: request.cursor,
      size: ARCHIVE_PAGE_SIZE,
    });
    return {
      entries: page.items.map(projectArchiveEntry),
      nextCursor: page.nextCursor,
    };
  }

  /** Reads the activity of an agent, the newest first, one page at a time. */
  public async activity(
    actorId: string,
    agentId: string,
    request: McpAgentActivityRequest,
  ): Promise<{
    readonly activity: readonly McpAgentActivityResponse[];
    readonly nextCursor: string | null;
  }> {
    const detail = await this.administration.detail(actorId, agentId);
    const page = pageOf(detail.activity, {
      cursor: request.cursor,
      size: ACTIVITY_PAGE_SIZE,
    });
    return {
      activity: page.items.map(projectActivity),
      nextCursor: page.nextCursor,
    };
  }

  /** Runs a revision-checked change and answers a stale revision with the current one. */
  private async withCurrentRevision(
    actorId: string,
    agentId: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error: unknown) {
      if (!(error instanceof AgentEmployeeError) || error.code !== "conflict")
        throw error;
      const { agent } = await this.administration.detail(actorId, agentId);
      throw new McpAgentError("conflict", agent.revision);
    }
  }
}
