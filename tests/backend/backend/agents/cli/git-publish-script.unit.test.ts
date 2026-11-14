import { expect, it } from "vitest";

import { gitPublishScript } from "@/backend/agents/cli/CliGitPublishScript";

it("generates a fast-forward publication with origin validation and remote verification", () => {
  const script = gitPublishScript(
    "owner/project",
    "https://github.com/owner/project",
  );
  expect(script).toContain("'https://github.com/owner/project'");
  expect(script).toContain('transfer push origin "$commit:refs/heads/$branch"');
  expect(script).toContain(
    'transfer ls-remote --exit-code origin "refs/heads/$branch"',
  );
  expect(script).toContain(
    'echo "PUBLISHED owner/project refs/heads/$branch $commit"',
  );
  expect(script).toContain("exit 77");
  expect(script).not.toContain("--force");
});
