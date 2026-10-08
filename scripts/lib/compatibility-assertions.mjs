import assert from 'node:assert/strict';

export function normalizeAst(value) {
  if (Array.isArray(value)) return value.map(normalizeAst);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'location' && key !== 'id').map(([key, item]) => [key, normalizeAst(item)]));
  return value;
}

export function compareAst(before, after, path = [], permitted = []) {
  if (Array.isArray(before)) {
    assert(Array.isArray(after));
    assert.equal(after.length, before.length, `${path.join('.')}: array length`);
    before.forEach((item, index) => compareAst(item, after[index], [...path, index], permitted));
  } else if (before && typeof before === 'object') {
    assert(after && typeof after === 'object');
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), `${path.join('.')}: keys`);
    for (const key of Object.keys(before)) compareAst(before[key], after[key], [...path, key], permitted);
  } else if (before !== after) {
    const field = path.at(-1);
    const prose = field === 'description' || (path[0] === 'comments' && field === 'text');
    assert(prose && typeof before === 'string' && typeof after === 'string', `${path.join('.')}: unexpected AST change`);
    const expected = before.split('\n').map((line) => line.replace(/[ \t]+(?=\r?$)/g, '')).join('\n');
    assert.equal(after, expected, `${path.join('.')}: unexpected prose change`);
    permitted.push({ field: path.join('.'), before, after, ruleId: 'no-trailing-whitespace' });
  }
  return permitted;
}

export function assertWhitespaceEdits(before, after) {
  const original = before.split('\n');
  const fixed = after.split('\n');
  let index = 0;
  for (const line of fixed) {
    while (index < original.length) {
      const current = original[index];
      const trimmed = current.replace(/[ \t]+(?=\r?$)/g, '');
      if (line === current || line === trimmed) break;
      assert(index > 0 && /^[ \t]*\r?$/.test(current) && /^[ \t]*\r?$/.test(original[index - 1]), `Unexpected source edit at line ${index + 1}`);
      index++;
    }
    assert(index < original.length, 'Unexpected inserted source line');
    index++;
  }
  while (index < original.length) {
    assert(index > 0 && /^[ \t]*\r?$/.test(original[index]) && /^[ \t]*\r?$/.test(original[index - 1]), 'Unexpected removed source line');
    index++;
  }
}
