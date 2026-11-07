import { describe, expect, it } from 'vitest';
import { releaseNotes } from '../scripts/lib/release-notes.mjs';

const changelog = '# Changelog\n\n## 1.4.7 (2026-11-07)\n\nCurrent notes.\n\n### Details\n\nDetails.\n\n## 1.4.6 (2026-10-24)\n\nOlder notes.\n';

describe('release notes', () => {
  it('includes only the tagged version and its subsections', () => {
    expect(releaseNotes(changelog, 'v1.4.7')).toBe('## 1.4.7 (2026-11-07)\n\nCurrent notes.\n\n### Details\n\nDetails.\n');
  });

  it('selects an older version rather than the first section', () => {
    expect(releaseNotes(changelog, 'v1.4.6')).toBe('## 1.4.6 (2026-10-24)\n\nOlder notes.\n');
  });

  it('handles CRLF, undated headings and prerelease tags without prefix matches', () => {
    const source = '## 1.4.70\r\n\r\nOther.\r\n\r\n## 1.4.7-rc.1\r\n\r\nCandidate.\r\n';
    expect(releaseNotes(source, 'v1.4.7-rc.1')).toBe('## 1.4.7-rc.1\n\nCandidate.\n');
    expect(() => releaseNotes(source, 'v1.4.7')).toThrow('found 0');
  });

  it('rejects missing, duplicate and empty sections', () => {
    expect(() => releaseNotes(changelog, 'v9.0.0')).toThrow('found 0');
    expect(() => releaseNotes(changelog + changelog, 'v1.4.7')).toThrow('found 2');
    expect(() => releaseNotes('## 1.4.7\n\n## 1.4.6\n\nOlder.', 'v1.4.7')).toThrow('Empty');
    expect(() => releaseNotes('## 1.4.7', 'v1.4.7')).toThrow('Empty');
    expect(() => releaseNotes(changelog, '1.4.7')).toThrow('starting with v');
  });
});
