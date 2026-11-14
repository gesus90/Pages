import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { createI18n } from "@/app/lib/i18n";

import {
  lessonsOverview,
  stubDreamingEndpoints,
} from "./agent-dreaming-fixture";
import { deferred } from "./agent-session-fixture";
import {
  FLOW,
  FULL,
  KNOWLEDGE,
  OFF_LESSON,
  answer,
  button,
  field,
  i18n,
  isOff,
  loaded,
  renderDialog,
  row,
  type,
} from "./agent-lessons-tab-fixture";

import type { AgentLessonsResponse } from "@/definition/AgentDreaming";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("edits a flow recipe and sends its parameters and steps as JSON", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: (call) =>
      call.method === "POST"
        ? answer(
            lessonsOverview({
              recipes: [{ ...FLOW, summary: "Reads a ticket and closes it." }],
            }),
          )
        : answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Edit recipe: ticket_status"));
  expect(field("Name").value).toBe("ticket_status");
  expect(field("Keywords").value).toBe("ticket");
  expect(field("Short description").value).toBe(
    "Reads a ticket and sets its status.",
  );
  expect(field("Name of parameter 1").value).toBe("ticket");
  expect(field("Tool", 1).value).toBe("set_ticket_status");

  type("Name", "ticket_close");
  type("Short description", "Reads a ticket and closes it.");
  type("Keywords", "ticket, status, ticket , ");
  fireEvent.click(button("Add parameter"));
  type("Name of parameter 2", "status");
  type("Description of parameter 2", "The new status");
  type(
    "Input (JSON object)",
    '{"key": "{{ticket}}", "status": "{{status}}"}',
    1,
  );
  type("Note", "Set the status", 1);
  fireEvent.click(button("Save"));

  await vi.waitFor(() => expect(lessonsCalls).toHaveLength(2));
  const sent: Readonly<Record<string, string>> = lessonsCalls[1]?.fields ?? {};
  expect(sent).toMatchObject({
    intent: "save-recipe",
    agentId: "ed",
    recipeId: "r1",
    name: "ticket_close",
    summary: "Reads a ticket and closes it.",
    keywords: "ticket, status",
    body: "",
  });
  expect(JSON.parse(sent.parameters ?? "null")).toEqual([
    { name: "ticket", description: "The ticket key" },
    { name: "status", description: "The new status" },
  ]);
  expect(JSON.parse(sent.steps ?? "null")).toEqual([
    {
      tool: "read_ticket",
      input: { key: "{{ticket}}" },
      note: "Read the ticket",
    },
    {
      tool: "set_ticket_status",
      input: { key: "{{ticket}}", status: "{{status}}" },
      note: "Set the status",
    },
  ]);
  expect(await screen.findByText("Reads a ticket and closes it.")).toBeTruthy();
  expect(screen.queryByLabelText("Name")).toBeNull();
});

it("checks that the input of a step is a JSON object before a recipe is saved", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Edit recipe: ticket_status"));
  const save = button("Save");
  expect(isOff(save)).toBe(false);

  type("Input (JSON object)", "{nope");
  const problem = 'Enter a JSON object, for example {"ticket": "{{ticket}}"}.';
  expect(screen.getByText(problem).getAttribute("role")).toBe("alert");
  expect(isOff(save)).toBe(true);
  expect(field("Input (JSON object)").getAttribute("aria-invalid")).toBe(
    "true",
  );
  expect(field("Input (JSON object)", 1).getAttribute("aria-invalid")).toBe(
    "false",
  );

  type("Input (JSON object)", '["a", "b"]');
  expect(screen.getByText(problem)).toBeTruthy();
  expect(isOff(save)).toBe(true);
  type("Input (JSON object)", "42");
  expect(isOff(save)).toBe(true);

  // A blank input is an empty object.
  type("Input (JSON object)", "  ");
  expect(screen.queryByText(problem)).toBeNull();
  expect(isOff(save)).toBe(false);
  fireEvent.click(save);
  await vi.waitFor(() => expect(lessonsCalls).toHaveLength(2));
  expect(JSON.parse(lessonsCalls[1]?.fields.steps ?? "null")).toEqual([
    { tool: "read_ticket", input: {}, note: "Read the ticket" },
    {
      tool: "set_ticket_status",
      input: { key: "{{ticket}}", status: "done" },
      note: "Close it",
    },
  ]);
});

