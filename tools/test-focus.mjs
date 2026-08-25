#!/usr/bin/env node
/**
 * Spatial-navigation tests.
 *
 * The focus engine's geometry is the single most important behaviour in a TV
 * interface: if "down" drifts sideways, or the end of a shelf silently jumps to
 * another row, the product is unusable and no amount of visual polish saves it.
 *
 * `chooseCandidate` is deliberately DOM-free so these cases can be checked
 * directly, with layouts taken from the real screens in this app.
 *
 * Usage:  node tools/test-focus.mjs
 */

import { chooseCandidate, makeBox } from '../src/focus/engine.ts';

let failures = 0;

function box(id, x, y, w, h) {
  return { id, box: makeBox(x, y, w, h) };
}

function expect(label, from, candidates, dir, expectedId) {
  const winner = chooseCandidate(from.box, candidates.filter((c) => c.id !== from.id), dir);
  const got = winner ? winner.id : null;
  const ok = got === expectedId;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expectedId)}, got ${JSON.stringify(got)}`);
    failures++;
  }
}

/* ---------------------------------------------------------------------- *
 * A shelf: five 200x300 posters in a row, 24px apart.
 * ---------------------------------------------------------------------- */
console.log('\nA horizontal shelf');
const shelf = [
  box('p0', 100, 200, 200, 300),
  box('p1', 324, 200, 200, 300),
  box('p2', 548, 200, 200, 300),
  box('p3', 772, 200, 200, 300),
  box('p4', 996, 200, 200, 300),
];
expect('right moves to the immediate neighbour', shelf[0], shelf, 'right', 'p1');
expect('right from the middle does not skip ahead', shelf[2], shelf, 'right', 'p3');
expect('left moves back one', shelf[3], shelf, 'left', 'p2');
expect('right at the end of the shelf finds nothing', shelf[4], shelf, 'right', null);
expect('left at the start of the shelf finds nothing', shelf[0], shelf, 'left', null);
expect('up from a lone shelf finds nothing', shelf[2], shelf, 'up', null);

/* ---------------------------------------------------------------------- *
 * Two stacked shelves. Moving down must keep its column, not snap to the
 * first item of the next row — the mistake that makes DOM-order navigation
 * feel broken.
 * ---------------------------------------------------------------------- */
console.log('\nTwo stacked shelves');
const rowA = [
  box('a0', 100, 200, 200, 300),
  box('a1', 324, 200, 200, 300),
  box('a2', 548, 200, 200, 300),
];
const rowB = [
  box('b0', 100, 560, 200, 300),
  box('b1', 324, 560, 200, 300),
  box('b2', 548, 560, 200, 300),
];
const twoRows = [...rowA, ...rowB];
expect('down holds the column (left)', rowA[0], twoRows, 'down', 'b0');
expect('down holds the column (middle)', rowA[1], twoRows, 'down', 'b1');
expect('down holds the column (right)', rowA[2], twoRows, 'down', 'b2');
expect('up holds the column', rowB[1], twoRows, 'up', 'a1');
expect('down from the bottom row finds nothing', rowB[1], twoRows, 'down', null);

/* ---------------------------------------------------------------------- *
 * Misaligned rows: the row below is offset, as happens when a shelf is
 * mid-scroll. The nearest column must win, not the nearest DOM sibling.
 * ---------------------------------------------------------------------- */
console.log('\nMisaligned rows (a shelf caught mid-scroll)');
const offsetRows = [
  box('t0', 100, 200, 200, 300),
  box('t1', 324, 200, 200, 300),
  box('o0', 40, 560, 200, 300),
  box('o1', 264, 560, 200, 300),
  box('o2', 488, 560, 200, 300),
];
expect('down picks the most-overlapping tile', offsetRows[0], offsetRows, 'down', 'o0');
expect('down from the second tile picks its overlap', offsetRows[1], offsetRows, 'down', 'o1');

/* ---------------------------------------------------------------------- *
 * A wrapping grid, as used by the folder browser.
 * ---------------------------------------------------------------------- */
console.log('\nA wrapping grid (4 columns)');
const grid = [];
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 4; c++) {
    grid.push(box(`g${r}${c}`, 100 + c * 250, 200 + r * 380, 220, 330));
  }
}
const at = (r, c) => grid.find((g) => g.id === `g${r}${c}`);
expect('right within a grid row', at(1, 1), grid, 'right', 'g12');
expect('down within a grid column', at(1, 1), grid, 'down', 'g21');
expect('up within a grid column', at(1, 1), grid, 'up', 'g01');
expect('right at the row edge does not wrap to the next row', at(1, 3), grid, 'right', null);
expect('left at the row edge does not wrap to the previous row', at(1, 0), grid, 'left', null);
expect('down from the last row finds nothing', at(2, 2), grid, 'down', null);

/* ---------------------------------------------------------------------- *
 * The real Home screen layout: a nav bar, a hero with two buttons, then
 * shelves. Crossing between these bands is where naive engines fail.
 * ---------------------------------------------------------------------- */
console.log('\nHome screen bands: tabs -> hero -> shelf');
const home = [
  box('tabHome', 700, 40, 120, 48),
  box('tabSearch', 828, 40, 130, 48),
  box('tabSettings', 966, 40, 140, 48),
  box('heroResume', 120, 300, 180, 56),
  box('heroBrowse', 312, 300, 220, 56),
  box('tile0', 100, 460, 200, 300),
  box('tile1', 324, 460, 200, 300),
];
const find = (id) => home.find((h) => h.id === id);
expect('down from a tab reaches the hero', find('tabHome'), home, 'down', 'heroBrowse');
expect('down from the hero reaches the shelf', find('heroResume'), home, 'down', 'tile0');
expect('up from the shelf returns to the hero', find('tile0'), home, 'up', 'heroResume');
expect('right across hero buttons', find('heroResume'), home, 'right', 'heroBrowse');
// The hero sits far left (centre x=422) while the tab bar is centred, so the
// nearest tab is Home (centre x=760) — not Search (893). Verified by hand:
// Home scores 212 + 168*5 + 338*0.4 = 1187, Search 212 + 296*5 + 471*0.4 = 1880.
// In the running app the tab group also has focus memory, so returning upward
// lands on whichever tab you last used.
expect('up from the hero reaches the nearest tab', find('heroBrowse'), home, 'up', 'tabHome');

/* ---------------------------------------------------------------------- *
 * A settings list: full-width rows. Left/right must do nothing so the
 * engine produces the rubber-band bump instead of a surprise jump.
 * ---------------------------------------------------------------------- */
console.log('\nA full-width settings list');
const rows = [
  box('r0', 100, 200, 1400, 70),
  box('r1', 100, 278, 1400, 70),
  box('r2', 100, 356, 1400, 70),
];
expect('down through a list', rows[0], rows, 'down', 'r1');
expect('up through a list', rows[2], rows, 'up', 'r1');
expect('right in a list does nothing', rows[1], rows, 'right', null);
expect('left in a list does nothing', rows[1], rows, 'left', null);

/* ---------------------------------------------------------------------- *
 * The on-screen keyboard: a dense 10-column grid, the hardest case,
 * because every key is close to every other key.
 * ---------------------------------------------------------------------- */
console.log('\nOn-screen keyboard (10 x 4 dense grid)');
const keys = [];
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 10; c++) {
    keys.push(box(`k${r}_${c}`, 200 + c * 68, 400 + r * 68, 60, 60));
  }
}
const key = (r, c) => keys.find((k) => k.id === `k${r}_${c}`);
expect('keyboard: right', key(1, 4), keys, 'right', 'k1_5');
expect('keyboard: left', key(1, 4), keys, 'left', 'k1_3');
expect('keyboard: down stays in column', key(1, 4), keys, 'down', 'k2_4');
expect('keyboard: up stays in column', key(1, 4), keys, 'up', 'k0_4');
expect('keyboard: right edge stops', key(2, 9), keys, 'right', null);
expect('keyboard: bottom edge stops', key(3, 5), keys, 'down', null);

console.log(
  `\n${failures === 0 ? 'All spatial-navigation checks passed.' : `${failures} check(s) failed.`}`,
);
process.exit(failures === 0 ? 0 : 1);
