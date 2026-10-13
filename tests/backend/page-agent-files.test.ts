import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readArchiveSteps } from "@/backend/agents/PageAgentRecordInput";
import { resolveAgentsDirectory } from "@/backend/config/PagesConfig";
import {
  artifactDirectory,
  artifactExists,
  requireArtifactId,
  writeArtifact,
} from "@/backend/service/agents/AgentArtifactPath";
import {
  AgentDefinitionFiles,
  renderAgentDefinition,
} from "@/backend/service/agents/AgentDefinitionFiles";
import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { renderAgentRunRecord } from "@/backend/service/agents/AgentRunMarkdown";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { isPageAgentRunStatus } from "@/definition/PageAgent";

import type { AgentProfile } from "@/definition/AgentProfile";
import type { PageAgentRunRecord } from "@/definition/PageAgent";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pages-artifacts-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { force: true, recursive: true });
});

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent",
    name: "Test agent",
    connectionId: "connection-secret-id",
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["agent"],
    targets: [],
    revision: 3,
    configuration: {
      ...emptyAgentConfiguration(),
      markdown: "Review {{input}}",
    },
    ...overrides,
  };
}

function record(
  overrides: Partial<PageAgentRunRecord> = {},
): PageAgentRunRecord {
  return {
    agentId: "agent",
    runId: "run",
    planRunId: "plan-run",
    userId: "person",
    startedAt: "2026-10-13T08:00:00.000Z",
    finishedAt: "2026-10-13T08:01:00.000Z",
    status: "succeeded",
    model: "model-a",
    reasoningEffort: "medium",
    input: "Prepared input",
    result: "Final answer",
    ...overrides,
  };
}

describe("PAGE-20 location of the agent files", () => {
  it("lies next to the configuration file, apart from the data directory", () => {
    expect(resolveAgentsDirectory("/home/igor/.pages/config.toml")).toBe(
      "/home/igor/.pages/Agents",
    );
  });
});

describe("PAGE-20 artifact paths", () => {
  it("accepts identifiers and refuses every path syntax", () => {
    for (const id of [
      "4b0c2d9e-6f7a-4c1d-9e32-1a2b3c4d5e6f",
      "system-text",
      "A",
      "a".repeat(100),
    ])
      expect(() => requireArtifactId(id)).not.toThrow();
    for (const id of [
      "",
      ".",
      "..",
      "../escape",
      "a/b",
      "a\\b",
      "a.md",
      "a b",
      "a\u0000b",
      "ä",
      "a".repeat(101),
    ])
      expect(() => requireArtifactId(id)).toThrow(
        expect.objectContaining({ code: "profile_invalid" }),
      );
  });

  it("creates private folders, accepts a linked root, and refuses a link or file below it", async () => {
    const directory = await artifactDirectory(path.join(root, "Agents"), [
      "agent",
      "runs",
    ]);
    expect(directory).toBe(path.join(root, "Agents", "agent", "runs"));
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    // A link in place of the agent folder is the operator's choice; below it none is accepted.
    await symlink(path.join(root, "Agents"), path.join(root, "linked-root"));
    await expect(
      artifactDirectory(path.join(root, "linked-root"), ["agent"]),
    ).resolves.toBe(path.join(root, "linked-root", "agent"));
    await symlink(root, path.join(root, "Agents", "link"));
    await writeFile(path.join(root, "Agents", "file"), "not a folder");
    for (const part of ["link", "file"])
      await expect(
        artifactDirectory(path.join(root, "Agents"), [part]),
      ).rejects.toMatchObject({ code: "profile_invalid" });
    await expect(
      artifactDirectory(path.join(root, "Agents"), ["../outside"]),
    ).rejects.toMatchObject({ code: "profile_invalid" });
    // A parent that is a file is a real error, not a refusal to explain.
    await expect(
      artifactDirectory(path.join(root, "Agents", "file"), ["agent"]),
    ).rejects.toThrow();
  });

  it("writes read-only files, leaves identical content alone and replaces anything else atomically", async () => {
    const directory = await artifactDirectory(path.join(root, "Agents"), [
      "agent",
    ]);
    const filename = path.join(directory, "AGENT.md");
    expect(await artifactExists(filename)).toBe(false);
    await writeArtifact(filename, "first\n");
    expect((await stat(filename)).mode & 0o777).toBe(0o400);
    expect(await artifactExists(filename)).toBe(true);
    // An older time stamp proves that a second identical write does not touch the file.
    const past = new Date("2026-01-01T00:00:00Z");
    await utimes(filename, past, past);
    await writeArtifact(filename, "first\n");
    expect((await stat(filename)).mtime.getTime()).toBe(past.getTime());
    await writeArtifact(filename, "second\n");
    expect(await readFile(filename, "utf8")).toBe("second\n");
    // A process cannot write the file in place, and nothing else is left behind.
    await expect(writeFile(filename, "tampered")).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["AGENT.md"]);
    // A directory in its place cannot be replaced and leaves no temporary file.
    const blocked = path.join(directory, "blocked.md");
    await mkdir(blocked);
    await writeFile(path.join(blocked, "keep"), "keep");
    await expect(writeArtifact(blocked, "content")).rejects.toThrow();
    expect((await readdir(directory)).sort()).toEqual([
      "AGENT.md",
      "blocked.md",
    ]);
  });
});

