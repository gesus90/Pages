import type { Translations } from "../translations";

/** Deutsche Texte; sie müssen alle Schlüssel der englischen Texte enthalten. */
export const de: Translations = {
  tabs: {
    pica: "Pica",
    settings: "Einstellungen",
  },
  connection: {
    status: {
      unconfigured: "Kein Server",
      offline: "Offline",
      checking: "Prüfung läuft",
      connected: "Verbunden",
      setupPending: "Einrichtung offen",
      unreachable: "Nicht erreichbar",
      serverError: "Serverfehler",
      notPages: "Kein Pages-Server",
    },
    detail: {
      unconfigured: "Trage die Adresse deines Pages-Servers ein.",
      offline: "Dieses Gerät hat keine Netzwerkverbindung.",
      checking: "{{host}} wird kontaktiert.",
      connected: "{{host}} antwortet.",
      setupPending:
        "{{host}} antwortet, aber die Einrichtung von Pages ist noch nicht abgeschlossen.",
      unreachable:
        "{{host}} hat nicht geantwortet. Prüfe die Adresse und das Netzwerk.",
      serverError: "{{host}} meldet, dass Pages gerade nicht verfügbar ist.",
      notPages:
        "{{host}} antwortet, sieht aber nicht wie ein Pages-Server aus.",
    },
  },
  pica: {
    emptyTitle: "Noch keine Unterhaltung",
    emptyBody:
      "Unterhaltungen mit Pica von deinem Pages-Server erscheinen hier.",
    notAvailable:
      "Mit Pica zu chatten ist in dieser Version der App noch nicht enthalten.",
    setUpServer: "Server einrichten",
  },
  settings: {
    connectionTitle: "Server",
    serverAddress: "Adresse des Pages-Servers",
    serverAddressHint: "Zum Beispiel https://pages.example.com",
    serverAddressPlaceholder: "https://pages.example.com",
    save: "Speichern",
    remove: "Adresse entfernen",
    checkConnection: "Verbindung prüfen",
    lastChecked: "Zuletzt geprüft: {{time}}",
    addressErrors: {
      empty: "Gib eine Adresse ein.",
      invalid: "Das ist keine gültige Adresse.",
      insecure: "Verwende eine Adresse, die mit https:// beginnt.",
      credentials: "Lass Benutzername und Passwort aus der Adresse weg.",
      extras: "Lass Abfrage und Fragment aus der Adresse weg.",
    },
    appearanceTitle: "Darstellung",
    theme: "Design",
    themeOptions: {
      system: "Gerät",
      light: "Hell",
      dark: "Dunkel",
    },
    language: "Sprache",
    languageOptions: {
      system: "Gerät",
      de: "Deutsch",
      en: "English",
    },
    aboutTitle: "Über",
    aboutBody:
      "Pica Mobile ist die native App für Pica auf deinem Pages-Server.",
    version: "Version {{version}}",
  },
  notFound: {
    title: "Seite nicht gefunden",
    body: "Diese Ansicht gibt es nicht.",
    back: "Zurück zu Pica",
  },
};
