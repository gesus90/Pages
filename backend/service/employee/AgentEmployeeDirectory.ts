import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import {
  AGENT_LEARNING_INTERVAL_HOURS,
  countWords,
} from "@/definition/AgentEmployee";

import { addHours, databaseTimeToIso } from "./AgentEmployeeText";

import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentEmployee,
  AgentEmployeeListItem,
  AgentLearningState,
} from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";
import type { AgentActivityService } from "./AgentActivityService";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";

/** What the directory reads from. */
interface DirectoryDependencies {
  readonly authorization: AuthorizationRepository;
  readonly models: AgentEmployeeModels;
  readonly activity: AgentActivityService;
}

/**
 * When the next learning run of an agent is due: one rhythm after the last
 * run, or after the creation of an agent that never learned.
 */
export function nextLearningAt(agent: StoredAgentEmployee): Date {
  return addHours(
    agent.lastLearningAt ?? agent.createdAt,
    agent.learningIntervalHours || AGENT_LEARNING_INTERVAL_HOURS,
  );
}

function learningState(agent: StoredAgentEmployee): AgentLearningState {
  return {
    isEnabled: agent.isLearningEnabled,
    intervalHours: agent.learningIntervalHours,
    lastRunAt: databaseTimeToIso(agent.lastLearningAt),
    nextRunAt: agent.isLearningEnabled
      ? nextLearningAt(agent).toISOString()
      : null,
    lastResult: agent.lastLearningResult,
  };
}

/**
 * Reads agents as the administration shows them: the account, its role and
 * departments, the model and the documents (PAGE-266).
 */
export class AgentEmployeeDirectory {
  private readonly dependencies: DirectoryDependencies;

  public constructor(dependencies: DirectoryDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists the agents whose accounts pass the visibility check, by name. */
  public async list(
    snapshot: AuthorizationSnapshot,
    isVisible: (account: AccountAccess) => boolean,
  ): Promise<AgentEmployeeListItem[]> {
    const { authorization } = this.dependencies;
    const store = authorization.employees();
    const [users, employees, titles] = await Promise.all([
      authorization.users().findAll(),
      store.employees().list(),
      store.identities().jobTitles(),
    ]);
    const items: AgentEmployeeListItem[] = [];
    for (const user of users) {
      const account = snapshot.accounts.find(
        (candidate) => candidate.userId === user.id,
      );
      const employee = employees.find((entry) => entry.userId === user.id);
      if (!user.isAgent || !account || !employee || !isVisible(account))
        continue;
      items.push(
        await this.listItem(user, account, {
          employee,
          position: titles.get(user.id) ?? null,
        }),
      );
    }
    return items;
  }

  /** Reads the full panel of one agent account. */
  public async detail(
    snapshot: AuthorizationSnapshot,
    account: AccountAccess,
  ): Promise<AgentEmployee> {
    const { authorization } = this.dependencies;
    const store = authorization.employees();
    const [user, employee, titles, archiveWords] = await Promise.all([
      authorization.users().findById(account.userId),
      store.employees().find(account.userId),
      store.identities().jobTitles(),
      store.memory().archiveWords(account.userId),
    ]);
    if (!user || !employee) throw new AgentEmployeeError("notFound");
    const item = await this.listItem(user, account, {
      employee,
      position: titles.get(user.id) ?? null,
    });
    return {
      ...item,
      departmentIds: account.departments.filter((id) =>
        snapshot.departments.some((department) => department.id === id),
      ),
      settings: {
        connectionId: employee.connectionId,
        model: employee.model,
        reasoningEffort: employee.reasoningEffort,
        access: employee.access,
      },
      documents: {
        soul: employee.soul,
        instructions: employee.instructions,
      },
      voice: {
        voiceId: employee.voiceId,
        speedTenths: employee.voiceSpeedTenths,
      },
      memory: employee.memory,
      memoryUsage: {
        coreWords: countWords(employee.memory),
        archiveWords,
      },
      learning: learningState(employee),
      cost: await this.dependencies.activity.cost(employee),
      revision: employee.revision,
      createdAt: databaseTimeToIso(employee.createdAt) ?? employee.createdAt,
      updatedAt: databaseTimeToIso(employee.updatedAt) ?? employee.updatedAt,
    };
  }

  private async listItem(
    user: User,
    account: AccountAccess,
    stored: {
      readonly employee: StoredAgentEmployee;
      readonly position: string | null;
    },
  ): Promise<AgentEmployeeListItem> {
    const description = await this.dependencies.models.describe(
      stored.employee,
    );
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      position: stored.position,
      avatarColor: user.avatarColor ?? null,
      avatarImageUrl:
        user.avatarType === "image" ? (user.avatarImageUrl ?? null) : null,
      isActive: user.isActive,
      modelName: description.modelName,
      provider: description.provider,
      roleId: account.role?.id ?? null,
      roleName: account.role?.name ?? null,
    };
  }
}
