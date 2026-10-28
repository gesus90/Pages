import { expect, it } from "vitest";

import { PlanFlowHandle } from "@/app/components/agents/plans/plan-flow-handle";
import styles from "@/app/components/agents/plans/plan-canvas.module.css";

import { flowContext, renderInFlow } from "./plan-flow-fixture";

function handle(container: HTMLElement, id: string): Element {
  const element = container.querySelector(`[data-handleid="${id}"]`);
  if (!element) throw new Error(`The handle ${id} is missing.`);
  return element;
}

it("starts connections at an OUT on the right and ends them at an IN on the left", () => {
  const { container } = renderInFlow(
    <>
      <PlanFlowHandle id="flow-out" type="source" kind="flow" />
      <PlanFlowHandle id="input:notes" type="target" kind="data" />
    </>,
  );
  const out = handle(container, "flow-out");
  const input = handle(container, "input:notes");

  expect(out.getAttribute("data-handlepos")).toBe("right");
  expect(out.getAttribute("aria-hidden")).toBe("true");
  expect(out.classList).toContain("connectablestart");
  expect(out.classList).not.toContain("connectableend");
  expect(out.classList).toContain(styles.flowHandle);
  expect(input.getAttribute("data-handlepos")).toBe("left");
  expect(input.classList).toContain("connectableend");
  expect(input.classList).not.toContain("connectablestart");
  expect(input.classList).toContain(styles.dataHandle);
  expect(input.classList).not.toContain(styles.invalidHandle);
});

it("marks a handle with an issue and keeps a decorative anchor unconnectable", () => {
  const { container } = renderInFlow(
    <>
      <PlanFlowHandle id="flow-in" type="target" kind="flow" hasIssue />
      <PlanFlowHandle
        id="anchor"
        type="source"
        kind="flow"
        isDecorative
        style={{ right: 0 }}
      />
    </>,
  );
  const anchor = handle(container, "anchor");

  expect(handle(container, "flow-in").classList).toContain(
    styles.invalidHandle,
  );
  expect(anchor.classList).toContain(styles.anchorHandle);
  expect(anchor.classList).not.toContain("connectable");
  expect(anchor.getAttribute("style")).toBe("right: 0px;");
});

it("offers no connection on a read-only canvas", () => {
  const { container } = renderInFlow(
    <PlanFlowHandle id="flow-out" type="source" kind="flow" />,
    flowContext({ canEdit: false }),
  );
  const out = handle(container, "flow-out");

  expect(out.classList).not.toContain("connectable");
  expect(out.classList).not.toContain("connectablestart");
});
