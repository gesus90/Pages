import { expect, it } from "vitest";

import {
  decideBridgeRequest,
  readReceiveCommands,
} from "@/backend/agents/cli/CliGitBridgePolicy";

const POLICY = {
  capability: "synthetic-token",
  repository: "owner/repo",
  pushRefs: ["refs/heads/work"],
};
const OLD_HASH = "a".repeat(40);
const NEW_HASH = "b".repeat(40);

function packet(payload: string): Buffer {
  const body = Buffer.from(payload);
  return Buffer.concat([
    Buffer.from((body.length + 4).toString(16).padStart(4, "0")),
    body,
  ]);
}

it("refuses request lines that are not a JSON object with a text capability", () => {
  expect(decideBridgeRequest("null", POLICY)).toEqual({
    isAllowed: false,
    reason: "invalid request",
  });
  expect(decideBridgeRequest('"text"', POLICY)).toEqual({
    isAllowed: false,
    reason: "invalid request",
  });
  expect(decideBridgeRequest("[]", POLICY)).toEqual({
    isAllowed: false,
    reason: "not this session",
  });
  expect(
    decideBridgeRequest(JSON.stringify({ capability: 7 }), POLICY),
  ).toEqual({ isAllowed: false, reason: "not this session" });
});

it("refuses a command that is missing, not text or not a quoted service call", () => {
  const base = { capability: POLICY.capability, destination: "git@github.com" };
  const refused = {
    isAllowed: false,
    reason: "only Git fetch and push are allowed",
  };
  expect(decideBridgeRequest(JSON.stringify(base), POLICY)).toEqual(refused);
  expect(
    decideBridgeRequest(JSON.stringify({ ...base, command: 5 }), POLICY),
  ).toEqual(refused);
  expect(
    decideBridgeRequest(
      JSON.stringify({ ...base, command: "git-upload-pack ''" }),
      POLICY,
    ),
  ).toEqual(refused);
});

it("names the policy repository when another one is requested", () => {
  expect(
    decideBridgeRequest(
      JSON.stringify({
        capability: POLICY.capability,
        destination: "git@github.com",
        command: "git-upload-pack 'owner/other.git'",
      }),
      POLICY,
    ),
  ).toEqual({ isAllowed: false, reason: "only owner/repo is allowed" });
});

it("waits for the rest of a packet and refuses packets shorter than their header", () => {
  const complete = packet(`${OLD_HASH} ${NEW_HASH} refs/heads/work\n`);
  expect(
    readReceiveCommands(complete.subarray(0, complete.length - 3), [
      "refs/heads/work",
    ]),
  ).toEqual({ state: "incomplete" });
  expect(readReceiveCommands(Buffer.from("0003"), POLICY.pushRefs)).toEqual({
    state: "refused",
    reason: "invalid push data",
  });
  expect(readReceiveCommands(Buffer.alloc(0), POLICY.pushRefs)).toEqual({
    state: "incomplete",
  });
});

it("reads a command that carries capabilities and one without a trailing newline", () => {
  expect(
    readReceiveCommands(
      Buffer.concat([
        packet(`${OLD_HASH} ${NEW_HASH} refs/heads/work\0side-band-64k`),
        packet(`${OLD_HASH} ${NEW_HASH} refs/heads/work`),
        Buffer.from("0000"),
      ]),
      POLICY.pushRefs,
    ),
  ).toEqual({
    state: "complete",
    refs: ["refs/heads/work", "refs/heads/work"],
  });
});
