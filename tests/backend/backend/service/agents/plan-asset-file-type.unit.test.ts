import { expect, it } from "vitest";

import { detectPlanAssetType } from "@/backend/service/agents/assets/PlanAssetFileType";

it.each([
  [Buffer.from("89504e470d0a1a0a", "hex"), "image.png", "image/png", "image"],
  [Buffer.from("%PDF-1.7"), "document", "application/pdf", "document"],
  [Buffer.from("<html>content</html>"), "page.html", "text/html", "other"],
  [Buffer.from("hello world"), "notes.MD", "text/markdown", "document"],
  [Buffer.from("name,value\na,b"), "items.csv", "text/csv", "document"],
  [Buffer.from("hello world"), "file.unknown", "text/plain", "document"],
  [
    Buffer.from("504b0304", "hex"),
    "report.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "document",
  ],
  [Buffer.from("504b0304", "hex"), "archive.zip", "application/zip", "archive"],
  [
    Buffer.from([0, 255, 0, 255]),
    "image.png",
    "application/octet-stream",
    "other",
  ],
  [Buffer.alloc(0), "empty.txt", "application/octet-stream", "other"],
])("identifies content for %s", (head, name, mediaType, kind) => {
  expect(detectPlanAssetType(head, name)).toEqual({ mediaType, kind });
});

it("recognizes container brands without trusting file extensions", () => {
  const quicktime = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypqt  "),
  ]);
  const audio = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypM4A "),
  ]);
  expect(detectPlanAssetType(quicktime, "movie.mp4")).toEqual({
    mediaType: "video/quicktime",
    kind: "video",
  });
  expect(detectPlanAssetType(audio, "audio.mp4")).toEqual({
    mediaType: "audio/mp4",
    kind: "audio",
  });
});
