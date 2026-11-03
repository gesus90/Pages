import { expect, it } from "vitest";

import { readPicaInstructions } from "@/backend/service/chat/PicaInstructionFiles";

it("lets Pica manage the instance for an administrator and for nobody else", async () => {
  const { agents } = await readPicaInstructions();

  expect(agents).toContain("Administrator im aktiven Admin-Modus");
  expect(agents).toContain(
    "Verwaltungsaktionen führst du nur auf die ausdrückliche Bitte eines Administrators aus",
  );
  expect(agents).toContain("Für jede andere Person gehört Verwaltung nicht");
  expect(agents).not.toContain(
    "gehört nicht zu deinen Aufgaben.\n\n## Arbeitsweise",
  );
});

it("keeps critical changes behind a confirmation Pica can neither give nor invent", async () => {
  const { agents } = await readPicaInstructions();

  expect(agents).toContain("Kritische Verwaltungsänderungen");
  expect(agents).toContain("in einer eigenen, späteren Nachricht");
  expect(agents).toContain("weder ersetzen noch erfinden");
  expect(agents).toContain(
    "Schlüssel von Verbindungen liest und änderst du nie",
  );
  expect(agents).toContain("Weder du noch die Person noch Administratoren");
});
