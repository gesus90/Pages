import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { DiscordQrCode } from "@/app/components/projects/discord/discord-qr-code";

import { AUTHORIZE_URL } from "./discord-fixture";

it("draws a labelled black-on-white code for the link", () => {
  render(<DiscordQrCode label="QR" value={AUTHORIZE_URL} />);

  const image = screen.getByRole("img", { name: "QR" });

  expect(image.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
  expect(image.querySelector("path")?.getAttribute("fill")).toBe("#000000");
  expect(image.getAttribute("viewBox")).toMatch(/^0 0 (\d+) \1$/);
});

it("draws the same code for the same link and another one for another link", () => {
  const first = render(<DiscordQrCode label="QR" value={AUTHORIZE_URL} />);
  const pathOf = (): string | null =>
    document.querySelector("path")?.getAttribute("d") ?? null;
  const original = pathOf();

  first.unmount();
  render(<DiscordQrCode label="QR" value={AUTHORIZE_URL} />);
  expect(pathOf()).toBe(original);

  document.body.innerHTML = "";
  render(<DiscordQrCode label="QR" value={`${AUTHORIZE_URL}2`} />);
  expect(pathOf()).not.toBe(original);
});
