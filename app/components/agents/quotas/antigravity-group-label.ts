import { antigravityGroupFamily } from "@/definition/AntigravityQuota";

import type { TFunction } from "i18next";
import type { AntigravityGroupFamily } from "@/definition/AntigravityQuota";

/** The colour of a group's dot; static, so Tailwind finds the classes. */
export const GROUP_DOT_CLASSES: Readonly<
  Record<AntigravityGroupFamily, string>
> = {
  gemini: "bg-antigravity",
  claude_gpt: "bg-claude",
  other: "bg-claude",
};

/**
 * The name of a group as a card shows it.
 * @param name - The group name as Antigravity reports it.
 * @param t - Translation of the interface.
 * @returns "Gemini" and "Claude und GPT" for the two known families, the
 * reported name for any other group.
 */
export function antigravityGroupLabel(name: string, t: TFunction): string {
  const family = antigravityGroupFamily(name);
  if (family === "gemini") return t("agentsPage.antigravity.group.gemini");
  if (family === "claude_gpt")
    return t("agentsPage.antigravity.group.claudeGpt");
  return name;
}
