/** Groups of the emoji picker, in the order the picker shows them. */
export const EMOJI_CATEGORIES = [
  "smileys",
  "people",
  "nature",
  "food",
  "activities",
  "travel",
  "objects",
  "symbols",
] as const;

/** A group of the emoji picker. */
export type EmojiCategory = (typeof EMOJI_CATEGORIES)[number];

/** An emoji with the words it is found by, in English and German. */
export interface EmojiEntry {
  readonly emoji: string;
  readonly category: EmojiCategory;
  readonly keywords: string;
}

// Each line: emoji, then search words in English and German. The emoji are
// data, not interface text, so the words of both languages stay together.
const CATALOG: Readonly<
  Record<EmojiCategory, readonly (readonly [string, string])[]>
> = {
  activities: [
    ["🎉", "party celebrate tada feier party konfetti"],
    ["🎊", "confetti celebration konfetti feier"],
    ["🎈", "balloon ballon"],
    ["🎁", "gift present geschenk"],
    ["🏆", "trophy win pokal sieg"],
    ["🥇", "gold medal first goldmedaille erster"],
    ["⚽", "soccer football fussball"],
    ["🏀", "basketball"],
    ["🎮", "game controller spiel"],
    ["🎲", "dice game würfel"],
    ["🎯", "target goal bullseye ziel zielscheibe"],
    ["🎨", "art palette kunst farbe"],
    ["🎵", "music note musik"],
    ["🎬", "film movie clapper film kino"],
    ["🧩", "puzzle piece puzzle teil"],
  ],
  food: [
    ["☕", "coffee kaffee"],
    ["🍵", "tea tee"],
    ["🍺", "beer bier"],
    ["🍕", "pizza"],
    ["🍔", "burger"],
    ["🍎", "apple apfel"],
    ["🍌", "banana banane"],
    ["🍓", "strawberry erdbeere"],
    ["🥐", "croissant"],
    ["🍰", "cake kuchen"],
    ["🍪", "cookie keks"],
    ["🥗", "salad salat"],
  ],
  nature: [
    ["🌱", "seedling grow sprout keimling wachsen"],
    ["🌳", "tree baum"],
    ["🌲", "evergreen tree tanne"],
    ["🌵", "cactus kaktus"],
    ["🌸", "blossom flower blüte blume"],
    ["🌻", "sunflower sonnenblume"],
    ["🍀", "clover luck kleeblatt glück"],
    ["🍁", "maple leaf autumn ahorn herbst"],
    ["🌍", "earth world globe erde welt"],
    ["🌙", "moon night mond nacht"],
    ["⭐", "star stern"],
    ["🌟", "glowing star leuchtender stern"],
    ["☀️", "sun sonne"],
    ["⛅", "cloud sun wolke sonne"],
    ["🌧️", "rain regen"],
    ["⚡", "lightning bolt blitz energie"],
    ["❄️", "snowflake schneeflocke"],
    ["🔥", "fire hot feuer heiss"],
    ["💧", "drop water tropfen wasser"],
    ["🌊", "wave sea welle meer"],
    ["🐶", "dog hund"],
    ["🐱", "cat katze"],
    ["🐞", "bug ladybug käfer marienkäfer fehler"],
    ["🐛", "bug caterpillar raupe fehler"],
    ["🦊", "fox fuchs"],
    ["🐝", "bee biene"],
    ["🦉", "owl eule"],
    ["🐢", "turtle slow schildkröte langsam"],
  ],
  objects: [
    ["📘", "blue book manual buch handbuch"],
    ["📕", "red book buch"],
    ["📗", "green book buch"],
    ["📚", "books library bücher bibliothek"],
    ["📖", "open book lesen buch"],
    ["📝", "memo note write notiz schreiben"],
    ["✏️", "pencil edit bleistift bearbeiten"],
    ["🖊️", "pen stift"],
    ["📌", "pin pushpin pinnwand nadel"],
    ["📎", "paperclip attachment büroklammer anhang"],
    ["📁", "folder ordner"],
    ["📂", "open folder ordner offen"],
    ["🗂️", "dividers index register"],
    ["📅", "calendar date kalender datum"],
    ["📆", "calendar kalender"],
    ["🗓️", "spiral calendar kalender"],
    ["📊", "chart bar statistics diagramm statistik"],
    ["📈", "chart increasing growth wachstum steigend"],
    ["📉", "chart decreasing sinkend"],
    ["📋", "clipboard checklist klemmbrett liste"],
    ["📦", "package box paket"],
    ["📮", "postbox briefkasten"],
    ["✉️", "envelope mail brief"],
    ["📧", "email mail e-mail"],
    ["📞", "phone telefon"],
    ["💻", "laptop computer rechner"],
    ["🖥️", "desktop computer bildschirm"],
    ["⌨️", "keyboard tastatur"],
    ["🖱️", "mouse maus"],
    ["💾", "floppy save diskette speichern"],
    ["🔍", "search magnifier suchen lupe"],
    ["🔎", "search lupe suchen"],
    ["🔒", "lock locked schloss gesperrt"],
    ["🔓", "unlock offen entsperrt"],
    ["🔑", "key schlüssel"],
    ["🛠️", "tools werkzeug"],
    ["🔧", "wrench schraubenschlüssel"],
    ["🔨", "hammer"],
    ["⚙️", "gear settings zahnrad einstellungen"],
    ["🧪", "test tube experiment reagenzglas test"],
    ["🔬", "microscope research mikroskop forschung"],
    ["💡", "idea light bulb idee glühbirne"],
    ["🔔", "bell notification glocke benachrichtigung"],
    ["📣", "megaphone announcement megafon ankündigung"],
    ["🧭", "compass orientation kompass orientierung"],
    ["⏰", "alarm clock wecker"],
    ["⏳", "hourglass waiting sanduhr warten"],
    ["💰", "money bag geld"],
    ["💳", "credit card kreditkarte"],
    ["🧾", "receipt beleg quittung"],
    ["🏷️", "label tag etikett"],
  ],
  people: [
    ["👍", "thumbs up yes like daumen hoch ja"],
    ["👎", "thumbs down no daumen runter nein"],
    ["👏", "clap applause klatschen applaus"],
    ["🙌", "raising hands hurra hände"],
    ["🙏", "please thanks pray bitte danke"],
    ["👋", "wave hello hallo winken"],
    ["✌️", "victory peace sieg frieden"],
    ["🤝", "handshake deal handschlag"],
    ["💪", "strong muscle stark muskel"],
    ["👀", "eyes look augen schauen"],
    ["🧠", "brain think gehirn denken"],
    ["👤", "person user person benutzer"],
    ["👥", "people team leute team"],
    ["🧑‍💻", "developer coder entwickler programmierer"],
    ["🧑‍🔧", "mechanic technician techniker"],
    ["🧑‍🏫", "teacher lehrer"],
    ["🧑‍🎨", "artist künstler"],
    ["🕵️", "detective investigate detektiv untersuchen"],
  ],
  smileys: [
    ["😀", "grinning smile happy grinsen lachen fröhlich"],
    ["😃", "smiley happy fröhlich"],
    ["😄", "smile laugh lachen"],
    ["😁", "grin grinsen"],
    ["😅", "sweat smile relief erleichtert"],
    ["😂", "joy tears laugh tränen lachen"],
    ["🙂", "slight smile lächeln"],
    ["😉", "wink zwinkern"],
    ["😊", "blush happy erröten glücklich"],
    ["😍", "heart eyes love verliebt"],
    ["🤩", "star struck begeistert"],
    ["😎", "cool sunglasses sonnenbrille"],
    ["🤓", "nerd glasses streber"],
    ["🤔", "thinking hmm nachdenken"],
    ["🤨", "raised eyebrow skeptisch"],
    ["😐", "neutral"],
    ["🙄", "eye roll augenrollen"],
    ["😴", "sleeping müde schlafen"],
    ["😮", "surprised wow überrascht"],
    ["😱", "scream shock schock schreien"],
    ["😢", "cry sad weinen traurig"],
    ["😭", "sob weinen"],
    ["😡", "angry wütend"],
    ["🤯", "mind blown explodierend"],
    ["🥳", "party celebrate feiern"],
    ["😇", "angel innocent engel"],
    ["🤖", "robot bot roboter"],
    ["👻", "ghost geist"],
    ["💩", "poop kacke"],
  ],
  symbols: [
    ["✅", "check done yes erledigt haken ja"],
    ["☑️", "checkbox ballot ankreuzen"],
    ["✔️", "check mark haken"],
    ["❌", "cross no wrong nein falsch kreuz"],
    ["❓", "question frage"],
    ["❗", "exclamation important ausrufezeichen wichtig"],
    ["⚠️", "warning caution warnung vorsicht"],
    ["🚫", "prohibited forbidden verboten"],
    ["⛔", "no entry stop halt"],
    ["🔴", "red circle rot kreis"],
    ["🟠", "orange circle orange kreis"],
    ["🟡", "yellow circle gelb kreis"],
    ["🟢", "green circle grün kreis"],
    ["🔵", "blue circle blau kreis"],
    ["🟣", "purple circle lila kreis"],
    ["⚫", "black circle schwarz kreis"],
    ["⚪", "white circle weiss kreis"],
    ["❤️", "heart love herz liebe"],
    ["💙", "blue heart blaues herz"],
    ["💚", "green heart grünes herz"],
    ["🧡", "orange heart oranges herz"],
    ["💯", "hundred perfect hundert perfekt"],
    ["➕", "plus add hinzufügen"],
    ["➖", "minus remove entfernen"],
    ["➡️", "arrow right pfeil rechts"],
    ["⬅️", "arrow left pfeil links"],
    ["⬆️", "arrow up pfeil oben"],
    ["⬇️", "arrow down pfeil unten"],
    ["🔁", "repeat loop wiederholen"],
    ["🔄", "refresh sync aktualisieren"],
    ["♻️", "recycle recycling"],
    ["ℹ️", "information info hinweis"],
    ["🆕", "new neu"],
    ["🆗", "ok okay"],
    ["🔖", "bookmark lesezeichen"],
    ["💬", "speech bubble chat comment sprechblase kommentar"],
    ["💭", "thought bubble gedanke"],
    ["🗨️", "speech sprechblase"],
  ],
  travel: [
    ["🚀", "rocket launch rakete start"],
    ["✈️", "airplane flight flugzeug flug"],
    ["🚗", "car auto"],
    ["🚲", "bicycle fahrrad"],
    ["🚧", "construction baustelle"],
    ["🏁", "finish flag ziel flagge"],
    ["🚩", "red flag warning rote flagge"],
    ["🏠", "house home haus zuhause"],
    ["🏢", "office building büro gebäude"],
    ["🏭", "factory fabrik"],
    ["🏗️", "building construction bau"],
    ["🗺️", "map karte"],
    ["📍", "location pin ort standort"],
    ["🌐", "globe internet web netz"],
    ["⛺", "tent camping zelt"],
    ["🏝️", "island vacation insel urlaub"],
  ],
};

/** Every emoji of the picker, grouped by category in picker order. */
export const EMOJI_ENTRIES: readonly EmojiEntry[] = EMOJI_CATEGORIES.flatMap(
  (category) =>
    CATALOG[category].map(([emoji, keywords]) => ({
      category,
      emoji,
      keywords,
    })),
);

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Finds emoji by search words.
 *
 * @param query - What the person typed; every word must match.
 * @param limit - Largest number of results.
 * @returns Matching emoji in picker order; all emoji for an empty query.
 */
export function searchEmoji(
  query: string,
  limit: number = EMOJI_ENTRIES.length,
): EmojiEntry[] {
  const words = fold(query)
    .split(/\s+/)
    .filter((word) => word !== "");

  return EMOJI_ENTRIES.filter((entry) => {
    const keywords = fold(entry.keywords);

    return words.every((word) => keywords.includes(word));
  }).slice(0, limit);
}