it("needs a name, a description, a tool per step and at least one step", async () => {
  stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Edit recipe: ticket_status"));
  const save = button("Save");

  type("Name", " ");
  expect(
    screen.getByText("Enter a name (at most 40 characters)."),
  ).toBeTruthy();
  expect(isOff(save)).toBe(true);
  type("Name", "ticket_status");
  expect(isOff(save)).toBe(false);

  type("Short description", "");
  expect(
    screen.getByText("Enter a short description (at most 160 characters)."),
  ).toBeTruthy();
  expect(isOff(save)).toBe(true);
  type("Short description", "Reads a ticket.");

  type("Tool", "  ");
  expect(screen.getByText("Enter the tool.")).toBeTruthy();
  expect(isOff(save)).toBe(true);
  type("Tool", "read_ticket");

  type("Name of parameter 1", "");
  expect(screen.getByText("Every parameter needs a name.")).toBeTruthy();
  expect(isOff(save)).toBe(true);
  fireEvent.click(button("Remove parameter 1"));
  expect(screen.queryByText("Every parameter needs a name.")).toBeNull();
  expect(isOff(save)).toBe(false);

  fireEvent.click(button("Remove step 2"));
  fireEvent.click(button("Remove step 1"));
  expect(screen.getByText("A flow needs at least one step.")).toBeTruthy();
  expect(isOff(save)).toBe(true);
  fireEvent.click(button("Add step"));
  expect(isOff(save)).toBe(true);
  type("Tool", "read_ticket");
  expect(isOff(save)).toBe(false);
});

it("limits the steps and the parameters of a recipe", async () => {
  stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Edit recipe: ticket_status"));
  for (let turn = 0; turn < 6; turn += 1) fireEvent.click(button("Add step"));
  expect(screen.getAllByLabelText("Tool")).toHaveLength(8);
  expect(isOff(button("Add step"))).toBe(true);
  for (let turn = 0; turn < 7; turn += 1)
    fireEvent.click(button("Add parameter"));
  expect(isOff(button("Add parameter"))).toBe(true);
});

it("calls the edit of a recipe off without sending anything", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Edit recipe: ticket_status"));
  type("Name", "other");
  fireEvent.click(button("Cancel"));
  expect(screen.getByText("ticket_status")).toBeTruthy();
  expect(lessonsCalls).toHaveLength(1);
});

