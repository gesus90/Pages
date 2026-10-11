import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { normalizeWikiTitle } from "@/definition/Wiki";

import type { Nodes } from "mdast";
import type {
  AgentImportFile,
  AgentImportIndexEntry,
} from "@/definition/AgentImportManifest";

const parser = unified().use(remarkParse).use(remarkGfm);

function headingText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image" || node.type === "imageReference")
    return node.alt ?? "";
  if (node.type === "break") return " ";
  if ("children" in node) return node.children.map(headingText).join("");
  return "";
}

/** Resolves explicit title, first top-level H1, then filename; Markdown remains untouched. */
export function readImportTitle(file: AgentImportFile): AgentImportIndexEntry {
  if (file.title !== undefined)
    return {
      sourceKey: file.sourceKey,
      title: normalizeWikiTitle(file.title),
      titleSource: "explicit",
    };
  const heading = parser
    .parse(file.content)
    .children.find((node) => node.type === "heading" && node.depth === 1);
  if (heading)
    return {
      sourceKey: file.sourceKey,
      title: normalizeWikiTitle(headingText(heading)),
      titleSource: "h1",
    };
  const filename = file.sourceKey.slice(file.sourceKey.lastIndexOf("/") + 1);
  return {
    sourceKey: file.sourceKey,
    title: normalizeWikiTitle(filename.replace(/\.md$/i, "")),
    titleSource: "filename",
  };
}
