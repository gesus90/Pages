import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanSwarmCard } from "@/app/components/agents/plans/plan-swarm/plan-swarm-card";
import { PlanSwarmPanel } from "@/app/components/agents/plans/plan-swarm/plan-swarm-panel";
import { PlanSwarmRun } from "@/app/components/agents/plans/plan-swarm/plan-swarm-run";
import {
  planNodeAccent,
  planNodeClass,
} from "@/app/components/agents/plans/plan-layout";
import { newPlanSwarm } from "@/definition/AgentPlanSwarm";

import {
  EMPTY_SOURCES,
  graphActions,
  i18n,
  planOf,
  renderInFlow,
  renderTranslated,
} from "../plan-flow-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";
import type {
  AgentPlanSwarmRun,
  AgentPlanSwarmWorkerView,
} from "@/definition/AgentPlanSwarmRun";

const MODEL = {
  connectionId: "c",
  provider: "codex_cli" as const,
  model: "gpt-5",
  reasoningEffort: "medium",
};

function swarmOf(
  count: number,
  changes: Partial<AgentPlanSwarm> = {},
): AgentPlanSwarm {
  const swarm = newPlanSwarm({ id: "s", x: 0, y: 0 });
  return {
    ...swarm,
    task: { source: "text", text: "Dokumente analysieren" },
    main: { model: MODEL, access: "read_only" },
    workers: {
      ...swarm.workers,
      count,
      same: { model: MODEL, access: "read_only" },
    },
    ...changes,
  };
}

function worker(
  id: string,
  status: AgentPlanSwarmWorkerView["status"],
  changes: Partial<AgentPlanSwarmWorkerView> = {},
): AgentPlanSwarmWorkerView {
  return {
    id,
    provider: "codex_cli",
    model: "gpt-5",
    access: "read_only",
    status,
    taskId: null,
    reason: null,
    locks: [],
    todos: [],
    ...changes,
  };
}

function runOf(
  workers: readonly AgentPlanSwarmWorkerView[],
  changes: Partial<AgentPlanSwarmRun> = {},
): AgentPlanSwarmRun {
  return {
    main: {
      provider: "claude_code",
      model: "opus",
      activity: "verteilt Teilaufgaben",
      todos: [],
    },
    workers: [...workers],
    tasks: [
      {
        id: "T1",
        workerId: "H1",
        requestedWorkerId: null,
        instruction: "Verträge lesen",
        scope: ["docs/vertraege"],
        status: "running",
        attempts: 1,
        result: null,
        error: null,
        startedAt: "t",
        endedAt: null,
      },
    ],
    violations: [],
    summary: null,
    outcome: "running",
    ...changes,
  };
}

function result(swarm: AgentPlanSwarmRun): AgentPlanStepResult {
  return {
    id: "s",
    name: "Swarm",
    status: "running",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    swarm,
  };
}

describe("swarm card", () => {
  it.each([
    [1, 1],
    [5, 1],
    [6, 2],
    [10, 2],
  ])("shows %i helpers as badges in %i rows of at most five", (count, rows) => {
    const { container } = renderInFlow(
      <PlanSwarmCard
        swarm={swarmOf(count)}
        result={undefined}
        hasRun={false}
      />,
    );
    const list = container.querySelector("[data-plan-swarm-badges]");
    expect(list?.children).toHaveLength(rows);
    const badges = container.querySelectorAll("[data-plan-swarm-badge]");
    expect([...badges].map((badge) => badge.textContent)).toEqual(
      Array.from({ length: count }, (_, index) => `H${String(index + 1)}`),
    );
    expect(badges[0]?.className).toContain("border-plan-swarm-edge");
    expect(screen.getByText("Dokumente analysieren")).toBeTruthy();
    expect(screen.getByText("gpt-5 · medium")).toBeTruthy();
  });

  it("shows each helper status as color and symbol and counts the subtasks", () => {
    const run = runOf([
      worker("H1", "busy", { taskId: "T1" }),
      worker("H2", "idle"),
      worker("H3", "done"),
      worker("H4", "failed"),
      worker("H5", "not_started", { reason: "acp_worker_limit" }),
    ]);
    const { container } = renderInFlow(
      <PlanSwarmCard swarm={swarmOf(5)} result={result(run)} hasRun />,
    );
    const badge = (id: string): Element | null =>
      container.querySelector(`[data-plan-swarm-badge="${id}"]`);
    expect(badge("H1")?.className).toContain("text-status-active");
    expect(badge("H1")?.getAttribute("data-symbol")).toBe("busy");
    expect(badge("H1")?.getAttribute("title")).toBe("gpt-5 · Verträge lesen");
    expect(badge("H2")?.getAttribute("data-symbol")).toBe("none");
    expect(badge("H3")?.className).toContain("text-success");
    expect(badge("H4")?.className).toContain("text-destructive");
    expect(badge("H5")?.className).toContain("text-muted-foreground");
    expect(badge("H5")?.getAttribute("data-symbol")).toBe("notStarted");
    expect(container.querySelector("[data-plan-swarm-pill]")?.textContent).toBe(
      "0/1",
    );
    expect(screen.getByText("verteilt Teilaufgaben")).toBeTruthy();
  });

  it("has a type color and symbol of its own", () => {
    expect(planNodeClass("swarm")).toContain("plan-swarm");
    for (const type of ["agent", "group", "parameter", "loop"] as const)
      expect(planNodeAccent(type)).not.toBe(planNodeAccent("swarm"));
    const { container } = renderInFlow(
      <PlanSwarmCard swarm={swarmOf(1)} result={undefined} hasRun={false} />,
    );
    expect(container.querySelector("svg.lucide-network")).toBeTruthy();
  });
});

