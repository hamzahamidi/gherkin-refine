export const FILE_NAME_STYLES: Readonly<Record<string, (name: string) => string>> = {
  PascalCase: (name) => startCase(name).replaceAll(" ", ""),
  "Title Case": (name) => startCase(name),
  camelCase: (name) => caseWords(name).reduce((result, word, index) => result + (index ? upperFirst(word.toLowerCase()) : word.toLowerCase()), ""),
  "kebab-case": (name) => caseWords(name).map((word) => word.toLowerCase()).join("-"),
  snake_case: (name) => caseWords(name).map((word) => word.toLowerCase()).join("_")
};

function deburr(value: string): string {
  const special: Readonly<Record<string, string>> = {
    "Æ": "Ae", "æ": "ae", "Ð": "D", "ð": "d", "Ø": "O", "ø": "o", "Þ": "Th", "þ": "th", "ß": "ss",
    "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "ı": "i", "Ĳ": "IJ", "ĳ": "ij", "ĸ": "k", "Ŀ": "L",
    "ŀ": "l", "Ł": "L", "ł": "l", "ŉ": "'n", "Ŋ": "N", "ŋ": "n", "Œ": "Oe", "œ": "oe", "Ŧ": "T",
    "ŧ": "t", "ſ": "s"
  };
  return value
    .replace(/[\xc0-\xd6\xd8-\xf6\xf8-\xffĀ-ſ]/g, (char) => special[char] ?? char.normalize("NFD").replace(/[̀-ͯ]/g, ""))
    .replace(/[̀-ͯ︠-︯⃐-⃿]/g, "");
}

const BREAK = "\\xac\\xb1\\xd7\\xf7\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf\\u2000-\\u206f \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000";

const UPPER = "A-Z\\xc0-\\xd6\\xd8-\\xde";

const LOWER = "a-z\\xdf-\\xf6\\xf8-\\xff";

const MISC = `[^\\ud800-\\udfff${BREAK}\\d\\u2700-\\u27bf${LOWER}${UPPER}]`;

const MISC_LOWER = `(?:[${LOWER}]|${MISC})`;

const MISC_UPPER = `(?:[${UPPER}]|${MISC})`;

const UNICODE_WORD = new RegExp([
  `[${UPPER}]?[${LOWER}]+(?=[${BREAK}]|[${UPPER}]|$)`,
  `${MISC_UPPER}+(?=[${BREAK}]|[${UPPER}]${MISC_LOWER}|$)`,
  `[${UPPER}]?${MISC_LOWER}+`,
  `[${UPPER}]+`,
  "\\d*(?:1ST|2ND|3RD|(?![123])\\dTH)(?=\\b|[a-z_])",
  "\\d*(?:1st|2nd|3rd|(?![123])\\dth)(?=\\b|[A-Z_])",
  "\\d+",
  "(?:[\\u2700-\\u27bf]|(?:\\ud83c[\\udde6-\\uddff]){2}|[\\ud800-\\udbff][\\udc00-\\udfff])[\\ufe0e\\ufe0f]?(?:[\\u0300-\\u036f\\ufe20-\\ufe2f\\u20d0-\\u20ff]|\\ud83c[\\udffb-\\udfff])?(?:\\u200d(?:[^\\ud800-\\udfff]|(?:\\ud83c[\\udde6-\\uddff]){2}|[\\ud800-\\udbff][\\udc00-\\udfff])[\\ufe0e\\ufe0f]?(?:[\\u0300-\\u036f\\ufe20-\\ufe2f\\u20d0-\\u20ff]|\\ud83c[\\udffb-\\udfff])?)*"
].join("|"), "g");

const ASCII_WORD = /[0-9A-Za-z\u0080-\uffff]+/g;

function caseWords(value: string): string[] {
  const source = deburr(value).replace(/['’]/g, "");
  if (/[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/.test(source)) return source.match(UNICODE_WORD) ?? [];
  return source.match(ASCII_WORD) ?? [];
}

function upperFirst(value: string): string {
  const [first = "", ...rest] = [...value];
  return first.toUpperCase() + rest.join("");
}

function startCase(value: string): string {
  return caseWords(value).map(upperFirst).join(" ");
}
