// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { USER_AVATAR_TYPE } from "@/definition/User";

import type { ComponentProps } from "react";

function renderAvatar(props: ComponentProps<typeof UserAvatar>): HTMLElement {
  const { container } = render(<UserAvatar {...props} />);

  return container.firstElementChild as HTMLElement;
}

describe("UserAvatar initials", () => {
  it.each([
    ["Anna Schmidt", "AS"],
    ["Anna Maria Schmidt", "AS"],
    ["anna", "A"],
    ["  Émile   Zola  ", "ÉZ"],
    ["   ", ""],
  ])("derives the initials of %p", (name, initials) => {
    expect(renderAvatar({ name }).textContent).toBe(initials);
  });

  it("renders no initials without any name", () => {
    expect(renderAvatar({}).textContent).toBe("");
  });

  it("prefers the display name of the user over the username and the name", () => {
    const avatar = renderAvatar({
      name: "Fallback Name",
      user: { displayName: " Anna Schmidt ", username: "aschmidt" },
    });

    expect(avatar.textContent).toBe("AS");
  });

  it("falls back to the username and then to the name", () => {
    expect(
      renderAvatar({ name: "Fallback Name", user: { username: "bob" } })
        .textContent,
    ).toBe("B");
    expect(
      renderAvatar({ name: "Fallback Name", user: { displayName: " " } })
        .textContent,
    ).toBe("FN");
  });
});

describe("UserAvatar placeholder color", () => {
  it("derives a stable palette entry from the user identifier", () => {
    // "a" has the code point 97, which selects palette entry 97 % 5 = 2.
    const avatar = renderAvatar({ user: { id: " a ", username: "other" } });

    expect(avatar.className).toContain("bg-[#fdf4ee] text-[#c2600f]");
  });

  it("falls back to the username and then to the resolved name", () => {
    // "b" is code point 98 (entry 3); "c" is code point 99 (entry 4).
    expect(renderAvatar({ user: { username: "b" } }).className).toContain(
      "bg-[#eef2ee] text-[#3f5a46]",
    );
    expect(renderAvatar({ name: "c" }).className).toContain(
      "bg-[#f1eef4] text-[#5a3f6a]",
    );
  });

  it("keeps the first palette entry for an empty seed", () => {
    expect(renderAvatar({}).className).toContain("bg-[#f4f1ee] text-[#8a5a34]");
  });
});

describe("UserAvatar icons", () => {
  it.each(["rocket", "star", "user"])("renders the %s icon", (iconKey) => {
    const avatar = renderAvatar({
      avatarIcon: iconKey,
      avatarType: USER_AVATAR_TYPE.ICON,
      name: "Anna Schmidt",
    });

    expect(avatar.querySelector("svg")).not.toBeNull();
    expect(avatar.textContent).toBe("");
    expect(avatar.className).toContain("bg-muted");
  });

  it.each([
    ["an unknown icon", "skull"],
    ["no icon", null],
  ])("shows the initials for %s", (_label, avatarIcon) => {
    const avatar = renderAvatar({
      avatarIcon,
      avatarType: USER_AVATAR_TYPE.ICON,
      name: "Anna Schmidt",
    });

    expect(avatar.querySelector("svg")).toBeNull();
    expect(avatar.textContent).toBe("AS");
  });

  it("ignores icons for other avatar types", () => {
    const avatar = renderAvatar({
      avatarIcon: "rocket",
      avatarType: USER_AVATAR_TYPE.INITIALS,
      name: "Anna Schmidt",
    });

    expect(avatar.querySelector("svg")).toBeNull();
    expect(avatar.textContent).toBe("AS");
  });

  it("lets the user data override the avatar properties", () => {
    const avatar = renderAvatar({
      avatarIcon: "star",
      avatarType: USER_AVATAR_TYPE.ICON,
      user: { avatarIcon: "rocket", avatarType: USER_AVATAR_TYPE.ICON },
    });

    expect(avatar.querySelector("svg")).not.toBeNull();
  });
});

describe("UserAvatar images", () => {
  const IMAGE_PROPS = {
    avatarImageUrl: "/avatars/anna.png",
    avatarType: USER_AVATAR_TYPE.IMAGE,
    name: "Anna Schmidt",
  } as const;

  it("renders the image of an image avatar", () => {
    const avatar = renderAvatar(IMAGE_PROPS);
    const image = avatar.querySelector("img");

    expect(image?.getAttribute("src")).toBe("/avatars/anna.png");
    expect(avatar.textContent).toBe("");
  });

  it("falls back to the initials when the image fails to load", () => {
    const avatar = renderAvatar(IMAGE_PROPS);

    fireEvent.error(avatar.querySelector("img") as HTMLImageElement);

    expect(avatar.querySelector("img")).toBeNull();
    expect(avatar.textContent).toBe("AS");
  });

  it("tries again when the image address changes", () => {
    const { container, rerender } = render(<UserAvatar {...IMAGE_PROPS} />);
    const avatar = container.firstElementChild as HTMLElement;

    fireEvent.error(avatar.querySelector("img") as HTMLImageElement);
    rerender(<UserAvatar {...IMAGE_PROPS} avatarImageUrl="/avatars/new.png" />);

    expect(avatar.querySelector("img")?.getAttribute("src")).toBe(
      "/avatars/new.png",
    );
  });

  it("shows the initials for a blank image address", () => {
    const avatar = renderAvatar({ ...IMAGE_PROPS, avatarImageUrl: "  " });

    expect(avatar.querySelector("img")).toBeNull();
    expect(avatar.textContent).toBe("AS");
  });

  it("prefers the image of the user data", () => {
    const avatar = renderAvatar({
      ...IMAGE_PROPS,
      user: { avatarImageUrl: "/avatars/user.png" },
    });

    expect(avatar.querySelector("img")?.getAttribute("src")).toBe(
      "/avatars/user.png",
    );
  });
});

describe("UserAvatar presentation", () => {
  it("applies the configured color, trimmed", () => {
    const avatar = renderAvatar({ avatarColor: " #ff0000 ", name: "Anna" });

    expect(avatar.style.color).toBe("rgb(255, 0, 0)");
  });

  it("applies no inline color for blank or missing colors", () => {
    expect(renderAvatar({ avatarColor: "  ", name: "Anna" }).style.color).toBe(
      "",
    );
    expect(renderAvatar({ name: "Anna" }).style.color).toBe("");
  });

  it("is hidden from assistive technology without a label", () => {
    const avatar = renderAvatar({ name: "Anna" });

    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.getAttribute("role")).toBeNull();
  });

  it("exposes a labelled avatar as an image", () => {
    const avatar = renderAvatar({
      ariaLabel: "Anna Schmidt",
      name: "Anna Schmidt",
      title: "Anna",
    });

    expect(avatar.getAttribute("role")).toBe("img");
    expect(avatar.getAttribute("aria-label")).toBe("Anna Schmidt");
    expect(avatar.getAttribute("aria-hidden")).toBeNull();
    expect(avatar.getAttribute("title")).toBe("Anna");
  });

  it("sizes the avatar and accepts additional classes", () => {
    const avatar = renderAvatar({
      className: "extra-class",
      name: "Anna",
      size: "xl",
    });

    expect(avatar.className).toContain("size-24");
    expect(avatar.className).toContain("extra-class");
  });
});
