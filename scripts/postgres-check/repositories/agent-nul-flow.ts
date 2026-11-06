import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { RemoteInstallFindingRepository } from "@/backend/database/repositories/remote/RemoteInstallFindingRepository";
import { RunnerDeployKeyRepository } from "@/backend/database/repositories/runner/RunnerDeployKeyRepository";
import { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";

import { keptOnlyByDuckdb } from "./nul-text-flow";
import { OWNER, PROJECT, STARTED_AT } from "./plan-fixtures";
import { keyRefusedOnPostgres, withoutNul } from "./saved-order-flows";
import { call, prepare } from "./world";

import type { RepositoryFlow, RepositoryStep, RepositoryWorld } from "./world";
import type { NewAgentSessionEvent } from "@/backend/service/agents/sessions/AgentSessionStore";

const NUL = "\u0000";
/** The escape of six characters; it is text like any other. */
const JSON_ESCAPE = "\\u0000";
const ATTEMPT_ID = "attempt-nul";

const CONTEXT = {
  contextUsed: null,
  contextLimit: null,
  percent: null,
  source: null,
  reportedAt: null,
};
const NOT_REPORTED = { value: null, source: null, reportedAt: null };

function attempt(
  attemptId: string,
): Parameters<AgentSessionRepository["saveAttempt"]>[0] {
  return {
    key: { attemptId, planId: "plan-nul", runId: "run-nul", stepId: "review" },
    userId: OWNER,
    provider: "codex_cli",
    instanceId: "instance-nul",
    groupId: null,
    state: "running",
    context: CONTEXT,
    confirmedModel: NOT_REPORTED,
    confirmedReasoning: NOT_REPORTED,
    workspace: null,
    updatedAt: STARTED_AT,
  };
}

function event(text: string, dedupeKey: string | null): NewAgentSessionEvent {
  return {
    turn: 1,
    kind: "agent_message",
    text,
    isTruncated: false,
    createdAt: STARTED_AT,
    dedupeKey,
  };
}

function sessions({ database }: RepositoryWorld): AgentSessionRepository {
  return new AgentSessionRepository(database);
}

function records({ database }: RepositoryWorld): PageAgentRunRepository {
  return new PageAgentRunRepository(database);
}

function reports({ database }: RepositoryWorld): AgentPlanStepReportRepository {
  return new AgentPlanStepReportRepository(database);
}

/** A read of a result in which only the approved removal may differ. */
function readWithoutNul(
  name: string,
  run: (world: RepositoryWorld) => Promise<unknown>,
): RepositoryStep {
  return call(name, async (world) => withoutNul(await run(world)));
}

/** A value with the character reaches a row without it on PostgreSQL. */
const WRITE_STEPS: readonly RepositoryStep[] = [
  call("AgentSessionRepository.saveAttempt", (world) =>
    sessions(world).saveAttempt(attempt(ATTEMPT_ID)),
  ),
  readWithoutNul("AgentSessionRepository.appendEvents", (world) =>
    sessions(world).appendEvents(
      ATTEMPT_ID,
      [event(`Agen${NUL}ten${NUL}text`, null)],
      100,
    ),
  ),
  keptOnlyByDuckdb(
    "SELECT body FROM agent_session_events WHERE attempt_id = 'attempt-nul';",
  ),
  readWithoutNul("AgentSessionRepository.readEvents", (world) =>
    sessions(world).readEvents(ATTEMPT_ID, 0, 10),
  ),
  call("AgentSessionRepository.saveMessage", (world) =>
    sessions(world).saveMessage({
      id: "message-nul",
      attemptId: ATTEMPT_ID,
      userId: OWNER,
      kind: "instruction",
      text: `Anwei${NUL}sung`,
      status: "queued",
      createdAt: STARTED_AT,
      updatedAt: STARTED_AT,
    }),
  ),
  readWithoutNul("AgentSessionRepository.listMessages", (world) =>
    sessions(world).listMessages(ATTEMPT_ID),
  ),
  call("PageAgentRunRepository.pinInput", (world) =>
    records(world).pinInput("run-nul", "review", {
      prompt: `Ein${NUL}gabe`,
      startedAt: STARTED_AT,
    }),
  ),
  readWithoutNul("PageAgentRunRepository.findInput", (world) =>
    records(world).findInput("run-nul", "review"),
  ),
  readWithoutNul("PageAgentRunRepository.save", (world) =>
    records(world).save({
      agentId: "agent-nul",
      runId: "run-nul",
      planRunId: "run-nul",
      userId: OWNER,
      startedAt: STARTED_AT,
      finishedAt: STARTED_AT,
      status: "succeeded",
      model: "model-a",
      reasoningEffort: null,
      input: `Ein${NUL}`,
      result: `${NUL}Aus`,
    }),
  ),
  call("AgentAssetRepository.insert", ({ database }) =>
    new AgentAssetRepository(database).insert({
      id: "asset-nul",
      userId: OWNER,
      status: "staged",
      fileName: `Da${NUL}tei.png`,
      contentType: "image/png",
      kind: "media",
      size: 1,
      checksum: "c",
      storageName: "storage-nul",
      expiresAt: 1,
      pageId: null,
      attachmentId: null,
      createdAt: 1,
    }),
  ),
  readWithoutNul("AgentAssetRepository.find", ({ database }) =>
    new AgentAssetRepository(database).find("asset-nul"),
  ),
];

/** A JSON document holds an escape, never the character, and passes unchanged. */
const ESCAPE_STEPS: readonly RepositoryStep[] = [
  call("AgentPlanStepReportRepository.open", (world) =>
    reports(world).open({
      runId: "run-escape",
      sessionScopeId: "scope",
      stepId: "review",
      attemptId: "attempt",
      termsJson: JSON.stringify({ text: `a${NUL}b`, literal: JSON_ESCAPE }),
    }),
  ),
  call("AgentPlanStepReportRepository.find", (world) =>
    reports(world).find({ runId: "run-escape", sessionScopeId: "scope" }),
  ),
  call("AgentPlanStepReportRepository.save", (world) =>
    reports(world).save(
      { runId: "run-escape", sessionScopeId: "scope", attemptId: "attempt" },
      JSON.stringify({ report: `${NUL}`, kept: `\\${JSON_ESCAPE}` }),
    ),
  ),
  call("AgentPlanStepReportRepository.close", (world) =>
    reports(world).close({
      runId: "run-escape",
      sessionScopeId: "scope",
      attemptId: "attempt",
    }),
  ),
];

/** The character is never taken out of what a statement looks for. */
const READ_STEPS: readonly RepositoryStep[] = [
  call("AgentSessionRepository.findAttempt", (world) =>
    sessions(world).findAttempt(`attempt${NUL}-nul`),
  ),
  call("AgentSessionRepository.updateMessage", (world) =>
    sessions(world).updateMessage(`message${NUL}-nul`, ["queued"], "failed"),
  ),
  call("PageAgentRunRepository.findInput", (world) =>
    records(world).findInput(`run${NUL}-nul`, "review"),
  ),
  call("PageAgentRunRepository.find", (world) =>
    records(world).find("agent-nul", `run${NUL}-nul`),
  ),
  call("AgentAssetRepository.find", ({ database }) =>
    new AgentAssetRepository(database).find(`asset${NUL}-nul`),
  ),
  call("AgentPlanRunRepository.find", ({ database }) =>
    new AgentPlanRunRepository(database).find(`run-a${NUL}`),
  ),
  call("AgentPlanRunRepository.ownership", ({ database }) =>
    new AgentPlanRunRepository(database).ownership(`run-a${NUL}`),
  ),
  call("AgentWorkspaceRepository.usages", ({ database }) =>
    new AgentWorkspaceRepository(database).usages(`workspace-plans${NUL}`),
  ),
  call("RunnerRepository.find", ({ database }) =>
    new RunnerRepository(database).find(`connection${NUL}`),
  ),
  call("RemoteInstallFindingRepository.find", ({ database }) =>
    new RemoteInstallFindingRepository(database).find(`remote${NUL}`),
  ),
];

/** A key without the character would be another key, so it never loses it. */
const IDENTITY_STEPS: readonly RepositoryStep[] = [
  keyRefusedOnPostgres("AgentSessionRepository.saveAttempt", (world) =>
    sessions(world).saveAttempt({
      ...attempt(`${ATTEMPT_ID}${NUL}`),
      state: "failed",
    }),
  ),
  call("AgentSessionRepository.findAttempt", async (world) => ({
    state: (await sessions(world).findAttempt(ATTEMPT_ID))?.state,
  })),
  keyRefusedOnPostgres("AcpResourceRepository.save", ({ database }) =>
    new AcpResourceRepository(database).save({
      instanceId: `lease${NUL}`,
      userId: OWNER,
      provider: "codex_cli",
      runId: null,
      stepId: null,
      state: "starting",
      since: STARTED_AT,
      namespace: null,
    }),
  ),
  prepare("DELETE FROM acp_resource_leases;"),
  keyRefusedOnPostgres("RunnerDeployKeyRepository.create", ({ database }) =>
    new RunnerDeployKeyRepository(database).create({
      projectId: "project-nul",
      key: `ssh-ed25519 NUL${NUL}`,
      title: "Schlüssel",
    }),
  ),
  // The answer to a repeated operation must never be that of another key.
  call("AgentOperationKeyRepository.insert", ({ database }) =>
    new AgentOperationKeyRepository(database).insert(OWNER, "operation-nul", {
      fingerprint: "first",
      operation: "save_plan",
      resultJson: "{}",
    }),
  ),
  keyRefusedOnPostgres("AgentOperationKeyRepository.insert", ({ database }) =>
    new AgentOperationKeyRepository(database).insert(
      OWNER,
      `operation-new${NUL}`,
      { fingerprint: "second", operation: "save_plan", resultJson: "{}" },
    ),
  ),
  call("AgentOperationKeyRepository.find", ({ database }) =>
    new AgentOperationKeyRepository(database).find(OWNER, "operation-new"),
  ),
  call("AgentOperationKeyRepository.find", ({ database }) =>
    new AgentOperationKeyRepository(database)
      .find(OWNER, `operation-nul${NUL}`)
      .then((found) => found?.fingerprint ?? null),
  ),
  // Removing the old results of another operation keeps this one's.
  call("AgentOperationKeyRepository.removeOlder", ({ database }) =>
    new AgentOperationKeyRepository(database).removeOlder(
      OWNER,
      "ui.wiki.save",
      Date.now() + 60_000,
    ),
  ),
  call("AgentOperationKeyRepository.find", ({ database }) =>
    new AgentOperationKeyRepository(database)
      .find(OWNER, "operation-nul")
      .then((found) => found?.fingerprint ?? null),
  ),
  keyRefusedOnPostgres("AgentImportRepository.insertSource", ({ database }) =>
    new AgentImportRepository(database).insertSource({
      projectId: PROJECT,
      sourceKey: `source-new${NUL}`,
      targetKind: "wiki",
      targetId: "page",
      contentHash: "h",
      targetRevision: 1,
      resultJson: "{}",
      lastRunId: "run",
    }),
  ),
  call("AgentImportRepository.findSource", ({ database }) =>
    new AgentImportRepository(database).findSource(PROJECT, "source-new"),
  ),
  keyRefusedOnPostgres(
    "AgentImportRepository.recordStructuredItem",
    ({ database }) =>
      new AgentImportRepository(database).recordStructuredItem(
        "import-nul",
        1,
        {
          kind: "ticket",
          sourceKey: `source-item${NUL}`,
          targetKey: "target",
          action: "skipped",
          targetId: null,
          key: null,
          link: null,
          parentId: null,
          milestoneId: null,
          assets: [],
          reason: null,
          errorCode: null,
        },
      ),
  ),
  call("AgentImportRepository.findStoredItem", ({ database }) =>
    new AgentImportRepository(database).findStoredItem(
      "import-nul",
      "source-item",
    ),
  ),
  // The event of one key is dropped when it repeats, and never the event of another.
  call("AgentSessionRepository.appendEvents", async (world) => ({
    stored: (
      await sessions(world).appendEvents(
        ATTEMPT_ID,
        [event("Werkzeug", `tool:a${NUL}:started`)],
        100,
      )
    ).length,
  })),
  call("AgentSessionRepository.appendEvents", async (world) => ({
    stored: (
      await sessions(world).appendEvents(
        ATTEMPT_ID,
        [event("Wiederholt", `tool:a${NUL}:started`)],
        100,
      )
    ).length,
  })),
  call("AgentSessionRepository.appendEvents", async (world) => ({
    stored: (
      await sessions(world).appendEvents(
        ATTEMPT_ID,
        [event("Anderes Werkzeug", "tool:a:started")],
        100,
      )
    ).length,
  })),
];

/** The one approved difference on the paths of agents and runners, and nothing beside it. */
export const AGENT_NUL_FLOW: RepositoryFlow = {
  title: "agent nul",
  steps: [...WRITE_STEPS, ...ESCAPE_STEPS, ...READ_STEPS, ...IDENTITY_STEPS],
};