describe("swarm panel", () => {
  function renderPanel(
    swarm: AgentPlanSwarm,
    draft = planOf([swarm]),
  ): {
    readonly replaceNode: ReturnType<typeof vi.fn>;
    readonly panel: HTMLElement;
  } {
    const replaceNode = vi.fn();
    const { container } = renderTranslated(
      <PlanSwarmPanel
        swarm={swarm}
        draft={draft}
        sources={{ ...EMPTY_SOURCES, models: [] }}
        graph={graphActions({ replaceNode })}
        run={null}
        isDisabled={false}
        onClose={vi.fn()}
      />,
    );
    return { replaceNode, panel: container };
  }

  it("orders its sections task, main model, helpers, execution", () => {
    const { panel } = renderPanel(swarmOf(3));
    expect(
      [...panel.querySelectorAll("[data-plan-swarm-section]")].map((section) =>
        section.getAttribute("data-plan-swarm-section"),
      ),
    ).toEqual(["task", "main", "workers", "execution"]);
  });

  it("switches between the same model for all and one per helper", () => {
    const { replaceNode } = renderPanel(swarmOf(3));
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("plans.swarm.modeIndividual"),
      }),
    );
    const next = replaceNode.mock.calls[0]?.[0] as AgentPlanSwarm;
    expect(next.workers.mode).toBe("individual");
    expect(next.workers.individual).toHaveLength(3);
  });

  it("shows one compact row per helper when individual", () => {
    const { panel } = renderPanel(
      swarmOf(2, { workers: { ...swarmOf(2).workers, mode: "individual" } }),
    );
    expect(
      within(
        panel.querySelector("[data-plan-swarm-individual]") as HTMLElement,
      ).getAllByRole("listitem"),
    ).toHaveLength(2);
  });

  it("counts helpers between 1 and 10", () => {
    const { replaceNode } = renderPanel(swarmOf(10));
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: i18n.t("plans.swarm.more"),
      }).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("plans.swarm.fewer") }),
    );
    expect(
      (replaceNode.mock.calls[0]?.[0] as AgentPlanSwarm).workers.count,
    ).toBe(9);
  });

  it("says that a remote target is refused", () => {
    renderPanel(
      swarmOf(1, { executionTarget: { kind: "remote", workspaceId: "w" } }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Swarm-Knoten laufen nur auf dem Pages-Rechner. Wähle ein lokales Ziel.",
    );
  });
});

describe("swarm run view", () => {
  it("shows the lanes below each other with the same columns and opens each lane", () => {
    const run = runOf([
      worker("H1", "busy", {
        taskId: "T1",
        locks: ["a.md"],
        todos: [{ id: "1", text: "lesen", status: "done", updatedAt: "t" }],
      }),
      worker("H2", "idle"),
    ]);
    const { container } = renderTranslated(
      <PlanSwarmRun run={run} workerCount={2} />,
    );
    const lanes = container.querySelectorAll("[data-plan-swarm-lane]");
    expect(lanes).toHaveLength(2);
    const buttons = [...lanes].map((lane) => lane.querySelector("button"));
    expect(new Set(buttons.map((button) => button?.className)).size).toBe(1);
    expect(buttons[0]?.className).toContain("minmax(0,1fr)");
    expect(container.innerHTML).not.toContain("overflow-x");
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(buttons[0] as HTMLElement);
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector("[data-plan-swarm-details]")?.textContent,
    ).toContain("Gesperrt: a.md");
    expect(
      container.querySelector("[data-plan-swarm-main]")?.textContent,
    ).toContain("verteilt Teilaufgaben");
  });

  it("shows the empty, loading and failed states", () => {
    const empty = renderTranslated(
      <PlanSwarmRun
        run={runOf([worker("H1", "idle")], { tasks: [] })}
        workerCount={1}
      />,
    );
    expect(empty.container.textContent).toContain(
      "Hauptmodell plant die Aufteilung …",
    );
    empty.unmount();
    const loading = renderTranslated(
      <PlanSwarmRun run={undefined} workerCount={4} />,
    );
    expect(
      loading.container.querySelector("[data-plan-swarm-loading]")?.children,
    ).toHaveLength(4);
    loading.unmount();
    renderTranslated(
      <PlanSwarmRun
        run={runOf([
          worker("H1", "failed", { reason: "swarm_worker_timeout" }),
        ])}
        workerCount={1}
        error="swarm_timeout"
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("swarm_timeout");
    expect(screen.getByText("Zeit überschritten")).toBeTruthy();
  });
});

describe("swarm run view of failures", () => {
  it("shows a helper that could not start as not started, without a warning of the main lane", () => {
    const { container } = renderTranslated(
      <PlanSwarmRun
        run={runOf([
          worker("H1", "not_started", { reason: "cli_not_logged_in" }),
        ])}
        workerCount={1}
      />,
    );
    expect(
      screen.getByText("nicht gestartet – Aufgabe neu vergeben").className,
    ).toContain("text-muted-foreground");
    expect(container.querySelector("[data-plan-swarm-violations]")).toBeNull();
    fireEvent.click(
      container.querySelector("[data-plan-swarm-lane] button") as HTMLElement,
    );
    expect(
      container.querySelector("[data-plan-swarm-details]")?.textContent,
    ).toContain("cli_not_logged_in");
  });

  it("lists violations with their files behind a toggle", () => {
    renderTranslated(
      <PlanSwarmRun
        run={runOf([worker("H1", "idle")], {
          violations: [
            {
              kind: "outside",
              taskId: "T1",
              workerIds: ["H1", "H2"],
              files: ["x.md"],
              at: "t",
            },
          ],
        })}
        workerCount={1}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Verstoß/ }));
    expect(
      screen.getByText("Außerhalb von Bereich und Sperren (H1, H2): x.md"),
    ).toBeTruthy();
  });
});
