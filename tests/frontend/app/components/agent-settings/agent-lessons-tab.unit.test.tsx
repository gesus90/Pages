import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { AgentSettingsDialog } from "@/app/components/agent-settings/agent-settings-dialog";
import { createI18n } from "@/app/lib/i18n";

import {
  flowRecipe,
  knowledgeRecipe,
  lessonView,
  lessonsOverview,
  stubDreamingEndpoints,
} from "./agent-dreaming-fixture";
import { deferred } from "./agent-session-fixture";

import type {
  AgentLessonsOverview,
  AgentLessonsResponse,
} from "@/definition/AgentDreaming";

const i18n = createI18n("en");

const LESSON = lessonView("l1");
const OFF_LESSON = lessonView("l2", {
  text: "Greet everybody by first name.",
  evidence: "Mei asked for it once.",
  strength: 1,
  isActive: false,
});
const FLOW = flowRecipe("r1");
const FAILED = flowRecipe("r2", {
  name: "close_all",
  summary: "Closes every open ticket.",
  isActive: false,
  disabledReason: "failed",
  failureStreak: 2,
  lastError: "set_ticket_status failed: forbidden",
  useCount: 3,
  lastUsedAt: null,
});
const KNOWLEDGE = knowledgeRecipe("r3");
const OFF_KNOWLEDGE = knowledgeRecipe("r4", {
  name: "style_guide",
  summary: "House style for texts.",
  isActive: false,
  disabledReason: "manual",
  keywords: [],
});
const FULL = lessonsOverview({
  lessons: [LESSON, OFF_LESSON],
  recipes: [FLOW, FAILED, KNOWLEDGE, OFF_KNOWLEDGE],
});

function answer(overview: AgentLessonsOverview = FULL): AgentLessonsResponse {
  return { ok: true, overview };
}

function renderDialog(language = i18n): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={language}>
      <AgentSettingsDialog agentId="ed" initialTab="lessons" onClose={vi.fn()} />
    </I18nextProvider>,
  );
}

async function loaded(): Promise<HTMLElement> {
  return screen.findByRole("heading", { name: "Lessons" });
}

