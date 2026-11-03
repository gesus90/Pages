/**
 * The findings the checks of stacks and while loops can report.
 *
 * @remarks
 * A file of its own without imports, because the MCP package reads it through
 * the operation contract.
 *
 * - `stackScope`: the flow edges of a stack join it to the members of a loop
 *   and to other nodes, or to two loops; it must be triggered in one place.
 * - `stackOrder`: a node reads the content of a stack that is not before it in
 *   the flow, so no trigger hands it an entry.
 * - `stackEntries`: an entry is invalid, duplicated, or there are too many.
 * - `stackRemote`: a node on a remote target reads a stack.
 * - `loopWhile`: a while loop has no valid boolean, or its later checks name
 *   no member or an invalid path.
 * - `loopNested`: a loop holds a loop, or a group holds something other than agents.
 */
export const PLAN_STACK_PROBLEMS = [
  "stackScope",
  "stackOrder",
  "stackEntries",
  "stackRemote",
  "loopWhile",
  "loopNested",
] as const;
