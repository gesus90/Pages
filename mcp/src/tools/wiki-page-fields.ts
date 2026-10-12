import type { Tool } from "@modelcontextprotocol/server";

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;
const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const COMMON =
  "pageId is a page ID or a Pages address such as /wiki/<id> (with or without the server in front). expectedRevision is the revision you read with read_wiki_page; a page saved since then returns CONFLICT with currentRevision and nothing changes. Only this field changes; the other fields stay as they are, and the previous state stays in the page versions. Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. A hidden page returns NOT_FOUND; without the write right the call returns FORBIDDEN. Wiki content accepts at most 1 MiB UTF-8, other requests at most 64 KiB.";

type FieldSchema = NonNullable<Tool["inputSchema"]["properties"]>[string];

interface FieldToolSpecification {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** The one argument that carries the new value, and its schema. */
  readonly field: string;
  readonly schema: FieldSchema;
}

function fieldTool(specification: FieldToolSpecification): Tool {
  return {
    name: specification.name,
    title: specification.title,
    description: `${specification.description} ${COMMON}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: IDENTIFIER,
        pageId: IDENTIFIER,
        expectedRevision: { type: "integer", minimum: 1 },
        [specification.field]: specification.schema,
      },
      required: [
        "operationId",
        "pageId",
        "expectedRevision",
        specification.field,
      ],
    },
    annotations: ANNOTATIONS,
  };
}

/** Changes only the title of one page. */
export const WIKI_SET_TITLE_TOOL: Tool = fieldTool({
  name: "set_wiki_page_title",
  title: "Set wiki page title",
  description:
    "Sets the title of one wiki page; text, icon and place stay unchanged. The title is trimmed to one line and must not be empty.",
  field: "title",
  schema: { type: "string", minLength: 1, maxLength: 200 },
});

/** Changes only the Markdown text of one page. */
export const WIKI_SET_CONTENT_TOOL: Tool = fieldTool({
  name: "set_wiki_page_content",
  title: "Set wiki page content",
  description:
    "Replaces the complete Markdown text of one wiki page; title, icon and place stay unchanged.",
  field: "content",
  schema: { type: "string" },
});

/** Changes only the icon of one page. */
export const WIKI_SET_ICON_TOOL: Tool = fieldTool({
  name: "set_wiki_page_icon",
  title: "Set wiki page icon",
  description:
    "Sets the icon of one wiki page to a single emoji, or removes it with null; title, text and place stay unchanged.",
  field: "icon",
  schema: { type: ["string", "null"] },
});
