import { expect, it } from "vitest";

import { formatClock } from "@/app/components/agents/plans/plan-agent-console/console-time";
import { wrapTerminalLine } from "@/app/components/agents/plans/plan-agent-console/terminal-wrap";

const CYAN = "\u001b[36m";
const RESET = "\u001b[0m";

it("keeps a line that fits and breaks longer ones only between words", () => {
  expect(wrapTerminalLine("kurz genug", 20)).toEqual(["kurz genug"]);
  expect(
    wrapTerminalLine("Ich versuche es mit einem weiteren Versuche.", 20),
  ).toEqual(["Ich versuche es mit", "einem weiteren", "Versuche."]);
});

it("cuts only a word longer than a whole row, at the row end", () => {
  expect(wrapTerminalLine("Pfad /home/igor/Repo/Pages/app/x.ts", 16)).toEqual([
    "Pfad /home/igor/",
    "Repo/Pages/app/x",
    ".ts",
  ]);
});

it("puts following rows flush behind indent and marker, at most half the columns", () => {
  expect(wrapTerminalLine("  ✓ eins zwei drei vier fünf", 14)).toEqual([
    "  ✓ eins zwei",
    "    drei vier",
    "    fünf",
  ]);
  expect(wrapTerminalLine("12) alpha beta gamma", 12)).toEqual([
    "12) alpha",
    "    beta",
    "    gamma",
  ]);
  expect(wrapTerminalLine(`${" ".repeat(12)}- aaa bbb ccc ddd`, 20)[1]).toBe(
    `${" ".repeat(10)}bbb ccc`,
  );
});

it("keeps the style of a line in every row and counts no control sequence", () => {
  expect(
    wrapTerminalLine(`${CYAN}● Shell  pnpm run check${RESET}`, 16),
  ).toEqual([`${CYAN}● Shell  pnpm${RESET}`, `${CYAN}  run check${RESET}`]);
  expect(wrapTerminalLine(`${CYAN}genau sechzehn!!${RESET}`, 16)).toEqual([
    `${CYAN}genau sechzehn!!${RESET}`,
  ]);
});

it("shows a running time as mm:ss and from one hour as h:mm:ss", () => {
  expect(formatClock(65_400)).toBe("01:05");
  expect(formatClock(3_725_000)).toBe("1:02:05");
});