function row(text: string): HTMLElement {
  const item = screen.getByText(text).closest("li");
  if (item === null) throw new Error(`No row for ${text}`);
  return item;
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

function isOff(element: HTMLElement): boolean {
  return element.hasAttribute("disabled");
}

function field(label: string, index = 0): HTMLInputElement | HTMLTextAreaElement {
  const found = screen.getAllByLabelText(label)[index];
  if (
    !(found instanceof HTMLInputElement) &&
    !(found instanceof HTMLTextAreaElement)
  )
    throw new Error(`No field ${label}`);
  return found;
}

function type(label: string, text: string, index = 0): void {
  fireEvent.change(field(label, index), { target: { value: text } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens in the tab Lessons & recipes and reads them from the endpoint with the cookies of the page", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({ lessons: () => answer() });
  renderDialog();
  await loaded();
  expect(lessonsCalls).toHaveLength(1);
  expect(lessonsCalls[0]?.url).toBe("/chat-page-api/agent-lessons?agentId=ed");
  expect(lessonsCalls[0]?.method).toBe("GET");
  expect(lessonsCalls[0]?.headers.get("Accept")).toBe("application/json");
  expect(lessonsCalls[0]?.headers.get("X-Pages-Data-Request")).toBe("1");
  expect(
    screen
      .getByRole("tab", { name: "Lessons & recipes" })
      .getAttribute("aria-selected"),
  ).toBe("true");
});

it("lists every lesson with text, evidence, date, strength and status, and the use of DREAM.md", async () => {
  stubDreamingEndpoints({ lessons: () => answer() });
  renderDialog();
  await loaded();
  expect(screen.getByText("DREAM.md: 2,100 / 4,000 characters")).toBeTruthy();
  const active = row("Read the ticket before you ask questions.");
  expect(
    within(active).getByText(
      /Evidence: Three questions in PAGE-370 were answered in the ticket\. · Last confirmed: 12\.11\.2026/u,
    ),
  ).toBeTruthy();
  expect(within(active).getByText("Strength 3")).toBeTruthy();
  expect(within(active).getByText("active")).toBeTruthy();
  const off = row("Greet everybody by first name.");
  expect(within(off).getByText("Strength 1")).toBeTruthy();
  expect(within(off).getByText("off")).toBeTruthy();
  expect(
    within(off).getByRole("button", {
      name: "Activate lesson: Greet everybody by first name.",
    }),
  ).toBeTruthy();
});

it("says that there are no lessons and no recipes yet", async () => {
  stubDreamingEndpoints({ lessons: () => answer(lessonsOverview()) });
  renderDialog();
  await loaded();
  expect(
    screen.getByText("No lessons yet. The agent learns them while it dreams."),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "No recipes yet. The agent creates them while it dreams, when it repeats a flow.",
    ),
  ).toBeTruthy();
});

it("edits the text and the evidence of a lesson and shows the list the server answers with", async () => {
  const saved = lessonView("l1-new", {
    text: "Read the ticket and its comments first.",
    evidence: "Mei confirmed it.",
  });
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: (call) =>
      call.method === "POST"
        ? answer(lessonsOverview({ lessons: [saved] }))
        : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.click(
    button("Edit lesson: Read the ticket before you ask questions."),
  );
  expect(field("Lesson").value).toBe(
    "Read the ticket before you ask questions.",
  );
  expect(field("Evidence").value).toBe(
    "Three questions in PAGE-370 were answered in the ticket.",
  );
  type("Lesson", "  Read the ticket and its comments first.  ");
  type("Evidence", "Mei confirmed it.");
  fireEvent.click(button("Save"));
  expect(
    await screen.findByText("Read the ticket and its comments first."),
  ).toBeTruthy();
  expect(lessonsCalls[1]?.method).toBe("POST");
  expect(lessonsCalls[1]?.url).toBe("/chat-page-api/agent-lessons");
  expect(lessonsCalls[1]?.fields).toEqual({
    intent: "save-lesson",
    agentId: "ed",
    lessonId: "l1",
    text: "Read the ticket and its comments first.",
    evidence: "Mei confirmed it.",
  });
  // The editor closed and the other lessons are gone with the answer.
  expect(screen.queryByLabelText("Lesson")).toBeNull();
  expect(screen.queryByText("Greet everybody by first name.")).toBeNull();
});

it("calls an edit of a lesson off and does not accept an empty text", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({ lessons: () => answer() });
  renderDialog();
  await loaded();
  fireEvent.click(
    button("Edit lesson: Read the ticket before you ask questions."),
  );
  type("Lesson", "   ");
  expect(screen.getByText("The lesson must not be empty.")).toBeTruthy();
  expect(isOff(button("Save"))).toBe(true);
  fireEvent.click(button("Cancel"));
  expect(screen.queryByLabelText("Lesson")).toBeNull();
  expect(
    screen.getByText("Read the ticket before you ask questions."),
  ).toBeTruthy();
  expect(lessonsCalls).toHaveLength(1);
});

it("switches a lesson off and on again", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: (call) =>
      call.method === "POST"
        ? answer(
            lessonsOverview({
              lessons: [
                { ...LESSON, isActive: call.fields.active === "true" },
              ],
            }),
          )
        : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.click(
    button("Deactivate lesson: Read the ticket before you ask questions."),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Activate lesson: Read the ticket before you ask questions.",
    }),
  );
  await vi.waitFor(() => expect(lessonsCalls).toHaveLength(3));
  expect(lessonsCalls[1]?.fields).toEqual({
    intent: "set-lesson-active",
    agentId: "ed",
    lessonId: "l1",
    active: "false",
  });
  expect(lessonsCalls[2]?.fields).toEqual({
    intent: "set-lesson-active",
    agentId: "ed",
    lessonId: "l1",
    active: "true",
  });
});

