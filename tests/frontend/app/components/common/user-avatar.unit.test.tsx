import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { USER_AVATAR_TYPE } from "@/definition/User";

it("falls back to initials on image failure and retries when the image changes", () => {
  const { rerender } = render(
    <UserAvatar
      name="Ada Lovelace"
      ariaLabel="Ada"
      avatarType={USER_AVATAR_TYPE.IMAGE}
      avatarImageUrl="/first.png"
    />,
  );
  const avatar = screen.getByRole("img", { name: "Ada" });
  const first = avatar.querySelector("img");
  expect(first?.getAttribute("src")).toBe("/first.png");
  if (!first) throw new Error("Avatar image missing");
  fireEvent.error(first);
  expect(avatar.textContent).toBe("AL");
  rerender(
    <UserAvatar
      name="Ada Lovelace"
      ariaLabel="Ada"
      avatarType={USER_AVATAR_TYPE.IMAGE}
      avatarImageUrl="/second.png"
    />,
  );
  expect(avatar.querySelector("img")?.getAttribute("src")).toBe("/second.png");
});

it("renders a decorative icon and a custom color ring", () => {
  const { container } = render(
    <UserAvatar
      name="Ada"
      avatarType={USER_AVATAR_TYPE.ICON}
      avatarIcon="star"
      avatarColor="#123456"
    />,
  );
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  expect(container.querySelector(".pages-user-color-ring")).not.toBeNull();
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
});
