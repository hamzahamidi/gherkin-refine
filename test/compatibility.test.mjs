import { describe, expect, it } from 'vitest';
import { assertWhitespaceEdits, compareAst } from '../scripts/lib/compatibility-assertions.mjs';

describe('compatibility preservation assertions', () => {
  it('accepts removal of trailing ASCII whitespace in prose without changing CRLF', () => {
    const before = { comments: [{ text: '# comment  ' }], feature: { description: 'prose \r\nmore\t' } };
    const after = { comments: [{ text: '# comment' }], feature: { description: 'prose\r\nmore' } };
    expect(compareAst(before, after)).toHaveLength(2);
    expect(() => compareAst(before, { ...after, feature: { description: 'prose\nmore' } })).toThrow();
  });

  it('rejects changed content, added whitespace, and modified data values', () => {
    for (const [before, after] of [
      [{ description: 'original ' }, { description: 'replacement' }],
      [{ description: 'original' }, { description: 'original ' }],
      [{ docString: { content: 'data ' } }, { docString: { content: 'data' } }],
      [{ dataTable: { rows: [{ cells: [{ value: 'data ' }] }] } }, { dataTable: { rows: [{ cells: [{ value: 'data' }] }] } }]
    ]) expect(() => compareAst(before, after)).toThrow();
  });

  it('allows whitespace source edits and rejects content or line-ending changes', () => {
    expect(() => assertWhitespaceEdits('Feature: F  \r\n\r\n\r\n  Scenario: S\r\n', 'Feature: F\r\n\r\n  Scenario: S\r\n')).not.toThrow();
    expect(() => assertWhitespaceEdits('Feature: F\n', 'Feature: G\n')).toThrow();
    expect(() => assertWhitespaceEdits('Feature: F\r\n', 'Feature: F\n')).toThrow();
  });
});
