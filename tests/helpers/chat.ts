import type { ChatAdministration } from "@/definition/Chat";

/** Chat settings as the system settings page shows them with the defaults. */
export const CHAT_ADMINISTRATION: ChatAdministration = {
  attachmentLimitMegabytes: 16,
  systemInstruction: "# Pica\n\nDu bist Pica.",
  isDefaultInstruction: true,
};
