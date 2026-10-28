import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanGroupNoticeBar } from "@/app/components/agents/plans/plan-group-notice";

import { i18n, renderTranslated } from "./plan-group-fixture";

it("announces a refusal as an alert that names the agent and both ACP classes", () => {
  const onClose = vi.fn();
  renderTranslated(
    <PlanGroupNoticeBar
      notice={{
        kind: "refused",
        refusal: "otherAdapter",
        name: "Reviewer",
        adapter: "claude_code",
        groupAdapter: "codex_cli",
      }}
      onClose={onClose}
      className="extra-class"
    />,
  );
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe(
    i18n.t("plans.groups.refusal.otherAdapter", {
      name: "Reviewer",
      adapter: "Claude Code · ACP",
      group: "Codex · ACP",
    }),
  );
  expect(alert.className).toContain("extra-class");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.closeNotice") }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("names a missing class as neutral", () => {
  renderTranslated(
    <PlanGroupNoticeBar
      notice={{
        kind: "refused",
        refusal: "notAcp",
        name: "Api",
        adapter: null,
        groupAdapter: null,
      }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.groups.refusal.notAcp", {
      name: "Api",
      adapter: "Neutral",
      group: "Neutral",
    }),
  );
});

it("reports a move out of a loop or a group as a status with the dropped connections", () => {
  const { rerender } = renderTranslated(
    <PlanGroupNoticeBar
      notice={{
        kind: "moved",
        frame: "loop",
        removedEdges: 2,
        removedBindings: 1,
      }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.loops.moved", { edges: 2, bindings: 1 }),
  );
  expect(screen.getByRole("status").textContent).toContain("2");
  rerender(
    <PlanGroupNoticeBar
      notice={{
        kind: "moved",
        frame: "group",
        removedEdges: 0,
        removedBindings: 0,
      }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.groups.moved"),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});
