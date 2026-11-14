import { expect, it } from "vitest";

import {
  carriesConfirmation,
  checkRecipeDraft,
  classifyRecipeTool,
  fillPlaceholders,
  recipeName,
  RecipeValueError,
} from "@/backend/service/employee/AgentRecipeRules";

import type { AgentRecipeDraft } from "@/backend/service/employee/AgentRecipeRules";

const CONTEXT = {
  today: "2026-11-13",
  strength: 1,
  knownTools: new Set([
    "tickets_search",
    "tickets_create",
    "tickets_read",
    "storage_upload",
  ]),
};

function flow(overrides: Partial<AgentRecipeDraft> = {}): AgentRecipeDraft {
  return {
    name: "Ticket anlegen",
    kind: "flow",
    summary: "Legt ein Ticket an und liest es zur Kontrolle.",
    keywords: ["Ticket", "anlegen"],
    parameters: [{ name: "projekt", description: "ID des Projekts" }],
    steps: [
      {
        tool: "tickets_search",
        input: { projectId: "{{projekt}}" },
        note: "Optionen lesen",
      },
      {
        tool: "tickets_create",
        input: { projectId: "{{projekt}}", title: "{{titel}}" },
        note: "",
      },
      {
        tool: "tickets_read",
        input: { ticketId: "{{2.ticket.id}}" },
        note: "Kontrolle",
      },
    ],
    evidence: "3× in Sitzungen",
    ...overrides,
  };
}

it("writes the name of a recipe as the tool is called with: lower case, joined by dashes, umlauts spelled out", () => {
  expect(recipeName("Ticket anlegen")).toBe("ticket-anlegen");
  expect(recipeName("  Übergabe Größe!! ")).toBe("uebergabe-groesse");
  expect(recipeName("a")).toBeNull();
  expect(recipeName("!!!")).toBeNull();
  expect(recipeName("x".repeat(100))?.length).toBeLessThanOrEqual(40);
});

it("never lets a recipe run what deletes, removes or archives, or the recipe tool itself", () => {
  expect(classifyRecipeTool("tickets_search")).toBe("ok");
  expect(classifyRecipeTool("agents_deleted_list")).toBe("ok");
  for (const tool of [
    "tickets_delete",
    "wiki_page_delete",
    "milestones_delete",
    "tickets_archive",
    "storage_trash",
    "storage_delete_permanently",
    "agents_delete",
    "wiki_comment_delete",
  ])
    expect(classifyRecipeTool(tool)).toBe("confirmation");
  expect(classifyRecipeTool("rezept")).toBe("unusable");
  expect(classifyRecipeTool("host:Bash")).toBe("unusable");
  expect(classifyRecipeTool("")).toBe("unusable");
});

it("recognizes a step input that carries a confirmation", () => {
  expect(carriesConfirmation({ ticketId: "1", confirmed: true })).toBe(true);
  expect(carriesConfirmation({ confirmRepeat: true })).toBe(true);
  expect(carriesConfirmation({ Confirmation: "x" })).toBe(true);
  expect(carriesConfirmation({ ticketId: "1" })).toBe(false);
});

it("accepts a flow recipe with its parameters, placeholders and results of earlier steps", () => {
  const checked = checkRecipeDraft(flow(), CONTEXT);
  expect(checked.isValid).toBe(false);
  // {{titel}} is no declared parameter: the placeholder is refused.
  expect(checked).toEqual({ isValid: false, reason: "placeholder" });

  const fixed = checkRecipeDraft(
    flow({
      parameters: [
        { name: "projekt", description: "ID des Projekts" },
        { name: "titel", description: "Titel" },
      ],
    }),
    CONTEXT,
  );
  expect(fixed.isValid).toBe(true);
  if (!fixed.isValid) return;
  expect(fixed.content).toMatchObject({
    name: "ticket-anlegen",
    kind: "flow",
    keywords: ["ticket", "anlegen"],
    confirmedOn: "2026-11-13",
    strength: 1,
    body: "",
  });
  expect(fixed.content.steps).toHaveLength(3);
});