it("asks Really delete? first and deletes a lesson only after the confirmation", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: (call) =>
      call.method === "POST"
        ? answer(lessonsOverview({ lessons: [OFF_LESSON] }))
        : answer(),
  });
  renderDialog();
  await loaded();
  fireEvent.click(
    button("Delete lesson: Read the ticket before you ask questions."),
  );
  expect(screen.getByText("Really delete?")).toBeTruthy();
  fireEvent.click(button("Cancel"));
  expect(screen.queryByText("Really delete?")).toBeNull();
  expect(lessonsCalls).toHaveLength(1);

  fireEvent.click(
    button("Delete lesson: Read the ticket before you ask questions."),
  );
  fireEvent.click(
    button(
      "Confirm deleting the lesson: Read the ticket before you ask questions.",
    ),
  );
  await vi.waitFor(() => expect(lessonsCalls).toHaveLength(2));
  expect(lessonsCalls[1]?.fields).toEqual({
    intent: "remove-lesson",
    agentId: "ed",
    lessonId: "l1",
  });
  await vi.waitFor(() =>
    expect(
      screen.queryByText("Read the ticket before you ask questions."),
    ).toBeNull(),
  );
  expect(screen.getByText("Greet everybody by first name.")).toBeTruthy();
});

it("lists every recipe with name, kind, status, usage, strength and evidence", async () => {
  stubDreamingEndpoints({ lessons: () => answer() });
  renderDialog();
  await loaded();
  expect(screen.getByText("4 of 40 recipes")).toBeTruthy();

  const flow = row("Reads a ticket and sets its status.");
  const name = within(flow).getByText("ticket_status");
  expect(name.className).toContain("font-mono");
  expect(within(flow).getByText("Flow")).toBeTruthy();
  expect(within(flow).getByText("active")).toBeTruthy();
  expect(within(flow).getByText("Strength 2")).toBeTruthy();
  expect(within(flow).getByText(/used 12×, last 13\.11\.2026/u)).toBeTruthy();
  expect(
    within(flow).getByText(
      /Evidence: Done the same way four times\. · Last confirmed: 12\.11\.2026 · Created by Dreaming/u,
    ),
  ).toBeTruthy();

  const failed = row("Closes every open ticket.");
  expect(within(failed).getByText("off – failed 2×")).toBeTruthy();
  expect(within(failed).getByText("used 3×")).toBeTruthy();
  expect(
    within(failed).getByText("Last error: set_ticket_status failed: forbidden"),
  ).toBeTruthy();

  const knowledge = row("How release notes are written.");
  expect(within(knowledge).getByText("Knowledge")).toBeTruthy();
  expect(within(knowledge).getByText("Never used")).toBeTruthy();
  expect(within(knowledge).queryByText(/Last error/u)).toBeNull();

  const manual = row("House style for texts.");
  expect(within(manual).getByText("off – by hand")).toBeTruthy();
  expect(within(manual).getByText("Knowledge")).toBeTruthy();
});

it("opens the details of a flow recipe: numbered steps with tool, note and input, and the parameters", async () => {
  stubDreamingEndpoints({ lessons: () => answer(lessonsOverview({ recipes: [FLOW] })) });
  renderDialog();
  await loaded();
  expect(screen.queryByText("read_ticket")).toBeNull();
  const toggle = button("Show details of ticket_status");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-label")).toBe("Hide details of ticket_status");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");

  const steps = screen.getByRole("heading", { name: "Steps" }).closest("section");
  expect(steps).not.toBeNull();
  const items = within(steps as HTMLElement).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0] as HTMLElement).getByText("read_ticket")).toBeTruthy();
  expect(within(items[0] as HTMLElement).getByText("– Read the ticket")).toBeTruthy();
  expect(within(items[1] as HTMLElement).getByText("set_ticket_status")).toBeTruthy();
  expect(screen.getByLabelText("Input of step 1").textContent).toBe(
    '{\n  "key": "{{ticket}}"\n}',
  );
  expect(screen.getByLabelText("Input of step 2").textContent).toBe(
    '{\n  "key": "{{ticket}}",\n  "status": "done"\n}',
  );
  const parameters = screen
    .getByRole("heading", { name: "Parameters" })
    .closest("section");
  expect(within(parameters as HTMLElement).getByText("ticket")).toBeTruthy();
  expect(within(parameters as HTMLElement).getByText("– The ticket key")).toBeTruthy();

  fireEvent.click(toggle);
  expect(screen.queryByText("read_ticket")).toBeNull();
});

