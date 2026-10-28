import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import { planModelDisplay } from "@/app/components/agents/plans/plan-model-option";

import { i18n } from "./plan-flow-fixture";
import { pageModel } from "./plan-model-fixture";

function iconClass(icon: React.ReactNode): string {
  const { container } = render(<>{icon}</>);
  return container.firstElementChild?.className ?? "";
}

it("names a model under its own name with its vendor's icon", () => {
  const display = planModelDisplay(pageModel("plain"), i18n.t);
  expect(display.label).toBe("Model plain");
  expect(display.free).toBe("");
  expect(iconClass(display.icon)).toContain("bg-[#6467f2]");
});

it("marks a free model", () => {
  expect(
    planModelDisplay(pageModel("free", { isFree: true }), i18n.t).free,
  ).toBe(` · ${i18n.t("settings.agents.freeBadge")}`);
});

it("names an OpenCode model by its target, provider and model", () => {
  const display = planModelDisplay(
    pageModel("remote", {
      provider: "opencode",
      model: "anthropic/sonnet",
      modelName: "Sonnet",
      targetName: "Runner · Workspace",
    }),
    i18n.t,
  );
  expect(display.label).toBe(
    "Runner · Workspace / opencode · anthropic · Sonnet",
  );
  expect(iconClass(display.icon)).toContain("bg-[#d97757]");
});

it("names a local OpenCode model by its listed name without a target", () => {
  const display = planModelDisplay(
    pageModel("local", { provider: "opencode", model: "custom/thing" }),
    i18n.t,
  );
  expect(display.label).toBe("opencode · custom · Model local");
});
