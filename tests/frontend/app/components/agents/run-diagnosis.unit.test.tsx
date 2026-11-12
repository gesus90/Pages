import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { RunDetail } from "@/app/components/agents/runs/run-detail";
import { EMPTY_RUN_FILTERS } from "@/app/components/agents/runs/run-diagnosis-model";
import { RunFailureOverview } from "@/app/components/agents/runs/run-failure-overview";
import { RunList } from "@/app/components/agents/runs/run-list";
import { RunLogsTab } from "@/app/components/agents/runs/run-logs-tab";
import { RunTimelineTab } from "@/app/components/agents/runs/run-timeline-tab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => vi.unstubAllGlobals());

function response(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
}

it("loads and selects runs, then appends the next page", async () => {
  const run = {
    runId: "run-one",
    planName: "First plan",
    status: "failed",
    errorClass: "timeout",
    errorCode: "timed_out",
    startedAt: "2026-01-01T00:00:00Z",
    startedBy: { displayName: "Ada" },
    failedStepId: "build",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      response({ runs: [run], total: 2, nextCursor: "next" }),
    )
    .mockResolvedValueOnce(
      response({
        runs: [{ ...run, runId: "run-two", planName: "Second plan" }],
        total: 2,
        nextCursor: null,
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const onSelect = vi.fn();
  render(
    <RunList
      filters={{ ...EMPTY_RUN_FILTERS, planId: "plan-a" }}
      selectedRunId="run-one"
      onSelect={onSelect}
    />,
  );
  const first = await screen.findByRole("button", { name: /First plan/ });
  expect(first.getAttribute("aria-current")).toBe("true");
  fireEvent.click(first);
  expect(onSelect).toHaveBeenCalledWith("run-one");
  fireEvent.click(
    screen.getByRole("button", { name: "runDiagnosis.runs.loadMore" }),
  );
  expect(await screen.findByText("Second plan")).toBeTruthy();
  expect(screen.getByText("First plan")).toBeTruthy();
  expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=next");
  expect(fetchMock.mock.calls[0]?.[0]).toContain("planId=plan-a");
});

it("reports a failed run list request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, false)));
  render(
    <RunList
      filters={EMPTY_RUN_FILTERS}
      selectedRunId={null}
      onSelect={vi.fn()}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "runDiagnosis.loadFailed",
  );
});

it("filters logs by step and appends additional entries", async () => {
  const entry = {
    at: "invalid-time",
    level: "warn",
    source: "runner",
    message: "First message",
    isFiltered: true,
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      response({ entries: [entry], nextCursor: "more", isTruncated: true }),
    )
    .mockResolvedValueOnce(
      response({
        entries: [{ ...entry, message: "Next message" }],
        nextCursor: null,
        isTruncated: false,
      }),
    )
    .mockResolvedValueOnce(
      response({ entries: [], nextCursor: null, isTruncated: false }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<RunLogsTab runId="run-one" />);
  expect(await screen.findByText(/First message/)).toBeTruthy();
  expect(screen.getByText("runDiagnosis.logs.truncated")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "runDiagnosis.logs.loadMore" }),
  );
  expect(await screen.findByText(/Next message/)).toBeTruthy();
  expect(screen.getByText(/First message/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("runDiagnosis.logs.step"), {
    target: { value: " build " },
  });
  expect(await screen.findByText("runDiagnosis.logs.empty")).toBeTruthy();
  expect(fetchMock.mock.calls[2]?.[0]).toContain("stepId=build");
});

it("shows timeline events and stalled steps", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      response({
        stalled: [
          {
            stepId: "build",
            attemptId: "attempt-1",
            stalledForMs: 5000,
            lastEventAt: "invalid",
          },
        ],
        entries: [
          {
            stepId: "build",
            stepLabel: "Build",
            attemptId: "attempt-1",
            event: "retrying",
            at: "invalid",
            iteration: 2,
            durationMs: 1000,
            reason: "timeout: detail",
          },
        ],
      }),
    ),
  );
  render(<RunTimelineTab runId="run-one" />);
  expect(await screen.findByText(/Build/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(
    "runDiagnosis.timeline.stalled",
  );
  expect(screen.getByText(/runDiagnosis.timeline.reason.timeout/)).toBeTruthy();
});

it("groups failures and opens an example run", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    response({
      totalFailedSteps: 1,
      groups: [
        {
          errorClass: "timeout",
          planId: "plan",
          planName: "Example plan",
          stepId: "build",
          stepLabel: "Build",
          count: 1,
          firstAt: "invalid",
          lastAt: "invalid",
          exampleRunIds: ["abcdefgh-123"],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onOpenRun = vi.fn();
  render(
    <RunFailureOverview filters={EMPTY_RUN_FILTERS} onOpenRun={onOpenRun} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "abcdefgh" }));
  expect(onOpenRun).toHaveBeenCalledWith("abcdefgh-123");
  fireEvent.mouseDown(
    screen.getByRole("tab", { name: "runDiagnosis.failures.grouping.plan" }),
    { button: 0, ctrlKey: false },
  );
  await waitFor(() =>
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("groupBy=plan"),
  );
  expect(await screen.findByText(/Example plan/)).toBeTruthy();
});

it("shows a failed detail request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, false)));
  render(<RunDetail runId="run-one" />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "runDiagnosis.loadFailed",
  );
});
