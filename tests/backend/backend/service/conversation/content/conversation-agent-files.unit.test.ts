import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  AGENT_FILE_ROOTS,
  ConversationAgentFiles,
  agentSelectionText,
} from "@/backend/service/conversation/content/ConversationAgentFiles";

let home: string;
let files: ConversationAgentFiles;

async function place(relative: string, content = "x"): Promise<string> {
  const file = path.join(home, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

function line(file: string): string {
  return `![Datei](file:${file})`;
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "pages-agent-files-"));
  files = new ConversationAgentFiles({ home });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it("names the allowed roots in one constant", () => {
  expect(AGENT_FILE_ROOTS.map((root) => root.segments.join("/"))).toEqual([
    ".pages/pica-sessions",
    "Results",
  ]);
});

it("attaches files from a Pica working directory and from ~/Results", async () => {
  const session = await place(".pages/pica-sessions/s1/entwurf.png");
  const result = await place("Results/report/diff.patch");
  const selection = await files.select(
    ["Hier:", line(session), line(result)].join("\n"),
  );
  expect(selection.text).toBe("Hier:");
  expect(selection.files.map((file) => file.name)).toEqual([
    "entwurf.png",
    "diff.patch",
  ]);
  expect(selection.files[0]).toMatchObject({
    mimeType: "image/png",
    sizeBytes: 1,
    lineIndex: 1,
  });
});

it.each([
  ".pages/data/agents/a1/home/.claude/.credentials.json",
  ".pages/data/agents/a1/home/.config/antigravity-acp/acp_token.json",
  ".claude/.credentials.json",
  ".git-credentials",
  ".config/gh/hosts.yml",
  ".netrc",
  "Documents/notes.txt",
  ".pages/pica-sessions/loose.txt",
])("refuses %s as a place that is not allowed", async (relative) => {
  const file = await place(relative);
  const selection = await files.select(line(file));
  expect(selection.files).toEqual([]);
  expect(selection.text).toBe(
    `${line(file)} (Datei nicht angehängt: Ort nicht freigegeben)`,
  );
});

it("refuses a link from ~/Results to ~/.claude", async () => {
  const secret = await place(".claude/.credentials.json");
  await mkdir(path.join(home, "Results"), { recursive: true });
  const link = path.join(home, "Results", "credentials.json");
  await symlink(secret, link);
  const selection = await files.select(line(link));
  expect(selection.files).toEqual([]);
  expect(selection.text).toContain(
    "(Datei nicht angehängt: Ort nicht freigegeben)",
  );
});

it("refuses hidden parts below a root, such as the helper folders .pica-*", async () => {
  const picaHelper = await place(".pages/pica-sessions/x/.pica-y/token.json");
  const hidden = await place("Results/.cache/file.txt");
  const selection = await files.select(
    [line(picaHelper), line(hidden)].join("\n"),
  );
  expect(selection.files).toEqual([]);
  expect(selection.text.match(/Ort nicht freigegeben/gu)).toHaveLength(2);
});

it("still refuses secret file names inside an allowed root", async () => {
  const env = await place("Results/.env");
  const key = await place("Results/server.key");
  const selection = await files.select([line(env), line(key)].join("\n"));
  expect(selection.files).toEqual([]);
  expect(selection.text.match(/Ort mit Zugangsdaten/gu)).toHaveLength(2);
});

it("keeps the line of a file that could not be stored, with the reason", async () => {
  const one = await place("Results/eins.png");
  const two = await place("Results/zwei.png");
  const selection = await files.select(
    ["Text", line(one), line(two)].join("\n"),
  );
  const [, second] = selection.files;
  expect(agentSelectionText(selection, second ? [second] : [])).toBe(
    `Text\n${line(two)} (Datei nicht angehängt: Speichern fehlgeschlagen)`,
  );
});
