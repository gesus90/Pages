import { expect, it } from "vitest";

import {
  findModelChoice,
  modelGroups,
} from "@/app/components/agents/model-picker/model-catalog";

import { i18n } from "./plan-flow-fixture";
import { pageModel } from "./plan-model-fixture";

it("names a model under its own name in its provider group", () => {
  const groups = modelGroups([pageModel("plain")], { translate: i18n.t });
  const display = findModelChoice(groups, "plain");
  expect(display?.choice.label).toBe("Model plain");
  expect(display?.choice.isFree).toBe(false);
  expect(display?.group.mark).toBeTruthy();
});

it("marks a free model", () => {
  const groups = modelGroups([pageModel("free", { isFree: true })], {
    translate: i18n.t,
  });
  expect(findModelChoice(groups, "free")?.choice.isFree).toBe(true);
});

it("keeps an OpenCode model's source and remote target", () => {
  const groups = modelGroups(
    [
      pageModel("remote", {
        provider: "opencode",
        model: "anthropic/sonnet",
        modelName: "Sonnet",
        targetName: "Runner · Workspace",
      }),
    ],
    { translate: i18n.t },
  );
  const display = findModelChoice(groups, "remote");
  expect(display?.choice.label).toBe("Sonnet");
  expect(display?.group.sources[0].key).toBe("anthropic");
});

it("names a local OpenCode model by its listed name", () => {
  const groups = modelGroups(
    [pageModel("local", { provider: "opencode", model: "custom/thing" })],
    { translate: i18n.t },
  );
  expect(findModelChoice(groups, "local")?.choice.label).toBe("Model local");
  expect(groups[0].sources[0].key).toBe("custom");
});
