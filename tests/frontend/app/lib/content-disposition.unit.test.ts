import { expect, it } from "vitest";

import { contentDisposition } from "@/app/lib/content-disposition";

it("keeps an ASCII name and repeats it in the encoded form", () => {
  expect(contentDisposition("attachment", "report.pdf")).toBe(
    "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf",
  );
});

it("replaces quotes, backslashes and non-ASCII characters in the fallback name", () => {
  expect(contentDisposition("inline", 'Bericht "Ä"\\.txt')).toBe(
    "inline; filename=\"Bericht ____.txt\"; filename*=UTF-8''Bericht%20%22%C3%84%22%5C.txt",
  );
});

it("percent-encodes the characters encodeURIComponent leaves as they are", () => {
  expect(contentDisposition("attachment", "it's (a)*.md")).toBe(
    "attachment; filename=\"it's (a)*.md\"; filename*=UTF-8''it%27s%20%28a%29%2A.md",
  );
});