describe("PAGE-20 AGENT.md and run record markdown", () => {
  it("renders the stored definition without connection and credentials", () => {
    const markdown = renderAgentDefinition(
      profile({
        name: "Review\n## Injected heading",
        configuration: {
          ...emptyAgentConfiguration(),
          markdown: "Use the password: hunter2hunter2 for {{input}}",
        },
      }),
    );
    const [heading] = markdown.split("\n");
    expect(heading).toBe("# Review ## Injected heading");
    expect(markdown).toContain("Agent-ID: agent");
    expect(markdown).not.toMatch(/connection-secret-id|hunter2|connectionId/u);
    const json = markdown.split("```json\n")[1]?.split("\n```")[0] ?? "";
    expect(JSON.parse(json)).toMatchObject({
      agentId: "agent",
      model: "model-a",
      reasoningEffort: "medium",
      revision: 3,
      configuration: { markdown: "Use the [redacted] for {{input}}" },
    });
  });

  it("keeps a run record parseable whatever the input and result contain", () => {
    const markdown = renderAgentRunRecord(
      record({
        input: "Template:\n```\ncode\n```\n## Result\nfake",
        result: "Answer with ````` five backticks",
      }),
    );
    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
    const metadata = markdown.split("```json\n")[1]?.split("\n```")[0] ?? "";
    expect(JSON.parse(metadata)).toEqual({
      agentId: "agent",
      runId: "run",
      planRunId: "plan-run",
      userId: "person",
      startedAt: "2026-10-13T08:00:00.000Z",
      finishedAt: "2026-10-13T08:01:00.000Z",
      status: "succeeded",
      model: "model-a",
      reasoningEffort: "medium",
    });
    // The input is fenced by more backticks than it contains, the result by more than its own.
    expect(markdown).toContain("````\nTemplate:\n```\ncode\n```");
    expect(markdown).toContain(
      "``````\nAnswer with ````` five backticks\n``````",
    );
  });

  it("recognizes exactly the four terminal states", () => {
    for (const status of ["succeeded", "failed", "cancelled", "timeout"])
      expect(isPageAgentRunStatus(status)).toBe(true);
    for (const status of ["running", "waiting", "", null, 1])
      expect(isPageAgentRunStatus(status)).toBe(false);
  });

  it("reads archive steps from a snapshot and rejects every malformed shape", () => {
    const step = {
      step: { id: "A", agentId: "agent", instruction: "Do it" },
      model: "model-a",
      reasoningEffort: null,
      prepared: { parameters: { markdown: "Template" } },
    };
    expect(readArchiveSteps({ steps: [step] })).toEqual([
      {
        agentId: "agent",
        stepId: "A",
        model: "model-a",
        reasoningEffort: null,
        input: "Template\n\nDo it",
      },
    ]);
    for (const snapshot of [
      null,
      { steps: "none" },
      { steps: [{ ...step, step: { ...step.step, id: 1 } }] },
      { steps: [{ ...step, model: undefined }] },
      { steps: [{ ...step, reasoningEffort: 3 }] },
      { steps: [{ ...step, prepared: {} }] },
    ])
      expect(() => readArchiveSteps(snapshot)).toThrow(
        expect.objectContaining({ code: "plan_invalid" }),
      );
  });
});