it("opens the details of a knowledge recipe: the guide and the keywords", async () => {
  stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ recipes: [KNOWLEDGE] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Show details of release_notes"));
  expect(
    screen.getByText(/Start with the user benefit\.\s+Keep it to five lines\./u),
  ).toBeTruthy();
  const keywords = screen
    .getByRole("heading", { name: "Keywords" })
    .closest("section");
  expect(
    within(keywords as HTMLElement)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["release", "notes"]);
  expect(screen.queryByRole("heading", { name: "Steps" })).toBeNull();
});

it("switches a recipe off and on again", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: (call) =>
      call.method === "POST"
        ? answer(
            lessonsOverview({
              recipes: [
                { ...FLOW, isActive: call.fields.active === "true" },
              ],
            }),
          )
        : answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Deactivate recipe: ticket_status"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Activate recipe: ticket_status" }),
  );
  await vi.waitFor(() => expect(lessonsCalls).toHaveLength(3));
  expect(lessonsCalls[1]?.fields).toEqual({
    intent: "set-recipe-active",
    agentId: "ed",
    recipeId: "r1",
    active: "false",
  });
  expect(lessonsCalls[2]?.fields).toEqual({
    intent: "set-recipe-active",
    agentId: "ed",
    recipeId: "r1",
    active: "true",
  });
});

it("re-activates a recipe that was switched off after failures", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ recipes: [FAILED] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Activate recipe: close_all"));
  await vi.waitFor(() => expect(lessonsCalls).toHaveLength(2));
  expect(lessonsCalls[1]?.fields).toMatchObject({
    intent: "set-recipe-active",
    recipeId: "r2",
    active: "true",
  });
});

it("deletes a recipe only after the confirmation", async () => {
  const { lessonsCalls } = stubDreamingEndpoints({
    lessons: (call) =>
      call.method === "POST"
        ? answer(lessonsOverview({ recipes: [] }))
        : answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Delete recipe: ticket_status"));
  expect(screen.getByText("Really delete?")).toBeTruthy();
  fireEvent.click(button("Cancel"));
  expect(lessonsCalls).toHaveLength(1);
  fireEvent.click(button("Delete recipe: ticket_status"));
  fireEvent.click(button("Confirm deleting the recipe: ticket_status"));
  await vi.waitFor(() => expect(lessonsCalls).toHaveLength(2));
  expect(lessonsCalls[1]?.fields).toEqual({
    intent: "remove-recipe",
    agentId: "ed",
    recipeId: "r1",
  });
  expect(
    await screen.findByText(
      "No recipes yet. The agent creates them while it dreams, when it repeats a flow.",
    ),
  ).toBeTruthy();
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
  type("Input (JSON object)", '{"key": "{{ticket}}", "status": "{{status}}"}', 1);
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
    { tool: "read_ticket", input: { key: "{{ticket}}" }, note: "Read the ticket" },
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
  const problem =
    'Enter a JSON object, for example {"ticket": "{{ticket}}"}.';
  expect(screen.getByText(problem).getAttribute("role")).toBe("alert");
  expect(isOff(save)).toBe(true);
  expect(field("Input (JSON object)").getAttribute("aria-invalid")).toBe("true");
  expect(field("Input (JSON object)", 1).getAttribute("aria-invalid")).toBe("false");

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
  expect(
    JSON.parse(lessonsCalls[1]?.fields.steps ?? "null"),
  ).toEqual([
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
  expect(screen.getByText("Enter a name (at most 40 characters).")).toBeTruthy();
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
  expect(
    isOff(
      button("Edit lesson: Greet everybody by first name."),
    ),
  ).toBe(true);
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
  expect(
    isOff(button("Deactivate recipe: ticket_status")),
  ).toBe(false);
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
  expect(lessonsCalls.map((call) => call.method)).toEqual(["GET", "POST", "GET"]);
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
      <AgentSettingsDialog agentId="ed" initialTab="lessons" onClose={onClose} />
    </I18nextProvider>,
  );
  await loaded();
  // The close button of the head and the one of the footer share the name.
  const closers = screen.getAllByRole("button", { name: "Close" });
  expect(closers).toHaveLength(2);
  fireEvent.click(closers[1] as HTMLElement);
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
  fireEvent.click(screen.getByRole("button", { name: "Lektion löschen: Read the ticket before you ask questions." }));
  expect(screen.getByText("Wirklich löschen?")).toBeTruthy();
  expect(screen.getByText("Ja, löschen")).toBeTruthy();
});
