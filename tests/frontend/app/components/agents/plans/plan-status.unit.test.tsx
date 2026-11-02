import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import {
  PlanStatusBadge,
  planRunCardClass,
  planStatusClass,
  planStatusKey,
} from "@/app/components/agents/plans/plan-status";
import { createI18n } from "@/app/lib/i18n";

const i18n = createI18n("en");

function badge(element: React.ReactElement): HTMLElement {
  const { container } = render(
    <I18nextProvider i18n={i18n}>{element}</I18nextProvider>,
  );
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("Expected a badge");
  return root;
}

it("keeps the recorded status color unless the node is blocked", () => {
  expect(planStatusClass("succeeded")).toContain("text-success");
  expect(planStatusClass("waiting", true)).toContain("text-destructive");
});

it("names a blocked waiting successor apart from a node that is blocked itself", () => {
  expect(planStatusKey("running")).toBe("plans.status.running");
  expect(planStatusKey("waiting", true)).toBe("plans.blocked");
  expect(planStatusKey("failed", true)).toBe("plans.blockedShort");
});

it("spins only the icon of an unblocked running badge and shows its name", () => {
  const root = badge(<PlanStatusBadge status="running" />);
  expect(root.getAttribute("title")).toBe("Running");
  expect(screen.getByText("Running").className).toBe("");
  expect(root.querySelector("svg")?.getAttribute("class")).toContain(
    "animate-spin",
  );
});

it("shows the long blocked name unless the badge is concise", () => {
  const root = badge(<PlanStatusBadge status="waiting" isBlocked />);
  expect(root.getAttribute("title")).toBe("Waiting · blocked by predecessor");
  expect(screen.getByText("Waiting · blocked by predecessor")).toBeTruthy();
  expect(root.querySelector("svg")?.getAttribute("class")).not.toContain(
    "animate-spin",
  );
});

it("keeps the long name as title while a concise blocked badge reads short", () => {
  const root = badge(
    <PlanStatusBadge
      status="running"
      isBlocked
      isConcise
      compact
      className="extra"
    />,
  );
  expect(root.getAttribute("title")).toBe("Blocked");
  expect(root.className).toContain("extra");
  const label = screen.getByText("Blocked");
  expect(label.className).toBe("sr-only");
  expect(root.querySelector("svg")?.getAttribute("class")).not.toContain(
    "animate-spin",
  );
});

it("shows a concise unblocked badge with its own status name", () => {
  badge(<PlanStatusBadge status="paused" isConcise />);
  expect(screen.getByText("Paused")).toBeTruthy();
});

it("distinguishes a completed execution from an open report", () => {
  const root = badge(<PlanStatusBadge status="succeeded" hasOpenReport />);
  expect(root.className).toContain("text-warning");
  expect(root.getAttribute("title")).toBe(
    "Execution completed · report open or unverified",
  );
  expect(planStatusClass("succeeded", false, true)).toContain("text-warning");
  expect(planStatusKey("succeeded", false, true)).toBe("plans.reportOpen");
  expect(planStatusClass("failed", false, true)).toContain("text-destructive");
});

it("shows a skipped node as quiet and named, not as waiting", () => {
  const root = badge(<PlanStatusBadge status="skipped" />);

  expect(planStatusKey("skipped")).toBe("plans.status.skipped");
  expect(root.getAttribute("title")).toBe("Skipped");
  expect(root.className).toContain("text-muted-foreground");
  expect(screen.getByText("Skipped")).toBeTruthy();
  expect(root.querySelector("svg")).not.toBeNull();
});

it("gives the card of a skipped node a dashed border and no other", () => {
  const step = {
    id: "a",
    name: "A",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
  } as const;

  expect(planRunCardClass({ ...step, status: "skipped" })).toContain(
    "border-dashed",
  );
  expect(planRunCardClass({ ...step, status: "skipped" })).not.toContain(
    "opacity",
  );
  expect(planRunCardClass({ ...step, status: "succeeded" })).not.toContain(
    "border-dashed",
  );
  expect(planRunCardClass(undefined)).toBe(planStatusClass("waiting"));
});
