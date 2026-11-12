import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { EmbedDomainsCard } from "@/app/components/settings/system/embed-domains-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => vi.restoreAllMocks());

it("loads, releases and removes domains with trimmed form values", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ domains: [] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ domains: ["example.test"] }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ domains: [] }), { status: 200 }),
    );
  render(<EmbedDomainsCard />);
  await screen.findByText("settings.embedDomains.empty");
  const input = screen.getByLabelText("settings.embedDomains.hostName");
  const submit = screen.getByRole("button", {
    name: "settings.embedDomains.release",
  });
  expect(submit.hasAttribute("disabled")).toBe(true);
  fireEvent.change(input, { target: { value: "  example.test  " } });
  fireEvent.click(submit);
  await screen.findByText("example.test");
  expect((input as HTMLInputElement).value).toBe("");
  const releaseRequest = fetchMock.mock.calls[1]?.[1];
  expect(releaseRequest?.credentials).toBe("same-origin");
  expect(releaseRequest?.body).toBeInstanceOf(FormData);
  if (!(releaseRequest?.body instanceof FormData))
    throw new Error("Missing form");
  expect(releaseRequest.body.get("domain")).toBe("example.test");
  expect(releaseRequest.body.get("isReleased")).toBe("true");
  fireEvent.click(
    screen.getByRole("button", { name: "settings.embedDomains.removeDomain" }),
  );
  await screen.findByText("settings.embedDomains.empty");
  const removal = fetchMock.mock.calls[2]?.[1]?.body;
  if (!(removal instanceof FormData)) throw new Error("Missing form");
  expect(removal.get("isReleased")).toBe("false");
});

it("preserves the draft after a validation failure and clears the error on retry", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ domains: [] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ domains: [] }), { status: 400 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ domains: ["good.test"] }), { status: 200 }),
    );
  render(<EmbedDomainsCard />);
  await screen.findByText("settings.embedDomains.empty");
  const input = screen.getByLabelText("settings.embedDomains.hostName");
  fireEvent.change(input, { target: { value: "bad" } });
  fireEvent.click(
    screen.getByRole("button", { name: "settings.embedDomains.release" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "settings.embedDomains.error.invalid",
  );
  expect((input as HTMLInputElement).value).toBe("bad");
  fireEvent.change(input, { target: { value: "good.test" } });
  fireEvent.click(
    screen.getByRole("button", { name: "settings.embedDomains.release" }),
  );
  await screen.findByText("good.test");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reports a malformed load response", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("not json", { status: 200 }),
  );
  render(<EmbedDomainsCard />);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "settings.embedDomains.error.failed",
    ),
  );
});