it("refuses a result of a step that does not come before", () => {
  const draft = flow({
    parameters: [{ name: "projekt", description: "" }],
    steps: [
      { tool: "tickets_read", input: { ticketId: "{{1.id}}" } },
      { tool: "tickets_search", input: {} },
    ],
  });
  expect(checkRecipeDraft(draft, CONTEXT)).toEqual({
    isValid: false,
    reason: "placeholder",
  });
});

it("refuses steps with a deleting tool, a confirmation, an unknown tool or no steps", () => {
  const base = { parameters: [{ name: "projekt", description: "" }] };
  expect(
    checkRecipeDraft(
      flow({
        ...base,
        steps: [{ tool: "tickets_delete", input: { ticketId: "1" } }],
      }),
      {
        ...CONTEXT,
        knownTools: new Set(["tickets_delete"]),
      },
    ),
  ).toEqual({ isValid: false, reason: "stepTool" });
  expect(
    checkRecipeDraft(
      flow({
        ...base,
        steps: [{ tool: "tickets_read", input: { confirmed: true } }],
      }),
      CONTEXT,
    ),
  ).toEqual({ isValid: false, reason: "stepConfirmation" });
  expect(
    checkRecipeDraft(
      flow({ ...base, steps: [{ tool: "tickets_move", input: {} }] }),
      CONTEXT,
    ),
  ).toEqual({ isValid: false, reason: "unknownTool" });
  expect(checkRecipeDraft(flow({ ...base, steps: [] }), CONTEXT)).toEqual({
    isValid: false,
    reason: "noSteps",
  });
  expect(
    checkRecipeDraft(
      flow({
        ...base,
        steps: Array.from({ length: 9 }, () => ({
          tool: "tickets_read",
          input: {},
        })),
      }),
      CONTEXT,
    ),
  ).toEqual({ isValid: false, reason: "tooManySteps" });
  // Without a list of known tools every usable tool passes.
  expect(
    checkRecipeDraft(
      flow({ ...base, steps: [{ tool: "tickets_move", input: {} }] }),
      { ...CONTEXT, knownTools: null },
    ).isValid,
  ).toBe(true);
});

it("accepts a knowledge recipe with a guide, and masks credentials in its texts", () => {
  const checked = checkRecipeDraft(
    {
      name: "Pages-Repo",
      kind: "knowledge",
      summary: "Wo das Repo liegt",
      keywords: ["Repo"],
      body: "Das Pages-Repo liegt unter /home/igor/Repo/Pages. Token: ghp_abcdefghijklmnopqrstuvwxyz123456",
    },
    CONTEXT,
  );
  expect(checked.isValid).toBe(true);
  if (!checked.isValid) return;
  expect(checked.content.body).toContain("/home/igor/Repo/Pages");
  expect(checked.content.body).not.toContain(
    "ghp_abcdefghijklmnopqrstuvwxyz123456",
  );
  expect(checked.content.steps).toEqual([]);
  expect(
    checkRecipeDraft(
      { name: "leer", kind: "knowledge", summary: "x", body: "  " },
      CONTEXT,
    ),
  ).toEqual({
    isValid: false,
    reason: "body",
  });
});

it("fills placeholders from parameters and results, typed when a text is one placeholder", () => {
  const values = {
    parameters: { projekt: "p-1", anzahl: 3, titel: "Neu" },
    results: [
      { statuses: [{ id: "todo" }] },
      { ticket: { id: "t-9", key: "PAGE-9" } },
    ],
  };
  expect(
    fillPlaceholders(
      {
        projectId: "{{projekt}}",
        limit: "{{anzahl}}",
        title: "Ticket: {{titel}} in {{projekt}}",
        status: "{{1.statuses.0.id}}",
        ticketId: "{{2.ticket.id}}",
        nested: [{ key: "{{2.ticket.key}}" }],
        fixed: 5,
      },
      values,
    ),
  ).toEqual({
    projectId: "p-1",
    limit: 3,
    title: "Ticket: Neu in p-1",
    status: "todo",
    ticketId: "t-9",
    nested: [{ key: "PAGE-9" }],
    fixed: 5,
  });
  expect(() => fillPlaceholders("{{fehlt}}", values)).toThrow(RecipeValueError);
  expect(() => fillPlaceholders("Text {{3.id}}", values)).toThrow(
    RecipeValueError,
  );
});
