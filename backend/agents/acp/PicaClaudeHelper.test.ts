import { expect, it } from "vitest";

import {
  decidePicaHelperPermission,
  parseExactCommand,
  picaHelperUsage,
} from "@/backend/agents/acp/PicaClaudeHelper";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

const HELPER = "/run/pica/helper";
const IMAGE = "/tmp/pages-pica-images/12345678-1234-1234-1234-123456789012.png";

const OPTIONS: RequestPermissionRequest["options"] = [
  { optionId: "yes", name: "Yes", kind: "allow_once" },
  { optionId: "no", name: "No", kind: "reject_once" },
];

function request(
  name: string,
  rawInput: unknown,
  options = OPTIONS,
): RequestPermissionRequest {
  const toolCall = { toolCallId: "t", name, rawInput };
  return { sessionId: "s", toolCall, options };
}

function bash(
  command: unknown,
  extra: Record<string, unknown> = {},
): RequestPermissionRequest {
  return request("Bash", { command, ...extra });
}

it("splits bare words, quotes and escaped apostrophes", () => {
  expect(parseExactCommand("a  'b c'd \\'e  \n")).toEqual(["a", "b cd", "'e"]);
  expect(parseExactCommand("")).toEqual([]);
  expect(parseExactCommand("x\\'")).toEqual(["x'"]);
});

it.each(["'open", "a | b", 'a "b"', "\\x"])("refuses %s", (command) => {
  expect(parseExactCommand(command)).toBeNull();
});

it("approves the exact catalog and call commands", () => {
  const catalog = `${HELPER} '{"action":"catalog"}'`;
  expect(decidePicaHelperPermission(bash(catalog), HELPER)).toEqual({
    outcome: { outcome: "selected", optionId: "yes" },
    isDenied: false,
  });
  const call = `${HELPER} '{"action":"call","name":"a_b","arguments":{}}'`;
  expect(
    decidePicaHelperPermission(
      bash(call, { description: "d", timeout: 1 }),
      HELPER,
    ).isDenied,
  ).toBe(false);
});

it("flags an approval the adapter did not offer as denied", () => {
  const catalog = `${HELPER} '{"action":"catalog"}'`;
  const noOption = request("Bash", { command: catalog }, []);
  expect(decidePicaHelperPermission(noOption, HELPER)).toEqual({
    outcome: { outcome: "cancelled" },
    isDenied: true,
  });
});

function missingToolCall(): RequestPermissionRequest {
  return {
    sessionId: "s",
    toolCall: Object.assign([], { toolCallId: "t" }),
    options: OPTIONS,
  };
}

it.each([
  ["no helper path", bash(`${HELPER} '{"action":"catalog"}'`), null],
  ["no input", request("Bash", null), HELPER],
  ["array input", request("Bash", []), HELPER],
  ["no tool call", missingToolCall(), HELPER],
  ["another tool", request("Write", {}), HELPER],
  ["extra key", bash(`${HELPER} '{"action":"catalog"}'`, { x: 1 }), HELPER],
  ["non-string command", bash(5), HELPER],
  ["three words", bash(`${HELPER} '{"action":"catalog"}' x`), HELPER],
  ["another program", bash(`/bin/ls '{"action":"catalog"}'`), HELPER],
  ["unparsable command", bash("a | b"), HELPER],
  ["invalid json", bash(`${HELPER} 'nope'`), HELPER],
  ["json that is no object", bash(`${HELPER} '[]'`), HELPER],
  [
    "catalog with a key",
    bash(`${HELPER} '{"action":"catalog","a":1}'`),
    HELPER,
  ],
  ["call without name", bash(`${HELPER} '{"action":"call"}'`), HELPER],
  [
    "call with bad name",
    bash(`${HELPER} '{"action":"call","name":"a b"}'`),
    HELPER,
  ],
  [
    "call with extra key",
    bash(`${HELPER} '{"action":"call","name":"a","x":1}'`),
    HELPER,
  ],
  ["another action", bash(`${HELPER} '{"action":"x"}'`), HELPER],
  [
    "too large request",
    bash(`${HELPER} '{"action":"catalog","a":"${"x".repeat(1024 * 1024)}"}'`),
    HELPER,
  ],
  ["image with extra key", request("Read", { file_path: IMAGE, x: 1 }), HELPER],
  [
    "image outside the folder",
    request("Read", { file_path: "/etc/passwd" }),
    HELPER,
  ],
  ["image path not a string", request("Read", { file_path: 5 }), HELPER],
])("refuses %s", (label, input, helperPath) => {
  expect(decidePicaHelperPermission(input, helperPath)).toEqual({
    outcome: { outcome: "selected", optionId: "no" },
    isDenied: true,
  });
});

it("approves reading an image the helper wrote", () => {
  expect(
    decidePicaHelperPermission(request("Read", { file_path: IMAGE }), HELPER)
      .isDenied,
  ).toBe(false);
});

it("words the usage for YOLO and for restricted access", () => {
  expect(picaHelperUsage(HELPER, "yolo")).toContain("full access");
  expect(picaHelperUsage(HELPER, "read_only")).toContain(
    "Run no other command",
  );
});
