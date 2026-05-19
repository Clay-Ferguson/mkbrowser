/**
 * Utilities for turning a markdown file into a calendar item via front matter injection.
 */

export function isMarkdownFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.md') || fileName.toLowerCase().endsWith('.markdown');
}

function getCurrentDateStr(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = String(now.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function getCurrentTimeStr(): string {
  const now = new Date();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

function getUntilDateStr(): string {
  const year = new Date().getFullYear() + 2;
  return `12/31/${String(year).slice(-2)}`;
}

/**
 * Checks whether the given markdown content already has a 'due' property in front matter.
 */
export function hasDueProperty(content: string): boolean {
  if (!content.startsWith('---')) return false;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return false;
  const frontMatter = content.slice(0, end + 4);
  return /^due\s*:/m.test(frontMatter);
}

function buildCalendarBlock(repeating: boolean): string {
  const due = getCurrentDateStr();
  const start = getCurrentTimeStr();
  const lines = [
    `due: ${due}`,
    `start: "${start}"`,
    `duration: 1`,
  ];
  if (repeating) {
    lines.push(`rrule:`, `  freq: weekly`, `  interval: 1`, `  until: ${getUntilDateStr()}`);
  }
  return lines.join('\n');
}

/**
 * Injects calendar front matter into the given markdown content.
 * Pass repeating=true to include the rrule block.
 * If there is already a front matter block, merges the calendar fields at the top.
 * If there is no front matter block, prepends one.
 * Returns the modified content.
 */
export function injectCalendarFrontMatter(content: string, repeating: boolean): string {
  const calendarBlock = buildCalendarBlock(repeating);

  if (content.startsWith('---')) {
    const afterOpen = content.slice(3); // skip first '---'
    return `---\n${calendarBlock}\n${afterOpen.startsWith('\n') ? afterOpen.slice(1) : afterOpen}`;
  }

  return `---\n${calendarBlock}\n---\n${content}`;
}
