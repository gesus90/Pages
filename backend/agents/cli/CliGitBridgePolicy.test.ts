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

function request(
  command: string,
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    capability: POLICY.capability,
    destination: "git@github.com",
    command,
    ...overrides,
  });
}

function packet(payload: string): Buffer {
  const body = Buffer.from(payload);
  return Buffer.concat([
    Buffer.from((body.length + 4).toString(16).padStart(4, "0")),
    body,
  ]);
}

it("allows only the authorized repository, service and push capability", () => {
  expect(
    decideBridgeRequest(request("git-upload-pack '/owner/repo.git'"), POLICY),
  ).toEqual({ isAllowed: true, service: "git-upload-pack" });
  expect(
    decideBridgeRequest(request("git-receive-pack 'owner/repo'"), POLICY),
  ).toEqual({ isAllowed: true, service: "git-receive-pack" });
  expect(
    decideBridgeRequest(request("git-receive-pack 'owner/repo'"), {
      ...POLICY,
      pushRefs: [],
    }),
  ).toMatchObject({ isAllowed: false, reason: "this session may only fetch" });
  expect(decideBridgeRequest("{", POLICY)).toMatchObject({
    isAllowed: false,
    reason: "invalid request",
  });
  expect(
    decideBridgeRequest(
      request("git-upload-pack 'owner/repo'", { capability: "wrong" }),
      POLICY,
    ),
  ).toMatchObject({ reason: "not this session" });
  expect(
    decideBridgeRequest(
      request("git-upload-pack 'owner/repo'", { destination: "other" }),
      POLICY,
    ),
  ).toMatchObject({ reason: "destination not allowed" });
  expect(
    decideBridgeRequest(request("sh -c 'anything'"), POLICY),
  ).toMatchObject({ reason: "only Git fetch and push are allowed" });
  expect(
    decideBridgeRequest(request("git-upload-pack 'owner/other'"), POLICY),
  ).toMatchObject({ isAllowed: false });
});

it("accepts only allowed non-deletion push updates after the flush packet", () => {
  const oldHash = "a".repeat(40);
  const newHash = "b".repeat(40);
  const command = packet(
    `${oldHash} ${newHash} refs/heads/work\0report-status\n`,
  );
  expect(readReceiveCommands(command, POLICY.pushRefs)).toEqual({
    state: "incomplete",
  });
  expect(
    readReceiveCommands(
      Buffer.concat([
        packet(`shallow ${oldHash}\n`),
        command,
        Buffer.from("0000"),
      ]),
      POLICY.pushRefs,
    ),
  ).toEqual({ state: "complete", refs: ["refs/heads/work"] });
  expect(
    readReceiveCommands(
      Buffer.concat([
        packet(`${oldHash} ${"0".repeat(40)} refs/heads/work\n`),
        Buffer.from("0000"),
      ]),
      POLICY.pushRefs,
    ),
  ).toMatchObject({
    state: "refused",
    reason: "deleting refs/heads/work is not allowed",
  });
  expect(
    readReceiveCommands(
      packet(`${oldHash} ${newHash} refs/heads/main\n`),
      POLICY.pushRefs,
    ),
  ).toMatchObject({
    state: "refused",
    reason: "updating refs/heads/main is not allowed",
  });
  expect(readReceiveCommands(Buffer.from("zzzz"), POLICY.pushRefs)).toEqual({
    state: "refused",
    reason: "invalid push data",
  });
  expect(readReceiveCommands(packet("invalid"), POLICY.pushRefs)).toEqual({
    state: "refused",
    reason: "unsupported push command",
  });
  const shallow = packet(`shallow ${"a".repeat(65000)}`);
  const oversized = Buffer.concat([
    ...Array<Buffer>(17).fill(shallow),
    Buffer.from("0"),
  ]);
  expect(readReceiveCommands(oversized, POLICY.pushRefs)).toEqual({
    state: "refused",
    reason: "push commands too large",
  });
});
