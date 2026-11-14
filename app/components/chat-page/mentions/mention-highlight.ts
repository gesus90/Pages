import { isAllMention } from "./mention-choices";

import type { Root, Element, ElementContent } from "hast";
import type { ConversationMentionDirectory } from "@/definition/ConversationMention";

const MENTION = /(?<![\p{L}\p{N}_@])@([\p{L}\p{N}._-]{1,100})/gu;

interface MentionIdentity {
  readonly isKnown: boolean;
  readonly isOwn: boolean;
}

function identity(
  name: string,
  directory: ConversationMentionDirectory,
): MentionIdentity {
  const normalized = name.toLowerCase();
  const isSelfAgent = directory.members.some(
    (entry) => entry.id === directory.selfId && entry.kind === "agent",
  );
  if (isAllMention(name)) return { isKnown: true, isOwn: isSelfAgent };
  const aliases = directory.aliases.filter(
    (alias) => alias.name === normalized,
  );
  if (aliases.length > 0)
    return {
      isKnown: true,
      isOwn:
        isSelfAgent &&
        aliases.some((alias) => alias.memberIds.includes(directory.selfId)),
    };
  const member = directory.members.find(
    (entry) => entry.username.toLowerCase() === normalized,
  );
  if (member) return { isKnown: true, isOwn: member.id === directory.selfId };
  const memberAliases = directory.members.filter((entry) =>
    [entry.name.replace(/\s+/gu, ""), entry.name.split(/\s+/u)[0]].some(
      (alias) => alias.toLowerCase() === normalized,
    ),
  );
  if (memberAliases.length === 1)
    return { isKnown: true, isOwn: memberAliases[0].id === directory.selfId };
  return { isKnown: false, isOwn: false };
}

function markedText(
  text: string,
  directory: ConversationMentionDirectory,
): ElementContent[] {
  const output: ElementContent[] = [];
  let end = 0;
  for (const match of text.matchAll(MENTION)) {
    const exact = identity(match[1], directory);
    const name = exact.isKnown ? match[1] : match[1].replace(/[._-]+$/u, "");
    const target = exact.isKnown ? exact : identity(name, directory);
    if (!target.isKnown) continue;
    const start = match.index;
    if (start > end)
      output.push({ type: "text", value: text.slice(end, start) });
    output.push({
      type: "element",
      tagName: "mark",
      properties: {
        "data-chat-mention": name,
        "data-own-mention": target.isOwn ? "true" : undefined,
        className: [
          "rounded",
          "px-1",
          "font-semibold",
          ...(target.isOwn
            ? ["bg-primary", "text-primary-foreground"]
            : ["bg-primary-subtle", "text-status-active"]),
        ],
      },
      children: [{ type: "text", value: `@${name}` }],
    });
    end = start + name.length + 1;
  }
  if (end < text.length) output.push({ type: "text", value: text.slice(end) });
  return output;
}

function visit(
  parent: Root | Element,
  directory: ConversationMentionDirectory,
): void {
  for (let index = parent.children.length - 1; index >= 0; index--) {
    const child = parent.children[index];
    if (child.type === "text")
      parent.children.splice(index, 1, ...markedText(child.value, directory));
    else if (
      child.type === "element" &&
      !["a", "code", "pre", "mark"].includes(child.tagName)
    )
      visit(child, directory);
  }
}

/** Marks text nodes only, keeping links, code and raw HTML inert. */
export function mentionHighlight(
  directory: ConversationMentionDirectory,
): () => (tree: Root) => void {
  return () => (tree) => visit(tree, directory);
}
