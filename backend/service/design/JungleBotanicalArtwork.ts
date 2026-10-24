/**
 * Original vector geometry for the shipped botanical material.
 * The illustration is generated locally; it uses no external image or script.
 */
const LEAF_SHAPES = `
  <defs>
    <g id="split-leaf">
      <path d="M0 120C-30 110-76 80-70 45L-24 66-68 26Q-66 5-50-8L-18 33-38-24Q-20-38-7-30L2 18 14-35Q38-34 48-16L20 31 66-3Q80 12 76 33L30 60 78 45Q77 70 61 82L22 88 51 100Q28 121 0 120Z" fill="currentColor"/>
      <path d="M0 116 7-20M3 89-46 48M4 62 54 24M5 37-19-6" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="2"/>
    </g>
    <g id="frond">
      <path d="M0 150Q-8 72 3-10" fill="none" stroke="currentColor" stroke-width="3"/>
      ${Array.from({ length: 8 }, (_, index) => {
        const height = index * 17;
        const spread = 27 + index * 5;

        return `<path d="M 0 ${height + 21} Q ${-spread} ${height + 7} ${-spread} ${height - 12} Q ${14 - spread} ${height - 24} 1 ${height + 5} Z M 0 ${height + 21} Q ${spread} ${height + 7} ${spread} ${height - 12} Q ${spread - 14} ${height - 24} -1 ${height + 5} Z" fill="currentColor"/>`;
      }).join("")}
    </g>
    <g id="bloom">
      <path d="M0 63 6 0" fill="none" stroke="#568465" stroke-width="3"/>
      <path d="M6 8-12-13 7-3 17-29 19-1 36-12 23 14Z" fill="#dcae51"/>
      <path d="M6 8 17-29 13 3 36-12 23 14Z" fill="#df8b4b"/>
    </g>
  </defs>`;

function imageUrl(viewBox: string, shapes: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${LEAF_SHAPES}${shapes}</svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Edge foliage; subdued enough to keep navigation readable throughout. */
export const BOTANICAL_NAVIGATION_TEXTURE = imageUrl(
  "0 0 224 1080",
  `<g opacity=".65">
    <use href="#frond" transform="translate(-23 670) rotate(-23) scale(.95)" color="#28745e"/>
    <use href="#split-leaf" transform="translate(-8 795) rotate(-24) scale(.85)" color="#28715a"/>
    <use href="#split-leaf" transform="translate(-20 902) rotate(32) scale(.78)" color="#4b8058"/>
    <use href="#split-leaf" transform="translate(246 696) rotate(-25) scale(.77)" color="#246956"/>
    <use href="#frond" transform="translate(243 844) rotate(27) scale(.85)" color="#327157"/>
    <use href="#bloom" transform="translate(6 831) scale(.7)"/>
    <use href="#bloom" transform="translate(221 968) rotate(-23) scale(.6)"/>
    <use href="#frond" transform="translate(-42 969) rotate(-18) scale(.87)" color="#64894f"/>
    <use href="#split-leaf" transform="translate(260 466) rotate(-32) scale(.6)" color="#225c4b"/>
  </g>`,
);

/** Tropical silhouettes confined to the outer corners of the auth stage. */
export const BOTANICAL_AUTH_CORNER = imageUrl(
  "0 0 480 350",
  `<use href="#frond" transform="translate(120 35) rotate(62) scale(1.1)" color="#2d8068"/>
   <use href="#split-leaf" transform="translate(278 30) rotate(48) scale(1.05)" color="#146153"/>
   <use href="#split-leaf" transform="translate(445 155) rotate(100) scale(.9)" color="#367c58"/>
   <use href="#frond" transform="translate(415 35) rotate(24) scale(.85)" color="#76a56b"/>
   <use href="#bloom" transform="translate(350 60) rotate(24) scale(.85)"/>`,
);

/** Lower corner, drawn separately so it never repeats across content. */
export const BOTANICAL_AUTH_LOWER_CORNER = imageUrl(
  "0 0 480 600",
  `<use href="#frond" transform="translate(4 370) rotate(-18) scale(1.15)" color="#397d5b"/>
   <use href="#split-leaf" transform="translate(10 462) rotate(30) scale(.95)" color="#1f6a55"/>
   <use href="#frond" transform="translate(-24 520) rotate(-27) scale(1.05)" color="#7da367"/>
   <use href="#bloom" transform="translate(40 465) rotate(-10) scale(.8)"/>`,
);
