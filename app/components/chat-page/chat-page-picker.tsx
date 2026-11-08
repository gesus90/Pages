import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { VirtualChatSelection } from "@/definition/VirtualChat";
import type { ChatPageState } from "./use-chat-page";

function encode(selection: VirtualChatSelection | null): string {
  return selection ? `${selection.kind}:${selection.id}` : "";
}

function decode(value: string): VirtualChatSelection | null {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "group" || kind === "participant") return { kind, id };
  return null;
}

/**
 * The selection of groups and participants that replaces the list card
 * below `md`, above the chat.
 */
export function ChatPagePicker({
  page,
}: {
  readonly page: ChatPageState;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = [
    ...page.allGroups.map((group) => ({
      value: encode({ kind: "group", id: group.id }),
      label: group.name,
      description: t("chatPage.groupOption"),
    })),
    ...page.allParticipants.map((participant) => ({
      value: encode({ kind: "participant", id: participant.id }),
      label: participant.name,
      description: participant.role,
    })),
  ];

  function handleChange(value: string): void {
    const selection = decode(value);
    if (selection) page.select(selection);
  }

  return (
    <div className="shrink-0 md:hidden">
      <Select
        ariaLabel={t("chatPage.selectLabel")}
        className="w-full"
        onValueChange={handleChange}
        options={options}
        placeholder={t("chatPage.selectLabel")}
        size="default"
        value={encode(page.selection)}
      />
    </div>
  );
}
