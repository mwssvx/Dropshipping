// Barcodes. Each option can carry the barcode printed on it (a UPC or EAN from the maker, or the
// store's own code). Labels print the barcode, or the SKU when there's none, as Code 128, which
// any scanner reads and which holds letters as well as digits. A scanner types the code like a
// keyboard, so scanning on the stock count page finds the option by its barcode or SKU.

export const BARCODE_MAX = 48;
/** The most labels one option prints at once. */
export const MAX_LABELS = 200;

/** A barcode as it's kept: trimmed, printable ASCII only. Empty is null. */
export function parseBarcode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim();
  if (!code) return null;
  if (code.length > BARCODE_MAX || !/^[\x20-\x7e]+$/.test(code)) throw new BarcodeError();
  return code;
}

export class BarcodeError extends Error {
  constructor() {
    super(`A barcode is up to ${BARCODE_MAX} letters, digits or symbols, like 012345678905.`);
  }
}

// Bar and space widths of each Code 128 symbol, in modules: bar, space, bar, space, bar, space.
// 0–102 are values, 103–105 the start codes (A, B, C), 106 the stop (which has one bar more).
export const CODE128 = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 " +
  "232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 " +
  "313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 " +
  "111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 " +
  "114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/**
 * The Code 128 symbol values for a code, with start, check and stop. Runs of digits use code set
 * C (two digits a symbol) so long numbers stay short enough to scan; everything else uses B.
 */
export function code128Values(code: string): number[] {
  if (!code || !/^[\x20-\x7e]+$/.test(code)) throw new BarcodeError();
  const values: number[] = [];
  let set: "B" | "C" | null = null;
  let i = 0;
  const digitsAt = (at: number) => /^\d*/.exec(code.slice(at))![0].length;
  while (i < code.length) {
    const run = digitsAt(i);
    // Set C pays off for 4 or more digits (or a code that's all digits, in an even count).
    const useC = run >= 4 || (i === 0 && run === code.length && run % 2 === 0 && run >= 2);
    if (useC) {
      if (set !== "C") values.push(set === null ? START_C : CODE_C);
      set = "C";
      const pairs = Math.floor(run / 2);
      for (let p = 0; p < pairs; p++, i += 2) values.push(Number(code.slice(i, i + 2)));
      continue;
    }
    if (set !== "B") values.push(set === null ? START_B : CODE_B);
    set = "B";
    // In B, take characters up to the next run worth switching to C for.
    do {
      values.push(code.charCodeAt(i) - 32);
      i++;
    } while (i < code.length && digitsAt(i) < 4);
  }
  const check = values.reduce((sum, v, k) => sum + v * Math.max(k, 1), 0) % 103;
  return [...values, check, STOP];
}

/** The barcode's bars as [x, width] in modules, with the total width (quiet zones included). */
export function code128Bars(code: string, quiet = 10) {
  const bars: [number, number][] = [];
  let x = quiet;
  for (const v of code128Values(code)) {
    const widths = CODE128[v]!;
    for (let k = 0; k < widths.length; k++) {
      const w = Number(widths[k]);
      if (k % 2 === 0) bars.push([x, w]);
      x += w;
    }
  }
  return { bars, width: x + quiet };
}
