import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import { AGENT_DREAM_NO_COUNTS } from "@/definition/AgentDreaming";

import {
  dreamRun,
  dreamingOverview,
  lessonView,
  lessonsOverview,
  stubDreamingEndpoints,
} from "./agent-dreaming-fixture";
import {
  CHEAP,
  LOG,
  answer,
  card,
  field,
  isOff,
  loaded,
  renderDialog,
  saveButton,
} from "./agent-dreaming-tab-fixture";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shows the controls to a viewer who may not change Dreaming as off, without log and files", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          canChange: false,
          files: null,
          lastRun: dreamRun(),
        }),
      ),
  });
  renderDialog();
  const enabled = await loaded();
  expect(isOff(enabled)).toBe(true);
  expect(isOff(field("Interval"))).toBe(true);
  expect(isOff(screen.getByRole("combobox", { name: "Unit" }))).toBe(true);
  expect(isOff(field("Time of day"))).toBe(true);
  expect(
    isOff(screen.getByRole("combobox", { name: "Model for Dreaming" })),
  ).toBe(true);
  expect(
    isOff(screen.getByRole("switch", { name: "When the logbook is full" })),
  ).toBe(true);
  expect(screen.getByText("Only administrators change Dreaming.")).toBeTruthy();
  expect(isOff(saveButton())).toBe(true);
  expect(isOff(screen.getByRole("button", { name: "Dream now" }))).toBe(true);
  expect(
    screen.queryByRole("heading", { name: "Log of the last run" }),
  ).toBeNull();
  expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  // What happened is still there to read.
  expect(within(card("Last run")).getByText("Updated")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Next run" })).toBeTruthy();
});

it("shows when the last run ended, its result, its trigger and what it changed", async () => {
  stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ lastRun: dreamRun() })),
  });
  renderDialog();
  await loaded();
  const lastRun = card("Last run");
  expect(within(lastRun).getByText(/13\.11\.2026/u)).toBeTruthy();
  expect(within(lastRun).getByText("Updated")).toBeTruthy();
  expect(within(lastRun).getByText("Started by: Schedule")).toBeTruthy();
  expect(
    within(lastRun).getByText(
      "3 entries taken into memory · 1 entry dropped · 1 new lesson",
    ),
  ).toBeTruthy();
});

it.each([
  ["unchanged", "Unchanged", "logbook", "Started by: Logbook full"],
  ["failed", "Failed", "manual", "Started by: By hand"],
] as const)(
  "words a run that ended %s with its badge and trigger",
  async (status, badge, trigger, line) => {
    stubDreamingEndpoints({
      dreaming: () =>
        answer(
          dreamingOverview({
            lastRun: dreamRun({
              status,
              trigger,
              counts: AGENT_DREAM_NO_COUNTS,
            }),
          }),
        ),
    });
    renderDialog();
    await loaded();
    const lastRun = card("Last run");
    expect(within(lastRun).getByText(badge)).toBeTruthy();
    expect(within(lastRun).getByText(line)).toBeTruthy();
    expect(within(lastRun).getByText("Nothing changed.")).toBeTruthy();
  },
);

it("explains the error code of a failed run, and shows an unknown code as it is", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          lastRun: dreamRun({ status: "failed", errorCode: "invalidAnswer" }),
        }),
      ),
  });
  const first = renderDialog();
  await loaded();
  expect(
    within(card("Last run")).getByText("The model gave no usable answer."),
  ).toBeTruthy();
  first.unmount();

  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          lastRun: dreamRun({ status: "failed", errorCode: "model_gone" }),
        }),
      ),
  });
  renderDialog();
  await loaded();
  expect(
    within(card("Last run")).getByText(
      "The run failed (error code model_gone). Details are in the server log.",
    ),
  ).toBeTruthy();
});

it("says that no run happened yet", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();
  expect(
    within(card("Last run")).getByText("There has been no run yet."),
  ).toBeTruthy();
  expect(
    within(card("Log of the last run")).getByText(
      "The log appears after the first run.",
    ),
  ).toBeTruthy();
});

