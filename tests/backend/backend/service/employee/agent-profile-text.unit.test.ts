import { expect, it } from "vitest";

import {
  addHours,
  databaseTimeToIso,
  limitWords,
  monthStart,
  stripCredentials,
  toDatabaseTime,
} from "@/backend/service/employee/AgentEmployeeText";
import {
  agentSpecialization,
  readableDocument,
  summarizeInstructions,
} from "@/backend/service/employee/profile/AgentProfileText";

it("masks credentials in documents and extracts a readable specialization", () => {
  const token = `ghp_${"A".repeat(24)}`;
  const text = `# Agent\n\nHelps with **plans**. ${token}\n\n## Responsibilities\n- Reviews code\n- Writes tests\n\n## Other\nNot part of focus`;
  expect(stripCredentials(text)).not.toContain(token);
  expect(readableDocument(text)).toContain("[redacted]");
  expect(readableDocument("   ")).toBeNull();
  expect(summarizeInstructions(text)).toBe("Helps with plans. [redacted]");
  expect(agentSpecialization(text, 200)).toBe(
    "Helps with plans. [redacted] · Reviews code; Writes tests",
  );
  expect(agentSpecialization("😀😀😀", 2)).toBe("😀…");
});

it("limits words and converts database dates in UTC", () => {
  expect(limitWords("one\n two three", 2)).toBe("one\n two");
  expect(limitWords("one two", 3)).toBe("one two");
  expect(databaseTimeToIso(null)).toBeNull();
  expect(databaseTimeToIso("2030-01-02 03:04:05")).toBe("2030-01-02T03:04:05Z");
  expect(databaseTimeToIso("other")).toBe("other");
  const date = new Date("2030-01-02T03:04:05.999Z");
  expect(toDatabaseTime(date)).toBe("2030-01-02 03:04:05");
  expect(monthStart(date)).toBe("2030-01-01 00:00:00");
  expect(addHours("2030-01-02 03:04:05", 2).toISOString()).toBe(
    "2030-01-02T05:04:05.000Z",
  );
});
