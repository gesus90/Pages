import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The workflows are checked as text on purpose: the repository has no YAML parser
// dependency and none is added only for this test.
const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_DIRECTORY = path.join(REPOSITORY_ROOT, ".github", "workflows");

function readWorkflow(name: string): string {
  return readFileSync(path.join(WORKFLOW_DIRECTORY, name), "utf8");
}

/** Returns the lines of one top-level job, from its key to the next job key. */
function readJob(workflow: string, job: string): string[] {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${job}:`);
  expect(start, `job ${job}`).toBeGreaterThanOrEqual(0);
  const length = lines
    .slice(start + 1)
    .findIndex((line) => /^ {2}\S/.test(line));
  return lines.slice(start, length < 0 ? undefined : start + 1 + length);
}

function positionOf(lines: readonly string[], fragment: string): number {
  const position = lines.findIndex((line) => line.includes(fragment));
  expect(position, fragment).toBeGreaterThanOrEqual(0);
  return position;
}

function expectInOrder(lines: readonly string[], fragments: string[]): void {
  const positions = fragments.map((fragment) => positionOf(lines, fragment));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

const workflowNames = readdirSync(WORKFLOW_DIRECTORY).sort();

describe("GitHub workflows", () => {
  it("consist of the CI and the MCP release workflow only", () => {
    expect(workflowNames).toEqual(["ci.yml", "mcp-release.yml"]);
  });

  it.each(workflowNames)(
    "%s is indented with spaces and never ignores a failure",
    (name) => {
      const workflow = readWorkflow(name);
      expect(workflow).not.toContain("\t");
      expect(workflow).not.toContain("continue-on-error");
      expect(workflow).not.toMatch(/\|\|\s*true\b/);
      expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    },
  );

  it.each(workflowNames)(
    "%s does not write, tag, push or publish a package",
    (name) => {
      const workflow = readWorkflow(name);
      for (const forbidden of [
        "git push",
        "git commit",
        "git tag",
        "npm publish",
        "pnpm publish",
        "--write",
        "pnpm run format",
        "pnpm format",
      ]) {
        expect(workflow, forbidden).not.toContain(forbidden);
      }
    },
  );

  it.each(workflowNames)(
    "%s puts GitHub expressions only into keys and values",
    (name) => {
      const expressionLines = readWorkflow(name)
        .split("\n")
        .filter((line) => line.includes("${{"));
      expect(expressionLines.length).toBeGreaterThan(0);
      for (const line of expressionLines) {
        // No expression is expanded inside a shell script: the tag name stays in `env`.
        expect(line).toMatch(/^\s+[A-Za-z_-]+: .*\$\{\{ [a-z._]+ \}\}\s*$/);
        expect(line).not.toMatch(/^\s+run:/);
      }
    },
  );
});

describe("ci.yml", () => {
  const workflow = readWorkflow("ci.yml");
  const lines = workflow.split("\n");

  it("runs for pull requests, pushes to main and as a reusable gate", () => {
    expect(workflow).toMatch(
      /^on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n/m,
    );
    expect(workflow).toMatch(/^ {2}workflow_call:$/m);
    expect(workflow).not.toMatch(/^ {2}push:\n {4}tags:/m);
  });

  it("installs both packages before it runs the gates in order", () => {
    expectInOrder(lines, [
      "run: pnpm install --frozen-lockfile",
      "run: pnpm --dir mcp install --frozen-lockfile",
      "run: pnpm run check",
      "run: pnpm run lint",
      "run: pnpm --dir mcp run check",
      "run: pnpm test",
      "run: pnpm run build",
      "run: pnpm --dir mcp run build",
      "run: pnpm audit --prod --audit-level=high",
    ]);
  });

  it("runs the tests once with the coverage thresholds", () => {
    expect(workflow).not.toContain("vitest run");
    expect(lines.filter((line) => line.includes("run: pnpm test"))).toEqual([
      "      - run: pnpm test",
    ]);
  });

  it("caches both lockfiles and does not request write access", () => {
    expect(workflow).toContain(
      "            pnpm-lock.yaml\n            mcp/pnpm-lock.yaml\n",
    );
    expect(workflow).not.toContain("contents: write");
  });
});

describe("mcp-release.yml", () => {
  const workflow = readWorkflow("mcp-release.yml");
  const lines = workflow.split("\n");

  it("starts only for mcp-v tags", () => {
    expect(workflow).toMatch(/^on:\n {2}push:\n {4}tags: \["mcp-v\*"\]\n/m);
    expect(workflow).not.toContain("branches:");
    expect(workflow).not.toContain("pull_request");
    expect(workflow).not.toContain("workflow_dispatch");
  });

  it("validates the tag with the packaging script before any gate runs", () => {
    const job = readJob(workflow, "tag");
    expect(job.join("\n")).toContain(
      'version="$(node mcp/scripts/package-release.ts tag "$TAG")"',
    );
    expect(job.join("\n")).toContain("TAG: ${{ github.ref_name }}");
    expect(readJob(workflow, "verify")).toEqual([
      "  verify:",
      "    needs: tag",
      "    uses: ./.github/workflows/ci.yml",
      "",
    ]);
  });

  it("publishes only after the tag check and every CI gate succeeded", () => {
    const job = readJob(workflow, "publish");
    expect(job).toContain("    needs: [tag, verify]");
    expect(job.filter((line) => line.includes("contents: write"))).toHaveLength(
      1,
    );
    expect(
      lines.filter((line) => line.includes("contents: write")),
    ).toHaveLength(1);
    expect(job.join("\n")).toContain(
      "VERSION: ${{ needs.tag.outputs.version }}",
    );
    expectInOrder(job, [
      "run: pnpm --dir mcp install --frozen-lockfile",
      'node mcp/scripts/package-release.ts package "$TAG" "$RUNNER_TEMP/release"',
      "gh release create",
    ]);
  });

  it("creates the GitHub release with the archive and its SHA-256 file from the tag", () => {
    const job = readJob(workflow, "publish").join("\n");
    expect(job).toContain(
      'archive="$RUNNER_TEMP/release/pages-mcp-v${VERSION}.zip"',
    );
    expect(job).toContain(
      'gh release create "$TAG" "$archive" "${archive}.sha256"',
    );
    expect(job).toContain("--verify-tag");
    expect(job).toContain("GH_TOKEN: ${{ github.token }}");
  });

  it("references scripts that exist", () => {
    expect(
      existsSync(
        path.join(REPOSITORY_ROOT, "mcp", "scripts", "package-release.ts"),
      ),
    ).toBe(true);
    expect(existsSync(path.join(WORKFLOW_DIRECTORY, "ci.yml"))).toBe(true);
  });
});