it("words when the next run is due, that it is off, waits or runs", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  const due = renderDialog();
  await loaded();
  expect(within(card("Next run")).getByText(/14\.11\.2026/u)).toBeTruthy();
  due.unmount();

  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          schedule: { ...dreamingOverview().schedule, isEnabled: false },
          nextRunAt: null,
        }),
      ),
  });
  const off = renderDialog();
  await loaded();
  expect(within(card("Next run")).getByText("off")).toBeTruthy();
  expect(
    within(card("Next run")).getByText(
      "Dreaming is off; a run only starts by hand.",
    ),
  ).toBeTruthy();
  off.unmount();

  stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ isWaiting: true })),
  });
  const waiting = renderDialog();
  await loaded();
  expect(
    within(card("Next run")).getByText("due – waiting for a quiet moment"),
  ).toBeTruthy();
  waiting.unmount();
});

it("groups the log of the last run by kind in a fixed order", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(dreamingOverview({ lastRun: dreamRun({ log: LOG }) })),
  });
  renderDialog();
  await loaded();
  const log = card("Log of the last run");
  const headings = within(log)
    .getAllByRole("heading", { level: 4 })
    .map((heading) => heading.textContent);
  expect(headings).toEqual([
    "Taken into memory (2)",
    "Dropped (done/outdated) (1)",
    "New lesson (1)",
    "Lesson confirmed (1)",
    "Lesson dropped (1)",
    "Recipe created (1)",
    "Recipe updated (1)",
    "Recipe removed (1)",
  ]);
  const memory = within(log)
    .getByRole("heading", { name: "Taken into memory (2)" })
    .closest("section");
  expect(memory).not.toBeNull();
  expect(within(memory as HTMLElement).getAllByRole("listitem")).toHaveLength(
    2,
  );
  expect(within(log).getByText("Igor prefers short answers.")).toBeTruthy();
  expect(within(log).getByText("old_flow")).toBeTruthy();
});

it("shows only the kinds a run touched and says when it touched none", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          lastRun: dreamRun({
            log: [{ kind: "lessonLearned", text: "Read the ticket first." }],
          }),
        }),
      ),
  });
  const first = renderDialog();
  await loaded();
  const log = card("Log of the last run");
  expect(within(log).getAllByRole("heading", { level: 4 })).toHaveLength(1);
  first.unmount();

  stubDreamingEndpoints({
    dreaming: () =>
      answer(dreamingOverview({ lastRun: dreamRun({ log: [] }) })),
  });
  renderDialog();
  await loaded();
  expect(
    within(card("Log of the last run")).getByText(
      "The last run changed nothing.",
    ),
  ).toBeTruthy();
});

it("shows MEMORY.md and DREAM.md with their sizes against the limits", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();
  const files = card("Files");
  expect(within(files).getByText("MEMORY.md")).toBeTruthy();
  expect(within(files).getByText("1,234 / 8,000 characters")).toBeTruthy();
  expect(within(files).getByText("DREAM.md")).toBeTruthy();
  expect(
    within(files).getByText("2,100 / 4,000 characters · 12 lessons"),
  ).toBeTruthy();
  expect(
    within(files)
      .getByRole("meter", { name: "Fill level of MEMORY.md" })
      .getAttribute("aria-valuenow"),
  ).toBe("15");
  expect(
    within(files)
      .getByRole("meter", { name: "Fill level of DREAM.md" })
      .getAttribute("aria-valuenow"),
  ).toBe("53");
  expect(
    within(files).getByText(/edited under Settings → Agents → Memory/u),
  ).toBeTruthy();
});

it("shows the text of both files read-only in a collapsible viewer", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  renderDialog();
  await loaded();
  const files = card("Files");
  const memory = within(files).getByLabelText("Content of MEMORY.md");
  expect(memory.tagName).toBe("PRE");
  expect(memory.textContent).toBe("# Memory\n- Igor prefers short answers.\n");
  expect(within(files).getByLabelText("Content of DREAM.md").textContent).toBe(
    "# Lessons\n- Read the ticket first.\n",
  );
  const details = within(files).getByText("Show MEMORY.md").closest("details");
  expect(details?.open).toBe(false);
  fireEvent.click(within(files).getByText("Show MEMORY.md"));
  expect(details?.open).toBe(true);
});

