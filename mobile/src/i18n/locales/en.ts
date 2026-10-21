/** English texts; they define the keys every other language must provide. */
export const en = {
  tabs: {
    pica: "Pica",
    settings: "Settings",
  },
  connection: {
    status: {
      unconfigured: "No server",
      offline: "Offline",
      checking: "Checking",
      connected: "Connected",
      setupPending: "Setup pending",
      unreachable: "Not reachable",
      serverError: "Server error",
      notPages: "Not a Pages server",
    },
    detail: {
      unconfigured: "Enter the address of your Pages server.",
      offline: "This device has no network connection.",
      checking: "Contacting {{host}}.",
      connected: "{{host}} answers.",
      setupPending:
        "{{host}} answers, but the Pages setup is not finished yet.",
      unreachable:
        "{{host}} did not answer. Check the address and the network.",
      serverError: "{{host}} reports that Pages is currently unavailable.",
      notPages: "{{host}} answers, but it does not look like a Pages server.",
    },
  },
  pica: {
    emptyTitle: "No conversation yet",
    emptyBody:
      "Conversations with Pica from your Pages server will appear here.",
    notAvailable:
      "Chatting with Pica is not part of this version of the app yet.",
    setUpServer: "Set up server",
  },
  settings: {
    connectionTitle: "Server",
    serverAddress: "Pages server address",
    serverAddressHint: "For example https://pages.example.com",
    serverAddressPlaceholder: "https://pages.example.com",
    save: "Save",
    remove: "Remove address",
    checkConnection: "Check connection",
    lastChecked: "Last checked: {{time}}",
    addressErrors: {
      empty: "Enter an address.",
      invalid: "This is not a valid address.",
      insecure: "Use an address that starts with https://.",
      credentials: "Leave the user name and password out of the address.",
      extras: "Leave the query and the fragment out of the address.",
    },
    appearanceTitle: "Appearance",
    theme: "Theme",
    themeOptions: {
      system: "Device",
      light: "Light",
      dark: "Dark",
    },
    language: "Language",
    languageOptions: {
      system: "Device",
      de: "Deutsch",
      en: "English",
    },
    aboutTitle: "About",
    aboutBody: "Pica Mobile is the native app for Pica on your Pages server.",
    version: "Version {{version}}",
  },
  notFound: {
    title: "Page not found",
    body: "This screen does not exist.",
    back: "Back to Pica",
  },
} as const;
