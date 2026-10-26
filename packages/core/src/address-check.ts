// Checks a delivery address before the order is paid. A postal code in the wrong shape, or a US
// order without a state, is the usual reason a supplier's parcel comes back, and by then the
// merchant has paid for it. So checkout asks the buyer to fix it while they're still there, and
// tidies what it can ("sw1a1aa" → "SW1A 1AA", "Texas" → "TX"). Countries not listed here are
// taken as typed.
import type { Address } from "@sf/db";

type Format = { re: RegExp; example: string; tidy?: (compact: string) => string };

const digits = (n: number, example: string): Format => ({ re: new RegExp(`^\\d{${n}}$`), example });
const split = (at: number, sep: string) => (c: string) => `${c.slice(0, at)}${sep}${c.slice(at)}`;

// Matched against the code with spaces and dashes taken out and letters in capitals.
const FORMATS: Record<string, Format> = {
  US: { re: /^\d{5}(\d{4})?$/, example: "78701", tidy: (c) => (c.length === 9 ? split(5, "-")(c) : c) },
  CA: { re: /^[ABCEGHJ-NPRSTVXY]\d[A-Z]\d[A-Z]\d$/, example: "K1A 0B1", tidy: split(3, " ") },
  GB: { re: /^([A-Z]{1,2}\d[A-Z\d]?|GIR)\d[A-Z]{2}$/, example: "SW1A 1AA", tidy: (c) => split(c.length - 3, " ")(c) },
  IE: { re: /^[AC-FHKNPRTV-Y]\d[\dW][AC-FHKNPRTV-Y\d]{4}$/, example: "D02 X285", tidy: split(3, " ") },
  NL: { re: /^[1-9]\d{3}[A-Z]{2}$/, example: "1012 AB", tidy: split(4, " ") },
  PL: { re: /^\d{5}$/, example: "00-950", tidy: split(2, "-") },
  PT: { re: /^\d{7}$/, example: "1000-001", tidy: split(4, "-") },
  CZ: { re: /^\d{5}$/, example: "110 00", tidy: split(3, " ") },
  SK: { re: /^\d{5}$/, example: "811 01", tidy: split(3, " ") },
  SE: { re: /^\d{5}$/, example: "111 22", tidy: split(3, " ") },
  GR: { re: /^\d{5}$/, example: "105 57", tidy: split(3, " ") },
  MT: { re: /^[A-Z]{3}\d{4}$/, example: "VLT 1117", tidy: split(3, " ") },
  LV: { re: /^(LV)?\d{4}$/, example: "LV-1050", tidy: (c) => `LV-${c.replace(/^LV/, "")}` },
  LT: { re: /^(LT)?\d{5}$/, example: "LT-01100", tidy: (c) => `LT-${c.replace(/^LT/, "")}` },
  JP: { re: /^\d{7}$/, example: "100-0001", tidy: split(3, "-") },
  DE: digits(5, "10115"),
  FR: digits(5, "75001"),
  IT: digits(5, "00184"),
  ES: digits(5, "28001"),
  FI: digits(5, "00100"),
  HR: digits(5, "10000"),
  EE: digits(5, "10111"),
  MX: digits(5, "06000"),
  KR: digits(5, "03187"),
  AT: digits(4, "1010"),
  BE: digits(4, "1000"),
  BG: digits(4, "1000"),
  CY: digits(4, "1010"),
  DK: digits(4, "1050"),
  HU: digits(4, "1051"),
  LU: { re: /^(L)?\d{4}$/, example: "1009", tidy: (c) => c.replace(/^L/, "") },
  SI: { re: /^(SI)?\d{4}$/, example: "1000", tidy: (c) => c.replace(/^SI/, "") },
  CH: digits(4, "8001"),
  NO: digits(4, "0150"),
  AU: digits(4, "2000"),
  NZ: digits(4, "6011"),
  RO: digits(6, "010011"),
  SG: digits(6, "018956"),
  IS: digits(3, "101"),
  IL: digits(7, "6100000"),
};

const COUNTRY_NAMES: Record<string, string> = {
  US: "the United States", CA: "Canada", GB: "the United Kingdom", IE: "Ireland", NL: "the Netherlands", PL: "Poland", PT: "Portugal",
  CZ: "Czechia", SK: "Slovakia", SE: "Sweden", GR: "Greece", MT: "Malta", LV: "Latvia", LT: "Lithuania", JP: "Japan", DE: "Germany",
  FR: "France", IT: "Italy", ES: "Spain", FI: "Finland", HR: "Croatia", EE: "Estonia", MX: "Mexico", KR: "South Korea", AT: "Austria",
  BE: "Belgium", BG: "Bulgaria", CY: "Cyprus", DK: "Denmark", HU: "Hungary", LU: "Luxembourg", SI: "Slovenia", CH: "Switzerland",
  NO: "Norway", AU: "Australia", NZ: "New Zealand", RO: "Romania", SG: "Singapore", IS: "Iceland", IL: "Israel",
};

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  // Territories and military mail.
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
  AA: "Armed Forces Americas", AE: "Armed Forces Europe", AP: "Armed Forces Pacific",
};

const CA_PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia",
  NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};

const REGIONS: Record<string, { list: Record<string, string>; word: string; example: string }> = {
  US: { list: US_STATES, word: "state", example: "TX or Texas" },
  CA: { list: CA_PROVINCES, word: "province", example: "ON or Ontario" },
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** The region as its two-letter code, or null when it isn't one of the country's. */
function regionCode(list: Record<string, string>, input: string) {
  const upper = input.trim().toUpperCase().replace(/\./g, "");
  if (list[upper]) return upper;
  const folded = fold(input);
  return Object.entries(list).find(([, name]) => fold(name) === folded)?.[0] ?? null;
}

export type AddressProblem = { field: "postalCode" | "region"; message: string };

/** The address tidied, or what the buyer should fix. */
export function checkAddress<A extends Pick<Address, "country" | "postalCode"> & { region?: string | null }>(address: A): { address: A; problem: null } | { address: null; problem: AddressProblem } {
  const country = address.country.toUpperCase();
  let next = address;
  const format = FORMATS[country];
  if (format) {
    const compact = address.postalCode.toUpperCase().replace(/[\s\-–.]/g, "");
    if (!format.re.test(compact)) {
      return { address: null, problem: { field: "postalCode", message: `Check the postal code. In ${COUNTRY_NAMES[country]} it looks like ${format.example}.` } };
    }
    next = { ...next, postalCode: format.tidy ? format.tidy(compact) : compact };
  }
  const regions = REGIONS[country];
  if (regions) {
    const typed = address.region?.trim() ?? "";
    const code = typed ? regionCode(regions.list, typed) : null;
    if (!code) {
      return {
        address: null,
        problem: { field: "region", message: typed ? `Check the ${regions.word}. Enter it like ${regions.example}.` : `Enter the ${regions.word}, like ${regions.example}.` },
      };
    }
    next = { ...next, region: code };
  }
  return { address: next, problem: null };
}
