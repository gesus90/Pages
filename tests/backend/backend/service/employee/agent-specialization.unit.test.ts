import { expect, it } from "vitest";

import { agentSpecialization } from "@/backend/service/employee/profile/AgentProfileText";

const CODER = [
  "# Aufgabe: Coder",
  "",
  "Du setzt Tickets im Code um.",
  "",
  "## Zuständig für",
  "- Umsetzung und Fehlerbehebung nach Ticket",
  "- Saubere, geprüfte Änderungen",
  "",
  "## Arbeitsweise",
  "1. Lies das Ticket und seine Abnahme vollständig.",
  "",
  "## Nicht zuständig",
  "- Ohne Auftrag deployen.",
].join("\n");

it("keeps the opening paragraph and the responsibilities, not the working rules", () => {
  const text = agentSpecialization(CODER, 400);
  expect(text).toBe(
    "Du setzt Tickets im Code um. · Umsetzung und Fehlerbehebung nach Ticket; Saubere, geprüfte Änderungen",
  );
  expect(text).not.toContain("Lies das Ticket");
  expect(text).not.toContain("deployen");
});

it("understands English headings and numbered or starred lists", () => {
  expect(
    agentSpecialization(
      "Reviews code.\n\n## Responsible for\n1. Pull requests\n* Security notes\n\n## Process\n- x",
      400,
    ),
  ).toBe("Reviews code. · Pull requests; Security notes");
});

it("gives only the opening paragraph for a document without a responsibilities heading", () => {
  expect(
    agentSpecialization("# Manager\n\nSteuert das Projekt.\n\n## Regeln\n- Wiki pflegen", 400),
  ).toBe("Steuert das Projekt.");
});

it("cuts to the limit with an ellipsis and states nothing for an empty document", () => {
  const text = agentSpecialization(CODER, 40);
  expect(Array.from(text)).toHaveLength(40);
  expect(text.endsWith("…")).toBe(true);
  expect(agentSpecialization("", 400)).toBe("");
  expect(agentSpecialization("# Nur eine Überschrift", 400)).toBe("");
});

it("keeps credentials out", () => {
  expect(
    agentSpecialization(
      "Nutzt den Token sk-abcdefghijklmnopqrstuvwxyz123456 für Jobs.",
      400,
    ),
  ).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
});