describe("PAGE-20 definition files of agents", () => {
  it("holds a definition per reservation and releases each reservation once", async () => {
    const files = new AgentDefinitionFiles(path.join(root, "Agents"));
    const first = await files.hold(["agent", "other"]);
    const second = await files.hold(["agent"]);
    expect(() => files.assertMutable("agent")).toThrow(
      expect.objectContaining({ code: "profile_running" }),
    );
    first();
    first();
    expect(() => files.assertMutable("other")).not.toThrow();
    expect(() => files.assertMutable("agent")).toThrow(
      expect.objectContaining({ code: "profile_running" }),
    );
    second();
    expect(() => files.assertMutable("agent")).not.toThrow();
    await expect(files.hold(["../escape"])).rejects.toMatchObject({
      code: "profile_invalid",
    });
    expect(() => files.assertMutable("../escape")).toThrow();
  });

  it("writes a file only for agents a plan can run and rebuilds altered files from the definition", async () => {
    const directory = path.join(root, "Agents");
    const files = new AgentDefinitionFiles(directory);
    await files.restore([
      profile(),
      profile({ id: "text-only", purposes: ["text", "chat"] }),
    ]);
    expect(await readdir(directory)).toEqual(["agent"]);
    const filename = path.join(directory, "agent", "AGENT.md");
    const original = await readFile(filename, "utf8");
    await rm(filename);
    await files.restore([profile()]);
    expect(await readFile(filename, "utf8")).toBe(original);
    // Another process replaced the file: the next repair puts the definition back.
    await chmod(path.join(directory, "agent"), 0o700);
    await rm(filename);
    await writeFile(filename, "tampered");
    await files.restore([profile()]);
    expect(await readFile(filename, "utf8")).toBe(original);
  });

  it("reports a folder it cannot write and still repairs the others", async () => {
    const directory = path.join(root, "Agents");
    await mkdir(directory);
    await writeFile(path.join(directory, "blocked"), "a file, not a folder");
    const failure = vi.spyOn(console, "error").mockImplementation(() => {});
    const files = new AgentDefinitionFiles(directory);
    await files.restore([profile({ id: "blocked" }), profile({ id: "ok" })]);
    expect(await artifactExists(path.join(directory, "ok", "AGENT.md"))).toBe(
      true,
    );
    expect(failure).toHaveBeenCalledTimes(1);
    expect(String(failure.mock.calls[0]?.[0])).toContain("blocked");
  });
});

describe("PAGE-20 working copies and the agent folder", () => {
  it("refuses a working copy that contains the agent folder, also before it exists, or lies within it", async () => {
    const data = path.join(root, "data");
    const agents = path.join(root, "workspace", "Agents");
    const approved = path.join(root, "workspace", "approved");
    await mkdir(data);
    await mkdir(approved, { recursive: true });
    const paths = new AgentWorkspacePath({
      roots: [path.join(root, "workspace")],
      protectedDirectory: data,
      additionalProtectedDirectories: [agents],
    });
    await expect(paths.inspect(approved)).resolves.toMatchObject({
      path: approved,
    });
    // The folder is created on first use; until then it is compared by its path.
    await expect(
      paths.inspect(path.join(root, "workspace")),
    ).rejects.toMatchObject({ code: "workspace_path_outside_roots" });
    await mkdir(path.join(agents, "agent"), { recursive: true });
    for (const directory of [
      agents,
      path.join(agents, "agent"),
      path.join(root, "workspace"),
    ])
      await expect(paths.inspect(directory)).rejects.toMatchObject({
        code: "workspace_path_outside_roots",
      });
    await expect(paths.inspect(approved)).resolves.toMatchObject({
      path: approved,
    });
  });
});
