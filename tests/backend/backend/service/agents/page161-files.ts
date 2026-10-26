/** A filesystem boundary with real partial-write semantics and observable descriptor ownership. */
export const journalFiles = (() => {
  const files = new Map<string, Buffer>();
  const descriptors = new Set<string>();
  const controls = {
    writeLimit: 65536,
    failure: null as string | null,
    freeBytes: 1024 * 1024 * 1024,
    writes: 0,
  };
  function missing(): Error {
    return Object.assign(new Error("Missing synthetic file"), {
      code: "ENOENT",
    });
  }
  return {
    files,
    descriptors,
    controls,
    async rm(file: string): Promise<void> {
      files.delete(file);
    },
    async mkdir(): Promise<void> {
      return;
    },
    async statfs(): Promise<{ bavail: number; bsize: number }> {
      return { bavail: controls.freeBytes, bsize: 1 };
    },
    async rename(source: string, destination: string): Promise<void> {
      const contents = files.get(source);
      if (!contents) throw missing();
      files.set(destination, contents);
      files.delete(source);
    },
    async readFile(file: string): Promise<string> {
      const contents = files.get(file);
      if (!contents) throw missing();
      return contents.toString("utf8");
    },
    async open(
      file: string,
      mode: string,
    ): Promise<{
      write: (contents: Buffer) => Promise<{ bytesWritten: number }>;
      writeFile: (contents: string) => Promise<void>;
      read: (
        target: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => Promise<{ bytesRead: number }>;
      sync: () => Promise<void>;
      close: () => Promise<void>;
      stat: () => Promise<{ size: number }>;
    }> {
      if (mode === "wx" && files.has(file))
        throw Object.assign(new Error("Synthetic duplicate"), {
          code: "EEXIST",
        });
      if (mode === "r" && file.endsWith(".bin") && !files.has(file))
        throw missing();
      if (mode === "r" && file.endsWith(".part") && !files.has(file))
        throw missing();
      if (mode === "wx") files.set(file, Buffer.alloc(0));
      descriptors.add(file);
      return {
        async write(contents): Promise<{ bytesWritten: number }> {
          if (controls.failure)
            throw Object.assign(new Error("Synthetic write failure"), {
              code: controls.failure,
            });
          controls.writes += 1;
          const bytesWritten = Math.min(contents.length, controls.writeLimit);
          files.set(
            file,
            Buffer.concat([
              files.get(file) ?? Buffer.alloc(0),
              contents.subarray(0, bytesWritten),
            ]),
          );
          return { bytesWritten };
        },
        async writeFile(contents): Promise<void> {
          if (controls.failure)
            throw Object.assign(new Error("Synthetic write failure"), {
              code: controls.failure,
            });
          files.set(file, Buffer.from(contents));
        },
        async read(
          target,
          offset,
          length,
          position,
        ): Promise<{ bytesRead: number }> {
          const contents = files.get(file);
          if (!contents) throw missing();
          return {
            bytesRead: contents.copy(
              target,
              offset,
              position,
              position + length,
            ),
          };
        },
        async sync(): Promise<void> {
          return;
        },
        async close(): Promise<void> {
          descriptors.delete(file);
        },
        async stat(): Promise<{ size: number }> {
          return { size: files.get(file)?.length ?? 0 };
        },
      };
    },
  };
})();
