import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageDirectory = dirname(require.resolve("cucumber-messages/package.json"));

const patches = [
  {
    path: join(packageDirectory, "src/IdGenerator.ts"),
    before: "import uuidv4 from 'uuid/v4'",
    after: "import { v4 as uuidv4 } from 'uuid'"
  },
  {
    path: join(packageDirectory, "dist/src/IdGenerator.js"),
    replacements: [
      ['var v4_1 = __importDefault(require("uuid/v4"));', 'var uuid_1 = require("uuid");'],
      ["return function () { return v4_1.default(); };", "return function () { return uuid_1.v4(); };"]
    ]
  }
];

for (const patch of patches) {
  const source = await readFile(patch.path, "utf8");
  if (patch.before && source.includes(patch.after)) continue;
  if (!patch.before && patch.replacements.every(([, after]) => source.includes(after))) continue;

  let updated = source;
  if (patch.before) {
    if (!source.includes(patch.before)) throw new Error(`Unexpected cucumber-messages source in ${patch.path}`);
    updated = source.replace(patch.before, patch.after);
  } else {
    for (const [before, after] of patch.replacements) {
      if (!updated.includes(before)) throw new Error(`Unexpected cucumber-messages source in ${patch.path}`);
      updated = updated.replace(before, after);
    }
  }

  await writeFile(patch.path, updated);
}
