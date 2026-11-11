import { expect, it } from "vitest";

import { picaHelperUsage } from "@/backend/agents/acp/PicaClaudeHelper";

const HELPER = "/home/igor/Repo/Pages/.pica-0000/pages-pica";

it("forbids every other command to a read-only Claude turn", () => {
  const usage = picaHelperUsage(HELPER, "read_only");

  expect(usage).toContain(`'${HELPER}' '{"action":"catalog"}'`);
  expect(usage).toContain("Run no other command and open no other file.");
});

it("keeps the shell open to a full-access Claude turn", () => {
  const usage = picaHelperUsage(HELPER, "yolo");

  expect(usage).toContain(`'${HELPER}' '{"action":"catalog"}'`);
  expect(usage).not.toContain("Run no other command");
  expect(usage).toContain("run any other shell command");
});
