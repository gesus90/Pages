import { createHash, randomUUID } from "node:crypto";
import { link, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";
import { readArchiveSteps } from "@/backend/agents/PageAgentRecordInput";

import {
  agentArtifactRoot,
  artifactDirectory,
  requireArtifactId,
} from "./AgentArtifactPath";
import { sanitizePlanOutput } from "./AgentPlanOutput";

import type { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PageAgentRunRecord } from "@/definition/PageAgent";
import type { ArchiveAgentStep } from "@/backend/agents/PageAgentRecordInput";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

function safeText(text: string): string {
  return sanitizePlanOutput(redactAssistantCredentials(text));
}

/** Persists one private markdown artifact per terminal invocation, never a DREAMING analysis. */
export class AgentRunArchive {
  private readonly repository: PageAgentRunRepository;
  private readonly dataDirectory: string;

  public constructor(
    repository: PageAgentRunRepository,
    dataDirectory: string,
  ) {
    this.repository = repository;
    this.dataDirectory = dataDirectory;
  }

  /** Records dispatched input before starting the adapter, with pasted credentials redacted. */
  public async input(
    planRunId: string,
    stepId: string,
    prompt: string,
  ): Promise<void> {
    await this.repository.input(planRunId, stepId, safeText(prompt));
  }

  /** Archives all terminal steps, including skipped, blocked, failed and cancelled steps. */
  public async complete(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
  ): Promise<void> {
    await this.completeSteps(run, readArchiveSteps(snapshot));
  }

  /** Startup repairs missing files and records from terminal history, without provider calls. */
  public async recover(): Promise<void> {
    for (const { run, steps } of await this.repository.terminalPlans())
      await this.completeSteps(run, steps);
  }

  /** Delivery additionally requires executor identity; the route checks agent and source-resource access. */
  public async read(
    userId: string,
    agentId: string,
    runId: string,
  ): Promise<{
    readonly record: PageAgentRunRecord;
    readonly markdown: string;
  }> {
    requireArtifactId(agentId);
    requireArtifactId(runId);
    const record = await this.repository.find(agentId, runId);
    if (!record || record.userId !== userId)
      throw new AgentError("agent_usage_denied");
    const filename = await this.materialize(record);
    return { record, markdown: await readFile(filename, "utf8") };
  }

  private async completeSteps(
    run: AgentPlanRun,
    steps: readonly ArchiveAgentStep[],
  ): Promise<void> {
    for (const step of steps) {
      const result = run.steps.find((entry) => entry.id === step.stepId);
      if (
        !result ||
        result.status === "running" ||
        (result.status === "waiting" && run.status === "running")
      )
        continue;
      let status: PageAgentRunRecord["status"] = "failed";
      if (result.status === "succeeded" || result.status === "cancelled")
        status = result.status;
      if (result.error === "timeout" || result.error === "check_timeout")
        status = "timeout";
      const record = await this.repository.save({
        agentId: step.agentId,
        runId: createHash("sha256")
          .update(`${run.id}\n${step.stepId}`)
          .digest("hex"),
        planRunId: run.id,
        userId: run.userId,
        startedAt: run.startedAt,
        finishedAt: new Date().toISOString(),
        status,
        model: step.model,
        reasoningEffort: step.reasoningEffort,
        input: safeText(
          (await this.repository.prompt(run.id, step.stepId)) ?? step.input,
        ),
        result: safeText(result.output ?? result.error ?? result.cancellation),
      });
      await this.materialize(record);
    }
  }

  private async materialize(record: PageAgentRunRecord): Promise<string> {
    requireArtifactId(record.runId);
    const root = await agentArtifactRoot(this.dataDirectory);
    const directory = await artifactDirectory(root, [record.agentId, "runs"]);
    const filename = path.join(directory, `${record.runId}.md`);
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    const metadata = { ...record, input: undefined, result: undefined };
    const markdown = `# Agent run ${record.runId}\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n\n## Input\n\n${record.input}\n\n## Result\n\n${record.result}\n`;
    try {
      await writeFile(temporary, markdown, { flag: "wx", mode: 0o400 });
      await link(temporary, filename).catch((error: unknown) => {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        )
          throw error;
      });
    } finally {
      await rm(temporary, { force: true });
    }
    return filename;
  }
}
