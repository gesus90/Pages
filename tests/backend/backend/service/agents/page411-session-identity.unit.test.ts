import { readPlanSessionRecord } from "@/backend/agents/AgentPlanSessionInput";
import { expect, it, vi } from "vitest";

import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import {
  readAttemptRow,
  readUsageRow,
} from "@/backend/database/repositories/agent/AgentSessionRows";
import {
  describeSessionModel,
  sessionStart,
} from "@/backend/service/agents/sessions/AgentSessionAttempts";
import { sumTurnUsage } from "@/backend/service/agents/sessions/AgentSessionUsage";
import { runnerLabel } from "@/backend/service/agents/AgentPlanSessionRecords";

import { sessionRecord, sessionRun } from "./page85-session-fixture";

import type { Database } from "@/backend/database/Database";

const MODEL = "deepseek/deepseek-v4.1-flash";

function providerSessionRecord(
  provider: "openrouter" | "zai",
): ReturnType<typeof sessionRecord> {
  const base = sessionRecord();
  return {
    ...base,
    runner: provider,
    requested: { ...base.requested, runner: provider, model: MODEL },
    effective: { model: MODEL, reasoningEffort: "low" },
  };
}

it.each(["openrouter", "zai"] as const)(
  "retains %s's public identity in journals and session starts",
  (provider) => {
    const record = providerSessionRecord(provider);
    expect(
      readPlanSessionRecord({
        ...record,
        group: {
          groupId: "group",
          adapter: provider,
          role: "created",
          creatorStepId: "node",
          turn: 1,
          acpSessionId: "native",
          nativeSessionId: "native",
        },
      }),
    ).toMatchObject({
      runner: provider,
      requested: { runner: provider, model: MODEL },
      group: { adapter: provider },
    });
    expect(runnerLabel(record)).toBe(
      provider === "openrouter" ? "OpenRouter over ACP" : "z.AI over ACP",
    );
    const started = sessionStart(
      { run: sessionRun([]), step: { step: { id: "node" } }, record },
      "instance",
    );
    expect(started?.provider).toBe(provider);
    expect(describeSessionModel(record, null).confirmedModel).toMatchObject({
      value: MODEL,
      source: "adapter_selector",
    });
  },
);

it.each(["openrouter", "zai"] as const)(
  "retains %s's public identity in attempts, usage and restarted process leases",
  async (provider) => {
    const attempt = readAttemptRow([
      "attempt",
      "plan",
      "run",
      "node",
      "owner",
      provider,
      "instance",
      null,
      "idle",
      null,
      null,
      null,
      null,
      MODEL,
      "adapter_selector",
      "today",
      "low",
      "acp_config_option",
      "today",
      null,
      null,
      null,
      null,
      "today",
      null,
      null,
    ]);
    expect(attempt).toMatchObject({
      provider,
      confirmedModel: { value: MODEL },
    });
    const usage = readUsageRow([
      "attempt",
      1,
      provider,
      MODEL,
      12,
      3,
      null,
      null,
      15,
      null,
      1,
      "today",
    ]);
    expect(sumTurnUsage([usage])[0]).toMatchObject({
      provider,
      models: [MODEL],
      isPartial: true,
    });
    const database: Pick<Database, "query" | "execute"> = {
      query: vi.fn<Database["query"]>(async () => [
        [
          "instance",
          "owner",
          provider,
          "run",
          "node",
          "idle",
          "today",
          null,
          null,
          null,
          null,
          null,
        ],
      ]),
      execute: vi.fn(async () => undefined),
    };
    const leases = await new AcpResourceRepository(database).list();
    expect(leases[0]).toMatchObject({
      provider,
      instanceId: "instance",
      state: "idle",
    });
  },
);