it("edits the guide of a knowledge recipe and keeps what the editor does not show", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ recipes: [KNOWLEDGE] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Edit recipe: release_notes"));
  expect(screen.queryByRole("button", { name: "Add step" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add parameter" })).toBeNull();
  expect(field("Guide").value).toBe(
    "Start with the user benefit.\nKeep it to five lines.",
  );
  expect(
    screen.getByText(`${String(KNOWLEDGE.body.length)} / 1500 characters`),
  ).toBeTruthy();

  type("Guide", "   ");
  expect(
    screen.getByText("Enter the guide (at most 1500 characters)."),
  ).toBeTruthy();
  expect(isOff(button("Save"))).toBe(true);

  type("Guide", "Lead with the benefit.");
  type("Keywords", "release, notes, changelog");
  fireEvent.click(button("Save"));
  await vi.waitFor(() => expect(lessonsCalls).toHaveLength(2));
  expect(lessonsCalls[1]?.fields).toEqual({
    intent: "save-recipe",
    agentId: "ed",
    recipeId: "r3",
    name: "release_notes",
    summary: "How release notes are written.",
    keywords: "release, notes, changelog",
    body: "Lead with the benefit.",
    parameters: "[]",
    steps: "[]",
  });
});

it("holds every button while a change runs", async () => {
  const pending = deferred<AgentLessonsResponse>();
  stubDreamingEndpoints({
    lessons: (call) => (call.method === "POST" ? pending.promise : answer()),
  });
  renderDialog();
  await loaded();
  fireEvent.click(
    button("Delete lesson: Read the ticket before you ask questions."),
  );
  fireEvent.click(
    button(
      "Confirm deleting the lesson: Read the ticket before you ask questions.",
    ),
  );
  await vi.waitFor(() =>
    expect(isOff(button("Edit recipe: ticket_status"))).toBe(true),
  );
  expect(isOff(button("Edit lesson: Greet everybody by first name."))).toBe(
    true,
  );
  pending.resolve(answer({ ...FULL, lessons: [OFF_LESSON] }));
  await vi.waitFor(() =>
    expect(isOff(button("Edit recipe: ticket_status"))).toBe(false),
  );
});

it("says why a change was refused and keeps the list", async () => {
  stubDreamingEndpoints({
    lessons: (call) =>
      call.method === "POST" ? { ok: false, error: "forbidden" } : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Deactivate recipe: ticket_status"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "You are not allowed to do that.",
  );
  expect(screen.getByText("ticket_status")).toBeTruthy();
  expect(isOff(button("Deactivate recipe: ticket_status"))).toBe(false);
});

it("keeps the editor open when saving is refused", async () => {
  stubDreamingEndpoints({
    lessons: (call) =>
      call.method === "POST" ? { ok: false, error: "invalidInput" } : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.click(
    button("Edit lesson: Read the ticket before you ask questions."),
  );
  type("Lesson", "Changed text");
  fireEvent.click(button("Save"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The entry was not accepted.",
  );
  expect(field("Lesson").value).toBe("Changed text");
});

it("reads the lists again after a conflict, so that they show what is there now", async () => {
  let isChanged = false;
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: (call) => {
      if (call.method === "POST") {
        isChanged = true;
        return { ok: false, error: "conflict" };
      }
      return answer(
        isChanged ? lessonsOverview({ lessons: [OFF_LESSON] }) : FULL,
      );
    },
  });
  renderDialog();
  await loaded();
  fireEvent.click(
    button("Deactivate lesson: Read the ticket before you ask questions."),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "The entry has changed meanwhile",
  );
  await vi.waitFor(() =>
    expect(
      screen.queryByText("Read the ticket before you ask questions."),
    ).toBeNull(),
  );
  expect(lessonsCalls.map((call) => call.method)).toEqual([
    "GET",
    "POST",
    "GET",
  ]);
});

it("reports a change that cannot reach the server as unavailable", async () => {
  stubDreamingEndpoints({ lessons: () => answer() });
  renderDialog();
  await loaded();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
  fireEvent.click(button("Deactivate recipe: ticket_status"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Lessons and recipes are not reachable right now. Try again in a moment.",
  );
});

it("shows only a note to a viewer who may not see and change lessons and recipes", async () => {
  stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ canChange: false })),
  });
  renderDialog();
  expect(
    await screen.findByText(
      "Only administrators see and change lessons and recipes.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Lessons" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Recipes" })).toBeNull();
});

it("shows a hint while the lists load and why they could not be read, with a way to try again", async () => {
  let isFailing = true;
  stubDreamingEndpoints({
    lessons: () => (isFailing ? { ok: false, error: "unavailable" } : answer()),
  });
  renderDialog();
  expect(screen.getByText("Loading lessons and recipes …")).toBeTruthy();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Lessons and recipes are not reachable right now. Try again in a moment.",
  );
  isFailing = false;
  fireEvent.click(button("Try again"));
  await loaded();
});

it("closes the popup with Close", async () => {
  stubDreamingEndpoints({ lessons: () => answer() });
  const onClose = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <AgentSettingsDialog
        agentId="ed"
        initialTab="lessons"
        onClose={onClose}
      />
    </I18nextProvider>,
  );
  await loaded();
  // The close button of the head and the one of the footer share the name.
  const closers = screen.getAllByRole("button", { name: "Close" });
  expect(closers).toHaveLength(2);
  fireEvent.click(closers[1]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("words the tab in German", async () => {
  stubDreamingEndpoints({ lessons: () => answer() });
  renderDialog(createI18n("de"));
  await screen.findByRole("heading", { name: "Lektionen" });
  expect(screen.getByRole("heading", { name: "Rezepte" })).toBeTruthy();
  expect(screen.getByText("DREAM.md: 2.100 / 4.000 Zeichen")).toBeTruthy();
  expect(screen.getByText("4 von 40 Rezepten")).toBeTruthy();
  const lesson = row("Read the ticket before you ask questions.");
  expect(within(lesson).getByText("Stärke 3")).toBeTruthy();
  expect(within(lesson).getByText("aktiv")).toBeTruthy();
  expect(within(lesson).getByText("Bearbeiten")).toBeTruthy();
  expect(within(lesson).getByText("Deaktivieren")).toBeTruthy();
  expect(within(lesson).getByText("Löschen")).toBeTruthy();
  expect(within(lesson).getByText(/Beleg: Three questions/u)).toBeTruthy();
  expect(
    screen.getByRole("button", {
      name: "Lektion bearbeiten: Read the ticket before you ask questions.",
    }),
  ).toBeTruthy();
  expect(screen.getAllByText("Ablauf")).toHaveLength(2);
  expect(screen.getAllByText("Wissen")).toHaveLength(2);
  expect(screen.getByText("aus – 2× fehlgeschlagen")).toBeTruthy();
  expect(screen.getByText("aus – von Hand")).toBeTruthy();
  expect(screen.getAllByText("Noch nie genutzt")).toHaveLength(2);
  expect(screen.getAllByText("Details anzeigen").length).toBeGreaterThan(0);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Lektion löschen: Read the ticket before you ask questions.",
    }),
  );
  expect(screen.getByText("Wirklich löschen?")).toBeTruthy();
  expect(screen.getByText("Ja, löschen")).toBeTruthy();
});
