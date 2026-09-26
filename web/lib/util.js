/* Small pieces of Python behaviour the ports rely on to give identical output. */

/* Python's round(): halves go to the even neighbour, so round(12.5) == 12.
 * Math.round would say 13, and "1 of 8" would read 13% on the web and 12% on
 * the desktop. */
export function roundHalfEven(v, digits = 0) {
  const m = 10 ** digits;
  const x = v * m;
  const f = Math.floor(x);
  const d = x - f;
  const r = d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
  return r / m;
}

/* f"{x:.0%}" */
export const pct0 = (x) => `${roundHalfEven(x * 100)}%`;

/* f"{x:.0f}" */
export const fixed0 = (x) => `${roundHalfEven(x)}`;

/* Sort by a key returning an array, compared element by element like a
 * Python tuple. Stable, as Python's sort is. */
export function sortByKey(list, key) {
  const cmp = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      if (a[i] === undefined) return -1;
      if (b[i] === undefined) return 1;
      return a[i] < b[i] ? -1 : 1;
    }
    return 0;
  };
  return list
    .map((item, i) => [key(item), i, item])
    .sort((x, y) => cmp(x[0], y[0]) || x[1] - y[1])
    .map((x) => x[2]);
}
