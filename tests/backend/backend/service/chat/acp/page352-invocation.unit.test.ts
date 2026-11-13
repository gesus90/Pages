import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { removePicaInvocationFile } from "@/backend/service/chat/acp/PicaInvocationFile";

const filesystem = vi.hoisted(() => ({
  handles: new Map<number, string>(),
  entries: new Set<string>(),
  next: 0,
  replaced: false,
}));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  const resolve = (location: string): string =>
    path.normalize(
      location.replace(
        /^\/proc\/self\/fd\/(\d+)/u,
        (match, descriptor: string) =>
          filesystem.handles.get(Number(descriptor)) ?? match,
      ),
    );
  const facts = (location: string) => ({
    isDirectory: () => true,
    mode: 0o700,
    uid: process.getuid?.(),
    dev: 1,
    ino: location,
  });
  return {
    ...original,
    openSync: (location: string) => {
      filesystem.next += 1;
      filesystem.handles.set(filesystem.next, resolve(location));
      return filesystem.next;
    },
    closeSync: (descriptor: number) => {
      filesystem.handles.delete(descriptor);
    },
    fstatSync: (descriptor: number) =>
      facts(filesystem.handles.get(descriptor) ?? ""),
    lstatSync: (location: string) =>
      facts(filesystem.replaced ? "replaced" : resolve(location)),
    realpathSync: resolve,
    unlinkSync: (location: string) => {
      filesystem.entries.delete(resolve(location));
    },
    rmdirSync: (location: string) => {
      const directory = resolve(location);
      if (
        [...filesystem.entries].some(
          (entry) => path.dirname(entry) === directory,
        )
      )
        throw new Error("Not empty");
      filesystem.entries.delete(directory);
    },
  };
});
const WORKSPACE = "/private/work";
const DIRECTORY = `${WORKSPACE}/.pica-11111111-1111-4111-8111-111111111111`;

beforeEach(() => {
  filesystem.handles.clear();
  filesystem.entries = new Set([
    DIRECTORY,
    `${DIRECTORY}/invocation.json`,
    `${DIRECTORY}/pages-pica`,
  ]);
  filesystem.next = 0;
  filesystem.replaced = false;
});

it("removes the invocation descriptor, executable and empty job directory", () => {
  removePicaInvocationFile(WORKSPACE, `${DIRECTORY}/invocation.json`);
  expect(filesystem.entries.size).toBe(0);
  expect(filesystem.handles.size).toBe(0);
});

it("refuses a replaced invocation directory without deleting it", () => {
  filesystem.replaced = true;
  expect(() =>
    removePicaInvocationFile(WORKSPACE, `${DIRECTORY}/invocation.json`),
  ).toThrow("changed");
  expect(filesystem.entries.size).toBe(3);
  expect(filesystem.handles.size).toBe(0);
});
