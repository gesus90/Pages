// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import ProjectRoute from "@/app/routes/project";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

it("renders an empty main region as the future project screen", () => {
  const { container } = render(<ProjectRoute />);

  expect(container.innerHTML).toBe("<main></main>");
});
