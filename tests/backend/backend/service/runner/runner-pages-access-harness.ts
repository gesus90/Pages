import { vi } from "vitest";

import { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Mock } from "vitest";
import type { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanRemoteAccess } from "@/definition/AgentPlanRemoteAccess";
import type { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { AgentRunScope } from "@/definition/McpAuthorization";
import type { RunnerPagesRequest } from "@/definition/RunnerPagesAccess";

export const RUN_ID = "run-1";
export const STEP_ID = "step-1";
export const ATTEMPT_ID = "attempt-1";
export const USER_ID = "user-1";
export const PLAN_ID = "plan-1";
export const CONNECTION_ID = "connection-1";
export const JOB_ID = "6f1c1c46-95d8-4e13-9f0f-2f3c1ad8b5aa";
export const REQUEST_ID = "0b2ad2a4-6c7c-4d0e-a0b4-0a9d5d8e6c11";
export const TOKEN = "step-token";

type RequestBody = RunnerPagesRequest["request"];

/** A step that has run on the remote host with the given attempt. */
export function runWith(overrides: Record<string, unknown> = {}): AgentPlanRun {
  return partial<AgentPlanRun>({
    id: RUN_ID,
    userId: USER_ID,
    planId: PLAN_ID,
    status: "running",
    stopRequested: false,
    steps: [
      {
        id: STEP_ID,
        status: "running",
        execution: { attemptId: ATTEMPT_ID },
        resourceAccess: { pages: "active" },
      },
    ],
    ...overrides,
  });
}

/** A remote agent step with Pages access, two bound tickets and no files. */
export function remoteWith(
  overrides: Record<string, unknown> = {},
): RemotePlanStep {
  return partial<RemotePlanStep>({
    step: {
      type: "agent",
      id: STEP_ID,
      completion: "todos",
      configuration: {
        provider: "claude_code",
        template: { run: { access: "yolo", timeoutMinutes: 7 } },
      },
    },
    target: { connectionId: CONNECTION_ID },
    command: { pagesAccess: 1 },
    parameters: {
      tickets: {
        first: { id: "ticket-1", key: "PAGE-1" },
        second: { id: "ticket-2", key: "PAGE-2" },
      },
      assets: [],
    },
    ...overrides,
  });
}

/** Wraps a request body in the runner envelope. */
export function envelope(request: RequestBody): Record<string, unknown> {
  return {
    version: 1,
    type: "pages-request",
    requestId: REQUEST_ID,
    jobId: JOB_ID,
    request,
  };
}

/** The mocks behind the service, plus the evidence the service wrote. */
export interface PagesAccessWorld {
  readonly service: RunnerPagesAccessService;
  readonly issue: Mock;
  readonly revoke: Mock;
  readonly runsFind: Mock;
  readonly runsUnfinished: Mock;
  readonly runsSnapshot: Mock;
  readonly requirePlan: Mock;
  readonly authorize: Mock;
  readonly progress: Mock;
  readonly pagesJob: Mock;
  readonly write: Mock;
  readonly api: {
    readonly handle: Mock;
    readonly verify: Mock;
    readonly uploadAsset: Mock;
    readonly downloadAsset: Mock;
  };
  readonly evidence: () => PlanRemoteAccess | undefined;
}

/** Builds the service over mocked repositories, runner service and Pages API. */
export function pagesAccessWorld(): PagesAccessWorld {
  let stored: PlanRemoteAccess | undefined;
  const write = vi.fn(
    async (
      runId: string,
      attemptId: string,
      update: (previous: PlanRemoteAccess | undefined) => PlanRemoteAccess,
    ) => {
      stored = update(stored);
    },
  );
  const issue = vi.fn(async () => ({
    token: TOKEN,
    expiresAt: Date.now() + 60_000,
  }));
  const revoke = vi.fn(async () => 1);
  const runsFind = vi.fn(async () => runWith());
  const runsUnfinished = vi.fn(async () => []);
  const runsSnapshot = vi.fn(async () => ({}));
  const requirePlan = vi.fn(async () => ({
    canEdit: true,
    projectId: "project-1",
  }));
  const authorize = vi.fn(async () => undefined);
  const progress = vi.fn();
  const pagesJob = vi.fn(async () => ({
    plan: { attemptId: ATTEMPT_ID },
  }));
  const api = {
    handle: vi.fn(),
    verify: vi.fn(),
    uploadAsset: vi.fn(),
    downloadAsset: vi.fn(),
  };
  const service = new RunnerPagesAccessService({
    credentials: partial<AgentRunCredentialService>({ issue, revoke }),
    runs: partial<
      ConstructorParameters<typeof RunnerPagesAccessService>[0]["runs"]
    >({
      find: runsFind,
      unfinished: runsUnfinished,
      snapshot: runsSnapshot,
    }),
    plans: partial<
      ConstructorParameters<typeof RunnerPagesAccessService>[0]["plans"]
    >({ require: requirePlan }),
    runners: partial<RunnerService>({ progress, pagesJob }),
    parameters: partial<
      ConstructorParameters<typeof RunnerPagesAccessService>[0]["parameters"]
    >({ authorize }),
    evidence: partial<
      ConstructorParameters<typeof RunnerPagesAccessService>[0]["evidence"]
    >({ write }),
    api: async () => partial<PagesAgentApiService>(api),
  });
  return {
    service,
    issue,
    revoke,
    runsFind,
    runsUnfinished,
    runsSnapshot,
    requirePlan,
    authorize,
    progress,
    pagesJob,
    write,
    api,
    evidence: () => stored,
  };
}

/** Opens the default remote step so that requests can be received. */
export async function openDefault(
  world: PagesAccessWorld,
  remote: RemotePlanStep = remoteWith(),
): Promise<void> {
  await world.service.open(runWith(), remote, ATTEMPT_ID);
}

/** The scope the service asked the credential service to issue first. */
export function issuedScope(world: PagesAccessWorld): AgentRunScope {
  const call: unknown[] = world.issue.mock.calls[0];
  return call[1] as AgentRunScope;
}
