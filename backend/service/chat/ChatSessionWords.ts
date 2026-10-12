import { randomInt } from "node:crypto";

/** Number of words in a session ID (T6.12.2). */
const SESSION_ID_WORDS = 5;

/**
 * Fixed list of short, neutral words without umlauts, so an ID is easy to say,
 * type and remember. Its size gives about 10^13 combinations.
 */
export const CHAT_SESSION_WORDS: readonly string[] = `
  abend acker adler ahorn akte alpen ampel anker apfel arena atlas auge auto
  bach bahn ball band bank basis bast baum beere berg besen beton biber birne
  blatt blick blitz block blume boden bogen bohne boje boot bord brief brille
  brot brunnen buch bucht bude burg busch butter chor dach dachs damm dampf
  decke deich delta docht dose draht drache duft echo ecke efeu eiche eimer
  elch ente erbse erde esche eule fabel faden fahne falke farbe farn feder
  feld fels fenster fest fichte film fink fisch flagge flamme flasche flocke
  floss flur fluss fohlen form forst foto frosch frucht funke gabel garten
  geige gipfel glas glocke glut gold graben gras grat grund gurke hafen hafer
  hagel hahn haken halle hammer hand harfe hase haus hecht hecke heft heide
  helm hemd herd herz himmel hirsch hof holz honig horn hummel igel insel
  jacke jade jahr kabel kaffee kahn kakao kamel kamm kanal kanne kante kappe
  karte kasten kater katze kegel keks kerze kette kiefer kiesel kino kirsche
  kiste kiwi klang klee knopf koffer kohl komet kompass korb korn kran
  kranich kraut kreis krone krug kuchen kugel kurs lachs lager lampe land
  laterne laub lava leder leiter lerche licht lied lilie linde linie linse
  lotse lupe luchs luft mais mantel mappe markt marmor maske mast mauer maus
  meer mehl meise melone mond moos motor muschel muster nadel nagel nebel
  nelke nest netz nudel nuss oase ofen olive orgel ozean paket palme papier
  park pfad pfanne pfeil pferd pflaume pilz pinsel platz pol post puls pulver
  punkt quelle rabe rad rahmen rakete rampe rand raum regal regen reh reif
  reis ring rinde rolle rose rubin ruder sack saft salat salz samen sand
  sattel schaf schal schiff schild schuh see segel seil sessel sieb silber
  sofa sonne spaten spiegel stadt stall stamm stein stern stiefel strand
  strauch strom stuhl sturm suppe tafel tal tanne tasse taube teich teller
  tempel theke tiger tinte tisch tomate ton topf tor torte traube treppe tuch
  tulpe turm ufer uhr ulme vase vogel waage wabe wachs wagen wald wal walze
  wand wanne wasser watt weg weide wein weizen welle welt werft wiese wind
  winkel wolke wolle wurzel zange zapfen zaun zebra zelt zeder ziegel zimt
  zinn zitrone zucker zug zweig zwiebel achse alge allee angel arche aster
  atem bambus barke beet birke blei bluse dattel daune dorf dorn dotter
  drossel eibe enzian erker espe fackel fasan fliese flosse gerste gitter
  glanz globus gondel granit grille hanf hasel hering hobel hupe iris jaspis
  joghurt juwel kajak kalk kamin kapsel karpfen kelch kerbe kies kissen
  klinke knospe kobalt koje kolben koralle kresse krokus kupfer lack lasso
  lauch leine lehm lorbeer magnet malve mandel marder matte minze mohn mosaik
  muskat narzisse nickel nougat obst orange otter pappel perle pinie planet
  pollen pony posaune quarz quitte radar raupe rettich robbe roggen rosine
  safran salbei sandale schnee senf sirup skizze socke sonde spinat stempel
  storch talg tapete tau teer thymian tonne trommel tukan tunnel veilchen
  waffel walnuss weiher wimpel wirbel zirkus zobel zinke
`
  .trim()
  .split(/\s+/u);

/**
 * Draws a session ID of five random words, for example `haus-block-rabe-zelt-baum`.
 *
 * @param pick - Returns a random index below the given bound; cryptographic by default.
 * @returns Five words joined by hyphens.
 */
export function createChatSessionId(
  pick: (bound: number) => number = randomInt,
): string {
  return Array.from(
    { length: SESSION_ID_WORDS },
    () => CHAT_SESSION_WORDS[pick(CHAT_SESSION_WORDS.length)],
  ).join("-");
}
