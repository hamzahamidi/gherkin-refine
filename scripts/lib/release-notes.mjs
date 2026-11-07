export function releaseNotes(changelog, tag) {
  if (!tag?.startsWith('v')) throw new Error('Expected a release tag starting with v');
  const version = tag.slice(1);
  const sections = changelog.replaceAll('\r\n', '\n').split(/(?=^## )/m);
  const matches = sections.filter(section => section.split('\n', 1)[0].match(/^## (\S+)(?:\s.*)?$/)?.[1] === version);
  if (matches.length !== 1) throw new Error(`Expected exactly one changelog section for ${tag}, found ${matches.length}`);
  const notes = matches[0].trim();
  if (!notes.split('\n').slice(1).join('\n').trim()) {
    throw new Error(`Empty changelog section for ${tag}`);
  }
  return `${notes}\n`;
}
