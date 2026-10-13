import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAgentServices } from "@/app/lib/agent-services.server";
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createPageAgentHarness, pageAgentInput } from "../helpers/page-agents";
import { useMigratedDatabase } from "../helpers/test-database";

describe("PAGE-20 production wiring", () => {
  const getDatabase = useMigratedDatabase();
  let directory = "";
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the definition and the run records of every agent in the agent folder, apart from the data folder", async () => {
    const current = await createPageAgentHarness(getDatabase());
    directory = current.wiki.filesDirectory;
    const data = path.join(directory, "data");
    const agents = path.join(directory, "config", "Agents");
    const services = createAgentServices(
      getDatabase(),
      data,
      Buffer.alloc(32, 7),
      agents,
    );
    const administrative = await services.agentProfileService.save(
      current.admin,
      null,
      {
        name: "Administrator agent",
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "medium",
        isActive: true,
        purposes: ["agent"],
        targets: [{ kind: "system", targetId: "agent" }],
        configuration: {
          ...emptyAgentConfiguration("system"),
          sharing: { isGlobal: true, targets: [] },
        },
      },
    );
    const owned = await services.pageAgentService.save(
      current.bob.id,
      null,
      pageAgentInput(),
    );
    expect((await readdir(agents)).sort()).toEqual(
      [administrative, owned].sort(),
    );
    for (const id of [administrative, owned])
      expect(
        await readFile(path.join(agents, id, "AGENT.md"), "utf8"),
      ).toContain(`Agent-ID: ${id}`);
    // The run archive of the same services writes beside the definitions.
    await new PageAgentRunRepository(getDatabase()).save({
      agentId: owned,
      runId: "a".repeat(64),
      planRunId: "plan-run",
      userId: current.bob.id,
      startedAt: "2026-10-13T08:00:00.000Z",
      finishedAt: "2026-10-13T08:01:00.000Z",
      status: "timeout",
      model: "model-a",
      reasoningEffort: null,
      input: "Prepared input",
      result: "timeout",
    });
    await services.agentRunArchive.recover();
    expect(await readdir(path.join(agents, owned, "runs"))).toEqual([
      `${"a".repeat(64)}.md`,
    ]);
    // Building the services creates nothing of its own in the data folder.
    await expect(stat(data)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
