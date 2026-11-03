import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ESLint } from "eslint";
import prettier from "prettier";
import { afterEach, beforeEach, expect, it } from "vitest";

import { buildLintBlocks, collectCandidateFiles } from "@/scripts/run-lint.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-lint-unit-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function place(file: string): Promise<void> {
  const target = path.join(directory, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "");
}

it("collects source without Git, also below paths a gitignore would name", async () => {
  // No `.git` here: the population cannot depend on a repository or its excludes.
  const sources = [
    "Results/kept.ts",
    "app/a b.tsx",
    "app/line\nbreak.ts",
    "app/ümlaut[id].ts",
    "backend/new/Source.ts",
    "data/seed.mjs",
    "tests/browser/results.ts",
  ];
  for (const source of sources) await place(source);

  expect([...collectCandidateFiles(directory)].toSorted()).toEqual(
    sources.toSorted(),
  );
});

it("treats the root directories of generated output and the app only at the root", async () => {
  const sources = [
    "backend/database/repositories/mobile/Rows.ts",
    "backend/service/build/Plan.ts",
    "backend/service/mobile/Gateway.ts",
    "tests/backend/backend/service/mobile/gateway.unit.test.ts",
  ];
  for (const source of sources) await place(source);
  await place("mobile/app.ts");
  await place("build/server.js");

  expect([...collectCandidateFiles(directory)].toSorted()).toEqual(sources);
});

it("checks the format of Pages sources named like the independent app", async () => {
  const ignored = async (file: string): Promise<boolean> =>
    (
      await prettier.getFileInfo(path.join(ROOT, file), {
        ignorePath: path.join(ROOT, ".prettierignore"),
      })
    ).ignored;

  await expect(ignored("mobile/app.ts")).resolves.toBe(true);
  await expect(ignored("backend/service/mobile/Gateway.ts")).resolves.toBe(
    false,
  );
});

it("leaves out dependencies, builds, other file types and links", async () => {
  await place("app/a.ts");
  await place("node_modules/x/index.js");
  await place("mcp/node_modules/x/index.js");
  await place("mcp/dist/bundle.ts");
  await place("build/server.js");
  await place("coverage/backend/prettify.js");
  await place(".react-router/types/a.ts");
  await place("mobile/app.ts");
  await place("app/notes.md");
  await symlink(path.join(directory, "app/a.ts"), path.join(directory, "l.ts"));

  expect(collectCandidateFiles(directory)).toEqual(["app/a.ts"]);
});

it.each([
  "tests/browser/results/report/trace/assets/generated.js",
  "tests/browser/results/artifacts/run/generated.mjs",
  "build/server.js",
  "coverage/backend/prettify.js",
  "mcp/coverage/prettify.js",
  "mcp/dist/pages-mcp.js",
])("classifies %s as generated", async (file) => {
  const eslint = new ESLint({ cwd: ROOT });

  await expect(eslint.isPathIgnored(path.join(ROOT, file))).resolves.toBe(true);
});

it.each([
  "backend/service/agents/AgentPlanAcceptance.ts",
  "app/root.tsx",
  "scripts/run-lint.mjs",
  "mcp/src/server.ts",
  "tests/browser/support/paths.ts",
  // Neighbours of the generated directory and files Git would ignore stay source.
  "tests/browser/results.ts",
  "tests/browser/support/results/x.ts",
  "tests/results/report.ts",
  "backend/service/mobile/PicaMobileConnection.ts",
  "data/seed.ts",
  "Results/kept.ts",
])("keeps %s in the lint population", async (file) => {
  const eslint = new ESLint({ cwd: ROOT });

  await expect(eslint.isPathIgnored(path.join(ROOT, file))).resolves.toBe(
    false,
  );
});

it("keeps the two TypeScript projects apart in blocks", () => {
  const blocks = buildLintBlocks(["a.ts", "b.ts", "c.ts", "mcp/d.ts"], 2);

  expect(blocks.map((block) => [block.scope, block.files])).toEqual([
    ["root", ["a.ts", "b.ts"]],
    ["root", ["c.ts"]],
    ["mcp", ["mcp/d.ts"]],
  ]);
});