it("says that a file is empty and leaves out the viewers when the viewer may not read the files", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(dreamingOverview({ files: { memory: "", dream: "x" } })),
  });
  const first = renderDialog();
  await loaded();
  expect(within(card("Files")).getByText("The file is empty.")).toBeTruthy();
  first.unmount();

  stubDreamingEndpoints({
    dreaming: () => answer(dreamingOverview({ files: null })),
  });
  renderDialog();
  await loaded();
  const files = card("Files");
  expect(within(files).getByText("1,234 / 8,000 characters")).toBeTruthy();
  expect(within(files).queryByText("Show MEMORY.md")).toBeNull();
  expect(within(files).queryByText("Show DREAM.md")).toBeNull();
});

it("switches to the tab Lessons & recipes from the files card", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    dreaming: () => answer(),
    lessons: () => ({
      ok: true,
      overview: lessonsOverview({ lessons: [lessonView("l1")] }),
    }),
  });
  renderDialog();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit lessons" }));
  expect(
    await screen.findByText("Read the ticket before you ask questions."),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("tab", { name: "Lessons & recipes" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(lessonsCalls[0]?.url).toBe("/chat-page-api/agent-lessons?agentId=ed");
});

it("shows a hint while Dreaming loads and why it could not be read, with a way to try again", async () => {
  let isFailing = true;
  stubDreamingEndpoints({
    dreaming: () =>
      isFailing ? { ok: false, error: "unavailable" } : answer(),
  });
  renderDialog();
  expect(screen.getByText("Loading Dreaming …")).toBeTruthy();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Dreaming is not reachable right now. Try again in a moment.",
  );
  isFailing = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await loaded();
});

it("closes the popup with Cancel", async () => {
  stubDreamingEndpoints({ dreaming: () => answer() });
  const onClose = vi.fn();
  renderDialog({ onClose });
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("words the tab in German", async () => {
  stubDreamingEndpoints({
    dreaming: () =>
      answer(
        dreamingOverview({
          lastRun: dreamRun({ log: LOG }),
          models: [CHEAP],
        }),
      ),
  });
  renderDialog({}, createI18n("de"));
  await loaded("Dreaming aktiv");
  expect(screen.getByRole("heading", { name: "Zeitplan" })).toBeTruthy();
  expect(screen.getByLabelText("Intervall")).toBeTruthy();
  expect(screen.getByLabelText("Uhrzeit")).toBeTruthy();
  expect(screen.getByText("täglich um 03:00 (Zeit der Instanz)")).toBeTruthy();
  expect(
    screen.getByText("Lagebuch zu 62 % gefüllt, Anstoß ab 80 %"),
  ).toBeTruthy();
  expect(
    screen.getByRole("combobox", { name: "Modell für Dreaming" }).textContent,
  ).toContain("Modell des Agents (Claude Sonnet 5.5)");
  expect(
    screen.getByRole("switch", { name: "Bei vollem Lagebuch" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Letzter Lauf" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Nächster Lauf" })).toBeTruthy();
  expect(screen.getByText("Ausgelöst durch: Zeitplan")).toBeTruthy();
  expect(
    screen.getByText(
      "3 Einträge übernommen · 1 Eintrag verworfen · 1 neue Lektion",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Protokoll des letzten Laufs" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Ins Gedächtnis übernommen (2)" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Verworfen (erledigt/veraltet) (1)" }),
  ).toBeTruthy();
  expect(screen.getByText("1.234 / 8.000 Zeichen")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Jetzt träumen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Lektionen bearbeiten" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Intervall"), {
    target: { value: "7" },
  });
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Wochentag" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Montag" }));
  expect(
    screen.getByText("jeden Montag um 03:00 (Zeit der Instanz)"),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Intervall"), {
    target: { value: "6" },
  });
  expect(
    screen.getByText("alle 6 Tage um 03:00 (Zeit der Instanz)"),
  ).toBeTruthy();
});
