import { expect, it } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import { reasoningOptions } from "@/app/lib/reasoning-options";

const translate = createI18n("en").t;
const UNSUPPORTED = "Unsupported – correct the selection";
const SONNET = { reasoningEfforts: ["low", "high"] };
const OPUS = { reasoningEfforts: ["low", "high", "max"] };

it("offers the default and every level the chosen model supports", () => {
  expect(
    reasoningOptions({
      model: SONNET,
      modelName: "Sonnet",
      siblings: [SONNET],
      current: "high",
      defaultLabel: "Default",
      translate,
    }),
  ).toEqual([
    { value: "", label: "Default" },
    { value: "low", label: "low" },
    { value: "high", label: "high" },
  ]);
});

it("disables a level only other models of the target support and marks it when chosen", () => {
  const options = reasoningOptions({
    model: SONNET,
    modelName: "Sonnet",
    siblings: [SONNET, OPUS],
    current: "max",
    defaultLabel: "Default",
    translate,
  });

  expect(options.at(-1)).toEqual({
    value: "max",
    label: `max · ${UNSUPPORTED}`,
    disabled: true,
    description: "Sonnet does not support this level.",
  });
  expect(options).toHaveLength(4);
});

it("disables an unsupported level without a mark when it is not the chosen one", () => {
  const options = reasoningOptions({
    model: SONNET,
    modelName: "Sonnet",
    siblings: [OPUS],
    current: null,
    defaultLabel: "Default",
    translate,
  });

  expect(options.at(-1)).toEqual({
    value: "max",
    label: "max",
    disabled: true,
    description: "Sonnet does not support this level.",
  });
});

it("keeps a saved level that no model offers as a marked, disabled entry", () => {
  expect(
    reasoningOptions({
      model: SONNET,
      modelName: "Sonnet",
      siblings: [SONNET],
      current: "ultra",
      defaultLabel: "Default",
      translate,
    }).at(-1),
  ).toEqual({
    value: "ultra",
    label: `ultra · ${UNSUPPORTED}`,
    disabled: true,
  });
});

it("keeps a saved level without a mark while no model is chosen", () => {
  expect(
    reasoningOptions({
      model: undefined,
      modelName: "",
      siblings: [],
      current: "ultra",
      defaultLabel: "Default",
      translate,
    }),
  ).toEqual([
    { value: "", label: "Default" },
    { value: "ultra", label: "ultra", disabled: true },
  ]);
});
