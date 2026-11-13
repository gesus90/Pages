import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  lessonView,
  lessonsOverview,
  stubDreamingEndpoints,
} from "./agent-dreaming-fixture";
import {
  FAILED,
  FLOW,
  KNOWLEDGE,
  LESSON,
  OFF_LESSON,
  answer,
  button,
  isOff,
  loaded,
  renderDialog,
  row,
  type,
  field,
} from "./agent-lessons-tab-fixture";

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
              lessons: [{ ...LESSON, isActive: call.fields.active === "true" }],
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
  stubDreamingEndpoints({
    lessons: () => answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  expect(screen.queryByText("read_ticket")).toBeNull();
  const toggle = button("Show details of ticket_status");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-label")).toBe(
    "Hide details of ticket_status",
  );
  expect(toggle.getAttribute("aria-expanded")).toBe("true");

  const steps = screen
    .getByRole("heading", { name: "Steps" })
    .closest("section");
  expect(steps).not.toBeNull();
  const items = within(steps as HTMLElement).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByText("read_ticket")).toBeTruthy();
  expect(within(items[0]).getByText("– Read the ticket")).toBeTruthy();
  expect(within(items[1]).getByText("set_ticket_status")).toBeTruthy();
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
  expect(
    within(parameters as HTMLElement).getByText("– The ticket key"),
  ).toBeTruthy();

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
    screen.getByText(
      /Start with the user benefit\.\s+Keep it to five lines\./u,
    ),
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
              recipes: [{ ...FLOW, isActive: call.fields.active === "true" }],
            }),
          )
        : answer(lessonsOverview({ recipes: [FLOW] })),
  });
  renderDialog();
  await loaded();
  fireEvent.click(button("Deactivate recipe: ticket_status"));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Activate recipe: ticket_status",
    }),
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
