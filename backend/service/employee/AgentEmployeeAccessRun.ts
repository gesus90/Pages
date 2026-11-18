import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { effectiveAgentAccess } from "@/definition/AgentAccessMode";
import { employeeAccessMode } from "@/definition/AgentEmployee";
import { agentToolPolicy } from "@/definition/AgentToolGroups";

import { employeeAcpRunner } from "../chat/acp/EmployeeAcpRunners";
import { createAgentToolkitJob } from "../chat/toolkit/AgentToolkit";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { User } from "@/definition/User";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type { PicaAcpStart } from "../chat/acp/PicaAcpService";
import type { AgentToolkitJobInput } from "../chat/toolkit/AgentToolkit";
import type { AgentEmployeeSessionDependencies } from "./AgentEmployeeSessionTypes";

/** What the mode of an agent employee decides for one job. */
export type AgentEmployeeAccessRun = Pick<
  NonNullable<PicaAcpStart["employee"]>,
  "runner" | "hasBrowser" | "toolkit" | "attachFile" | "hasAdministratorRights"
>;

/**
 * The runner, browser, toolkit and host file attachment of one job of an
 * agent employee, in a direct or group chat or in a run of its own.
 * @param dependencies - The services of the employee sessions.
 * @param account - The agent's account and its stored settings.
 * @param job - The resolved assignment and the chat-bound tools of the job.
 * @returns The same rights for both kinds of job, taken from
 * {@link effectiveAgentAccess}: YOLO gets the host's MCP servers, the shell
 * and writing file tools on the whole host and the file attachment of the
 * host; "Lesend" reads the host outside the instance folders of Pages.
 * @throws {AgentEmployeeError} `accessModeRequired` for the earlier
 * `workspace`, which needs a choice of "Lesend" or "YOLO" first.
 * @remarks
 * The ACP session itself starts on the same native launcher as every plan
 * node; only the chat rounds and the session's lifetime differ.
 */
export async function employeeAccessRun(
  dependencies: AgentEmployeeSessionDependencies,
  account: { readonly agent: User; readonly employee: StoredAgentEmployee },
  job: {
    readonly assignment: ResolvedAgentAssignment;
    readonly chatTools: Pick<
      AgentToolkitJobInput,
      "interactions" | "chatTasks" | "history"
    >;
  },
): Promise<AgentEmployeeAccessRun> {
  const { agent, employee } = account;
  const { access } = employee;
  const mode = employeeAccessMode(access);
  if (mode === null) throw new AgentEmployeeError("accessModeRequired");
  const effective = effectiveAgentAccess(mode);
  const policy = agentToolPolicy(access, employee.disabledToolGroups);
  const hostServers = effective.hostMcpServers
    ? ((await dependencies.accessEnvironment?.chatServers(
        job.assignment.connection.provider,
        access,
      )) ?? [])
    : [];
  const protectedDirectories =
    effective.files === "read" ? dependencies.toolkitHiddenDirectories : null;
  const { hostFiles } = dependencies;
  return {
    runner: employeeAcpRunner(job.assignment, access, hostServers),
    hasAdministratorRights: employee.hasAdministratorRights,
    // The browser follows the tool policy: only reading in "Lesend".
    hasBrowser: policy.browser !== "off",
    // Every model gets the same toolkit over the bridge of Pages.
    toolkit: (directory) =>
      createAgentToolkitJob({
        agentId: agent.id,
        root: directory,
        policy,
        ...job.chatTools,
        ...(protectedDirectories ? { protectedDirectories } : {}),
      }),
    ...(hostFiles && effective.files === "read_write" && policy.pages === "full"
      ? {
          attachFile: (directory, target, file) =>
            hostFiles.attach(agent, { directory, file, target }),
        }
      : {}),
  };
}
