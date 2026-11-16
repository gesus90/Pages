import { expect, it } from "vitest";

import { validateTicketDescriptionSources } from "@/backend/service/task/TaskDescriptionAssetService";
import {
  rewriteTicketDescription,
  ticketDescriptionAddress,
  ticketDescriptionReferences,
} from "@/backend/service/task/TicketDescriptionReferences";

it("recognizes only local attachment routes and leaves code samples inert", () => {
  expect(ticketDescriptionAddress("/agent-assets/abc?download=1")).toEqual({
    source: "agent",
    id: "abc",
  });
  expect(
    ticketDescriptionAddress("https://example.com/agent-assets/abc"),
  ).toBeNull();
  const markdown =
    "![picture](/agent-assets/abc) and `[sample](/agent-assets/ignored)`";
  expect(ticketDescriptionReferences(markdown)).toMatchObject([
    { url: "/agent-assets/abc", isImage: true },
  ]);
});

it("rewrites destinations while preserving other markdown", () => {
  const markdown = "[one](/agent-assets/a) and ![two](/agent-assets/b)";
  const refs = ticketDescriptionReferences(markdown);
  expect(
    rewriteTicketDescription(
      markdown,
      new Map([
        [refs[0], "/aufgaben/attachments/one"],
        [refs[1], "/aufgaben/attachments/two"],
      ]),
    ),
  ).toBe(
    "[one](/aufgaben/attachments/one) and ![two](/aufgaben/attachments/two)",
  );
  expect(() => rewriteTicketDescription(markdown, new Map())).toThrow();
});

it("refuses remote images, file links and embedded HTML images", () => {
  expect(() =>
    validateTicketDescriptionSources("![image](/aufgaben/attachments/abc)"),
  ).not.toThrow();
  expect(() =>
    validateTicketDescriptionSources("[page](https://example.com)"),
  ).not.toThrow();
  expect(() =>
    validateTicketDescriptionSources("![image](https://example.com/a.png)"),
  ).toThrow();
  expect(() =>
    validateTicketDescriptionSources("[file](file:///etc/passwd)"),
  ).toThrow();
  expect(() =>
    validateTicketDescriptionSources('<img src="https://example.com/a.png">'),
  ).toThrow();
});
