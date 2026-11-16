import { expect, it } from "vitest";

import { requirePicaCodexProfile } from "@/backend/agents/cli/PicaCodexBundle";

const FEATURES = {
  shell_tool: false,
  unified_exec: false,
  view_image: false,
  js_repl: false,
  code_mode: false,
  apps: false,
  plugins: false,
  multi_agent: false,
};

it("accepts only the exact managed profile with all restricted features disabled", () => {
  expect(() =>
    requirePicaCodexProfile({
      configuration: { web_search: "disabled", features: FEATURES },
    }),
  ).not.toThrow();
  for (const profile of [
    null,
    {},
    { configuration: { web_search: "enabled", features: FEATURES } },
    { configuration: { web_search: "disabled", features: [] } },
    {
      configuration: {
        web_search: "disabled",
        features: { ...FEATURES, shell_tool: true },
      },
    },
    {
      configuration: {
        web_search: "disabled",
        features: { ...FEATURES, extra: false },
      },
    },
  ]) {
    expect(() => requirePicaCodexProfile(profile)).toThrow(
      "Invalid Pica Codex profile",
    );
  }
});
