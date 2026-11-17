import { createContext } from "react";

/**
 * The place of the settings frame above its scrolling surface, where the heading of the shown area stands.
 * @remarks
 * `undefined` outside the settings frame, where a heading renders in place;
 * `null` inside the frame until its place is mounted, as on the server.
 */
export const SettingsHeaderSlotContext = createContext<
  HTMLElement | null | undefined
>(undefined);
