import { describe, expect, it } from "vitest";

import {
  getUserAvatarVisual,
  resolveUserAvatar,
} from "@/app/lib/user-avatar-display";
import { USER_AVATAR_TYPE } from "@/definition/User";

import type { UserAvatarType } from "@/definition/User";

describe("resolving an avatar", () => {
  it("takes initials from the first and the last name part", () => {
    expect(resolveUserAvatar({ name: "Ada Lovelace" }).initials).toBe("AL");
    expect(
      resolveUserAvatar({ name: "  ada   king  lovelace " }).initials,
    ).toBe("AL");
    expect(resolveUserAvatar({ name: "Plato" }).initials).toBe("P");
    expect(resolveUserAvatar({ name: "Émile Zola" }).initials).toBe("ÉZ");
    expect(resolveUserAvatar({ name: "😀 Smile" }).initials).toBe("😀S");
    expect(resolveUserAvatar({ name: "   " }).initials).toBe("");
    expect(resolveUserAvatar({}).initials).toBe("");
  });

  it("prefers the display name of the user, then the username, then the plain name", () => {
    const user = { displayName: "Grace Hopper", username: "ghopper" };

    expect(resolveUserAvatar({ user, name: "Other" }).initials).toBe("GH");
    expect(
      resolveUserAvatar({ user: { displayName: " ", username: "ghopper" } })
        .initials,
    ).toBe("G");
    expect(resolveUserAvatar({ user: {}, name: "Other Name" }).initials).toBe(
      "ON",
    );
  });

  it("defaults to the initials type without any image, icon or color", () => {
    expect(resolveUserAvatar({ name: "A B" })).toMatchObject({
      avatarType: USER_AVATAR_TYPE.INITIALS,
      iconKey: null,
      imageUrl: null,
      customColor: null,
    });
  });

  it("lets the user data win over the plain source fields", () => {
    const avatar = resolveUserAvatar({
      user: {
        avatarType: USER_AVATAR_TYPE.IMAGE,
        avatarImageUrl: " /avatars/a.png ",
        avatarColor: " #123456 ",
      },
      avatarType: USER_AVATAR_TYPE.ICON,
      avatarImageUrl: "/other.png",
      avatarColor: "#ffffff",
    });

    expect(avatar).toMatchObject({
      avatarType: USER_AVATAR_TYPE.IMAGE,
      imageUrl: "/avatars/a.png",
      customColor: "#123456",
    });
  });

  it("falls back to the plain source fields when the user has none", () => {
    expect(
      resolveUserAvatar({
        user: {},
        avatarType: USER_AVATAR_TYPE.ICON,
        avatarIcon: "rocket",
        avatarColor: "#abcdef",
        avatarImageUrl: "/x.png",
      }),
    ).toMatchObject({
      avatarType: USER_AVATAR_TYPE.ICON,
      iconKey: "rocket",
      customColor: "#abcdef",
      imageUrl: "/x.png",
    });
  });

  it("resolves an icon only for the icon type and only for a known icon", () => {
    const iconOf = (
      avatarType: UserAvatarType,
      avatarIcon: string | null,
    ): string | null => resolveUserAvatar({ avatarType, avatarIcon }).iconKey;

    expect(iconOf(USER_AVATAR_TYPE.ICON, "star")).toBe("star");
    expect(iconOf(USER_AVATAR_TYPE.ICON, "user")).toBe("user");
    expect(iconOf(USER_AVATAR_TYPE.ICON, "banana")).toBeNull();
    expect(iconOf(USER_AVATAR_TYPE.ICON, null)).toBeNull();
    expect(iconOf(USER_AVATAR_TYPE.INITIALS, "star")).toBeNull();
  });

  it("picks the placeholder color from the id, else the username, else the name", () => {
    const palette = new Set<string>();
    for (const name of ["a", "b", "c", "d", "e", "f"])
      palette.add(resolveUserAvatar({ name }).placeholderColorClasses);

    expect(palette.size).toBe(5);
    expect(
      resolveUserAvatar({ user: { id: "same", username: "x" }, name: "y" })
        .placeholderColorClasses,
    ).toBe(
      resolveUserAvatar({ user: { id: "same", username: "z" }, name: "q" })
        .placeholderColorClasses,
    );
    expect(
      resolveUserAvatar({ user: { username: "u" } }).placeholderColorClasses,
    ).toBe(resolveUserAvatar({ name: "u" }).placeholderColorClasses);
    expect(resolveUserAvatar({}).placeholderColorClasses).toMatch(
      /^bg-avatar-/u,
    );
  });
});

describe("choosing what an avatar shows", () => {
  const base = resolveUserAvatar({ name: "Ada Lovelace" });

  it("shows the image of an image avatar while it loads", () => {
    const avatar = {
      ...base,
      avatarType: USER_AVATAR_TYPE.IMAGE,
      imageUrl: "/a.png",
    };

    expect(getUserAvatarVisual(avatar, false)).toEqual({
      kind: "image",
      imageUrl: "/a.png",
    });
  });

  it("falls back to the icon or the initials when the image failed or is missing", () => {
    const failed = {
      ...base,
      avatarType: USER_AVATAR_TYPE.IMAGE,
      imageUrl: "/a.png",
    };
    const withoutUrl = {
      ...base,
      avatarType: USER_AVATAR_TYPE.IMAGE,
      imageUrl: null,
    };
    const withIcon = { ...failed, iconKey: "star" as const };

    expect(getUserAvatarVisual(failed, true)).toEqual({
      kind: "initials",
      initials: "AL",
    });
    expect(getUserAvatarVisual(withoutUrl, false)).toEqual({
      kind: "initials",
      initials: "AL",
    });
    expect(getUserAvatarVisual(withIcon, true)).toEqual({
      kind: "icon",
      iconKey: "star",
    });
  });

  it("shows the icon of an icon avatar and the initials of every other", () => {
    expect(getUserAvatarVisual({ ...base, iconKey: "rocket" }, false)).toEqual({
      kind: "icon",
      iconKey: "rocket",
    });
    expect(getUserAvatarVisual(base, false)).toEqual({
      kind: "initials",
      initials: "AL",
    });
  });
});
