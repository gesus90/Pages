import type { PicaAcpJobDependencies, PicaAcpRun } from "./PicaAcpJob";
import type { PicaAcpJobPool } from "./PicaAcpPoolOpening";
import type {
  PicaAcpEmployeeRun,
  PicaAcpServiceDependencies,
  PicaAcpStart,
} from "./PicaAcpService";

/** Optional host-backed tools bound to the job's working directory. */
export function employeeToolDependencies(
  employee: PicaAcpEmployeeRun | undefined,
  directory: string,
): Partial<PicaAcpJobDependencies> {
  if (!employee) return {};
  const { attachFile, generateImages, generateMedia, readAttachments } =
    employee;
  return {
    ...(attachFile
      ? {
          attachHostFile: (target, file) => attachFile(directory, target, file),
        }
      : {}),
    ...(generateImages
      ? {
          generateImages: (parameters, signal) =>
            generateImages(directory, parameters, signal),
        }
      : {}),
    ...(generateMedia
      ? {
          generateMedia: (kind, parameters, signal) =>
            generateMedia(kind, directory, parameters, signal),
        }
      : {}),
    ...(readAttachments
      ? {
          readAttachments: (action, parameters, signal) =>
            readAttachments(action, directory, parameters, signal),
        }
      : {}),
  };
}

/**
 * The kept chat session of an agent employee's job.
 * @remarks
 * Every value that shapes the native session is part of its fingerprint, so
 * a changed connection, model, effort, access, folder or agent starts a new
 * one instead of continuing the resting one.
 */
export function keptPicaSession(
  input: PicaAcpStart,
  pool: PicaAcpServiceDependencies["pool"],
  job: {
    readonly sessionId: string;
    readonly run: PicaAcpRun;
    readonly directory: string;
  },
): PicaAcpJobPool | undefined {
  const kept = input.employee?.keptSession;
  if (!kept || !pool) return undefined;
  const { agent, actor } = input;
  return {
    sessions: pool,
    session: {
      chatSessionId: job.sessionId,
      agentId: actor.id,
      agentName: actor.displayName,
      conversation: kept.conversation,
      fingerprint: JSON.stringify([
        agent.connection.id,
        agent.model,
        agent.reasoningEffort,
        job.run.runner.profile,
        job.run.options,
        job.directory,
        agent.connection.provider,
        agent.connection.cliLoggedInAt,
        job.run.runner.hostMcpServers,
      ]),
    },
  };
}

/** The dependencies of a job: Pica's, or those bound to the configuration of an agent employee. */
export function employeeJobDependencies(
  base: PicaAcpServiceDependencies,
  employee: PicaAcpEmployeeRun | undefined,
  agentDeletions: PicaAcpJobDependencies["agentDeletions"],
): PicaAcpServiceDependencies {
  if (!employee)
    return {
      ...base,
      agentBrowsers: undefined,
      agentDeletions,
    };
  return {
    ...base,
    agentDeletions: undefined,
    agentBrowsers: employee.hasBrowser ? base.agentBrowsers : undefined,
    requireCurrent: () => employee.requireCurrent(),
    searchMemory: (query) => employee.searchMemory(query),
    ...(employee.readConversationContext
      ? { readConversationContext: employee.readConversationContext }
      : {}),
    ...(employee.readOwnChat ? { readOwnChat: employee.readOwnChat } : {}),
    ...(employee.logbook ? { logbook: employee.logbook } : {}),
    ...(employee.recipes ? { recipes: employee.recipes } : {}),
    ...(employee.agentChat ? { agentChat: employee.agentChat } : {}),
    ...(employee.liveAnswer ? { liveAnswer: employee.liveAnswer } : {}),
    access: {
      requireUser: (_, connectionId) =>
        employee.requireConnection(connectionId),
    },
  };
}
