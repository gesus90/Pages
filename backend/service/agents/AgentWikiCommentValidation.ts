import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { COMMENT_QUOTE_LENGTH } from "@/backend/service/wiki/WikiCommentService";
import { PAGES_AGENT_COMMENT_OPERATIONS } from "@/definition/PagesAgentOperations";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import { readWikiPageReference } from "./AgentWikiFieldValidation";

import type {
  AgentWikiCommentAddInput,
  AgentWikiCommentEditInput,
  AgentWikiCommentResolveInput,
  AgentWikiCommentTarget,
  AgentWikiCommentWriteOperation,
} from "@/definition/AgentWikiComments";
import type { PagesAgentCommentOperation } from "@/definition/PagesAgentOperations";

/** A validated comment write, tagged with the operation that carries it. */
export type AgentWikiCommentRequest =
  | ({ readonly operation: "wiki.comment.add" } & AgentWikiCommentAddInput)
  | ({ readonly operation: "wiki.comment.edit" } & AgentWikiCommentEditInput)
  | ({
      readonly operation: "wiki.comment.resolve";
    } & AgentWikiCommentResolveInput)
  | ({
      readonly operation: "wiki.comment.delete";
    } & AgentWikiCommentTarget & { readonly confirmation: unknown });

const ADD_KEYS = ["operationId", "pageId", "body", "parentId", "quote"];
const REQUIRED_ADD_KEYS = ["operationId", "pageId", "body"];

/** Tells whether an operation name is one of the comment operations. */
export function isAgentCommentOperation(
  name: unknown,
): name is PagesAgentCommentOperation {
  return (
    typeof name === "string" &&
    PAGES_AGENT_COMMENT_OPERATIONS.some((operation) => operation === name)
  );
}

function readText(input: unknown): string {
  if (typeof input !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function readQuote(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const quote = readText(input);
  // The wiki trims a quote before it stores it, so the bound applies to the trimmed text.
  if (Array.from(quote.trim()).length > COMMENT_QUOTE_LENGTH)
    throw new AgentOperationError("INVALID_REQUEST");
  return quote;
}

function readAdd(
  fields: Readonly<Record<string, unknown>>,
): AgentWikiCommentAddInput {
  if (
    Object.keys(fields).some((key) => !ADD_KEYS.includes(key)) ||
    REQUIRED_ADD_KEYS.some((key) => !(key in fields))
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const { parentId } = fields;
  return {
    operationId: readIdentifier(fields.operationId),
    pageId: readWikiPageReference(fields.pageId),
    parentId:
      parentId === undefined || parentId === null
        ? null
        : readIdentifier(parentId),
    body: readText(fields.body),
    quote: readQuote(fields.quote),
  };
}

function readTarget(
  fields: Readonly<Record<string, unknown>>,
  valueKeys: readonly string[],
): AgentWikiCommentTarget {
  requireParameterKeys(fields, ["operationId", "commentId", ...valueKeys]);
  return {
    operationId: readIdentifier(fields.operationId),
    commentId: readIdentifier(fields.commentId),
  };
}

/**
 * Validates one comment write before any persistence or policy read.
 *
 * @param operation - The comment operation that was called.
 * @param input - The raw operation parameters.
 * @returns The request, tagged with its operation.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 *
 * @remarks
 * Adding takes only `operationId`, `pageId` and `body` as required parameters: a comment
 * without `parentId` starts a thread, one without `quote` is about the page. Edit, resolve
 * and delete name every parameter, so a call never changes anything implicitly. A comment
 * is named by its identifier; the page it belongs to follows from it.
 */
export function readAgentWikiCommentWrite(
  operation: AgentWikiCommentWriteOperation,
  input: unknown,
): AgentWikiCommentRequest {
  const fields = readParameterRecord(input);
  switch (operation) {
    case "wiki.comment.add":
      return { operation, ...readAdd(fields) };
    case "wiki.comment.edit":
      return {
        operation,
        ...readTarget(fields, ["body"]),
        body: readText(fields.body),
      };
    case "wiki.comment.resolve": {
      const target = readTarget(fields, ["resolved"]);
      if (typeof fields.resolved !== "boolean")
        throw new AgentOperationError("INVALID_REQUEST");
      return { operation, ...target, resolved: fields.resolved };
    }
    case "wiki.comment.delete": {
      const { confirmation, ...target } = fields;
      return { operation, ...readTarget(target, []), confirmation };
    }
  }
}

/**
 * Validates the parameters of a comment read.
 *
 * @param input - The raw operation parameters.
 * @returns The identifier of the page whose comments are read.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentWikiCommentsRead(input: unknown): string {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["pageId"]);
  return readWikiPageReference(fields.pageId);
}
