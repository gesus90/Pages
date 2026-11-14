import { useMemo } from "react";

import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";

import { mentionHighlight } from "./mention-highlight";
import { useMentionDirectory } from "./mention-context";

interface MentionMarkdownProps {
  readonly source: string;
  readonly className?: string;
  readonly isDisplayableImage?: (src: string) => boolean;
}

/** Preserves chat Markdown rendering and marks recognized mention text only. */
export function MentionMarkdown(
  props: MentionMarkdownProps,
): React.ReactElement {
  const directory = useMentionDirectory();
  const plugins = useMemo(
    () => (directory ? [mentionHighlight(directory)] : []),
    [directory],
  );
  return <WikiMarkdown {...props} rehypePlugins={plugins} />;
}
