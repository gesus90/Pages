import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { ConfigError, DEFAULT_CONFIG } from "@/backend/config/PagesConfig";

describe("ConfigFile", () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-config-"));
    filePath = path.join(directory, "nested", "config.toml");
  });

  afterEach(async () => {
    await chmod(directory, 0o700);
    await rm(directory, { force: true, recursive: true });
  });

  it("reports a missing file as null", async () => {
    const file = new ConfigFile(filePath);

    expect(file.path).toBe(filePath);
    await expect(file.read()).resolves.toBeNull();
  });

  it("writes a private file and reads it back", async () => {
    const file = new ConfigFile(filePath);

    await file.write(DEFAULT_CONFIG);

    const text = await readFile(filePath, "utf8");

    expect(text).toContain("# Pages configuration.");
    expect(text).toContain("firstRun = true");
    expect(text).toContain("port = 3000");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    await expect(file.read()).resolves.toEqual(DEFAULT_CONFIG);
    expect(await readdir(path.dirname(filePath))).toEqual(["config.toml"]);
  });

  it("keeps values an operator added by hand", async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      '# my note\nport = 4000\nowner = "ops"\n\n[tls]\ncertificate = "/a.pem"\n',
    );

    const file = new ConfigFile(filePath);
    const updated = await file.update((current) => ({
      ...current,
      port: 5000,
    }));

    expect(updated).toEqual({ ...DEFAULT_CONFIG, port: 5000 });

    const text = await readFile(filePath, "utf8");

    expect(text).toContain('owner = "ops"');
    expect(text).toContain('certificate = "/a.pem"');
    expect(text).toContain("port = 5000");
  });

  it("refuses to update a missing file", async () => {
    await expect(
      new ConfigFile(filePath).update((current) => current),
    ).rejects.toThrow("does not exist");
  });

  it("never touches a file that is no valid TOML", async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "firstRun = \n");

    const file = new ConfigFile(filePath);

    await expect(file.read()).rejects.toThrow("is not valid TOML");
    await expect(file.write(DEFAULT_CONFIG)).rejects.toThrow(ConfigError);
    await expect(readFile(filePath, "utf8")).resolves.toBe("firstRun = \n");
  });

  it("reports an unreadable file", async () => {
    await mkdir(filePath, { recursive: true });

    await expect(new ConfigFile(filePath).read()).rejects.toThrow(
      "cannot be read",
    );
  });

  it("reports a file that cannot be written and leaves no temporary file", async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await chmod(path.dirname(filePath), 0o500);

    await expect(
      new ConfigFile(filePath).write(DEFAULT_CONFIG),
    ).rejects.toThrow("cannot be written");

    await chmod(path.dirname(filePath), 0o700);
    expect(await readdir(path.dirname(filePath))).toEqual([]);
  });
});
