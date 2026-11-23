import { expect, it } from "vitest";

import { gitPublishScript } from "@/backend/agents/cli/CliGitPublishScript";

it("builds a shell script that compares the lowercase origin of the connection", () => {
  const script = gitPublishScript(
    "owner/repo",
    "https://github.com/Owner/Repo",
  );
  expect(script.startsWith("#!/bin/sh\n")).toBe(true);
  expect(script).toContain(`'https://github.com/owner/repo'`);
  expect(script).toContain("project connection (owner/repo)");
  expect(script).toContain(
    'echo "PUBLISHED owner/repo refs/heads/$branch $commit"',
  );
});

it("retries transport failures three times and ends on refusals with their exit codes", () => {
  const script = gitPublishScript("a/b", "ssh://git@github.com/a/b");
  expect(script).toContain('[ "$attempt" -ge 3 ]');
  expect(script).toContain("after 3 attempts");
  for (const code of ["64", "77", "78", "79"])
    expect(script).toContain(`exit ${code}`);
  expect(script).toContain('"GitHub stayed unreachable" 75');
  expect(script).not.toContain("--force");
});

it("quotes an origin address that holds a single quote", () => {
  expect(gitPublishScript("a/b", "https://x/it's")).toContain(
    `'https://x/it'\\''s'`,
  );
});
