import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Appearance } from "react-native";

import { SETTINGS_STORAGE_KEY } from "@/settings/settings-storage";

jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));

async function storedSettings(): Promise<unknown> {
  const stored = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);

  return stored === null ? null : JSON.parse(stored);
}

describe("the app", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ status: "ok" }))),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("opens on the Pica view with the empty state and no server", async () => {
    renderRouter("./app", { initialUrl: "/" });

    expect(await screen.findByText("No conversation yet")).toBeTruthy();
    // The header title and the tab both carry the name.
    expect(screen.getAllByText("Pica")).toHaveLength(2);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getAllByText("No server").length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leads from the empty state to the server setting", async () => {
    renderRouter("./app", { initialUrl: "/" });

    fireEvent.press(
      await screen.findByRole("button", { name: "Set up server" }),
    );

    expect(await screen.findByLabelText("Pages server address")).toBeTruthy();
  });

  it("rejects an invalid address and keeps a valid one on the device", async () => {
    renderRouter("./app", { initialUrl: "/settings" });

    const field = await screen.findByLabelText("Pages server address");

    fireEvent.changeText(field, "ftp://pages.example.com");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This is not a valid address."),
    ).toBeTruthy();
    expect(await storedSettings()).toBeNull();
    // Nothing is saved yet, so there is nothing to remove.
    expect(screen.queryByRole("button", { name: "Remove address" })).toBeNull();

    fireEvent.changeText(field, "pages.example.com/");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.queryByText("This is not a valid address.")).toBeNull(),
    );
    expect(await storedSettings()).toMatchObject({
      serverUrl: "https://pages.example.com",
    });
    expect(field.props.value).toBe("https://pages.example.com");
    await waitFor(() =>
      expect(screen.getAllByText("Connected").length).toBeGreaterThan(0),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://pages.example.com/health",
      expect.anything(),
    );
  });

  it("removes the address again", async () => {
    await AsyncStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ serverUrl: "https://pages.example.com" }),
    );
    renderRouter("./app", { initialUrl: "/settings" });

    fireEvent.press(
      await screen.findByRole("button", { name: "Remove address" }),
    );

    await waitFor(() =>
      expect(screen.getAllByText("No server").length).toBeGreaterThan(0),
    );
    expect(await storedSettings()).toMatchObject({ serverUrl: null });
  });

  it("applies the stored theme and language from the first frame", async () => {
    await AsyncStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ theme: "dark", language: "de" }),
    );
    const setColorScheme = jest.spyOn(Appearance, "setColorScheme");

    renderRouter("./app", { initialUrl: "/" });

    expect(await screen.findByText("Noch keine Unterhaltung")).toBeTruthy();
    expect(setColorScheme).toHaveBeenCalledWith("dark");
  });

  it("switches language and theme from the settings", async () => {
    const setColorScheme = jest.spyOn(Appearance, "setColorScheme");

    renderRouter("./app", { initialUrl: "/settings" });

    fireEvent.press(await screen.findByRole("radio", { name: "Deutsch" }));

    expect(await screen.findByText("Adresse des Pages-Servers")).toBeTruthy();
    expect(await storedSettings()).toMatchObject({ language: "de" });

    fireEvent.press(screen.getByRole("radio", { name: "Dunkel" }));

    await waitFor(() =>
      expect(setColorScheme).toHaveBeenLastCalledWith("dark"),
    );
    expect(await storedSettings()).toMatchObject({ theme: "dark" });
  });

  it("shows a way back for an unknown address", async () => {
    renderRouter("./app", { initialUrl: "/does-not-exist" });

    expect(await screen.findByText("This screen does not exist.")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Back to Pica" }));

    expect(await screen.findByText("No conversation yet")).toBeTruthy();
  });
});
