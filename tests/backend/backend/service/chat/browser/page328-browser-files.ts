import { vi } from "vitest";

export const runtimeFiles = {
  contents: new Map<string, string>(),
  mkdir: vi.fn(),
  mkdtemp: vi.fn(async () => "/runtime/pages-agent-browser-unit"),
  writeFile: vi.fn(async (file: string, contents: string) => {
    runtimeFiles.contents.set(file, contents);
  }),
  rm: vi.fn(async (file: string) => {
    runtimeFiles.contents.delete(file);
  }),
};
