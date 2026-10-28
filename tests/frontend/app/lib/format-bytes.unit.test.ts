import { expect, it } from "vitest";

import { formatBytes } from "@/app/lib/format-bytes";

it("writes small sizes in whole bytes and treats negative sizes as zero", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(-5)).toBe("0 B");
});

it("uses one decimal below ten and whole numbers above in larger units", () => {
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  expect(formatBytes(42 * 1024 ** 3)).toBe("42 GB");
});

it("stops at terabytes for very large sizes", () => {
  expect(formatBytes(2048 * 1024 ** 4)).toBe("2048 TB");
});
