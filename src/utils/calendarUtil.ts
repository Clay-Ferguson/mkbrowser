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
 * Extracts the 'due' property value from front matter, or null if not present.
 */
export function getDueProperty(content: string): string | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const frontMatter = content.slice(3, end);
  const match = frontMatter.match(/^due\s*:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Extracts the 'start' property value from front matter, or null if not present.
 */
export function getStartProperty(content: string): string | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const frontMatter = content.slice(3, end);
  const match = frontMatter.match(/^start\s*:\s*"?(.+?)"?\s*$/m);
  return match ? match[1].trim() : null;
}

/**
 * Extracts the 'duration' property value from front matter, or null if not present.
 */
export function getDurationProperty(content: string): string | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const frontMatter = content.slice(3, end);
  const match = frontMatter.match(/^duration\s*:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Sets or updates a simple string property in front matter.
 * If the property exists it is replaced; if not, it is inserted after the opening ---.
 */
function setFrontMatterProperty(content: string, key: string, value: string): string {
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) {
      const frontMatter = content.slice(3, end);
      const re = new RegExp(`^${key}\\s*:.*$`, 'm');
      if (re.test(frontMatter)) {
        const updated = frontMatter.replace(re, `${key}: ${value}`);
        return `---${updated}${content.slice(end)}`;
      }
      return `---\n${key}: ${value}${frontMatter}\n---${content.slice(end + 4)}`;
    }
  }
  return `---\n${key}: ${value}\n---\n${content}`;
}

export function setStartProperty(content: string, startValue: string): string {
  return setFrontMatterProperty(content, 'start', `"${startValue}"`);
}

export function setDurationProperty(content: string, durationValue: string): string {
  return setFrontMatterProperty(content, 'duration', durationValue);
}

/**
 * Sets or updates the 'due' property in front matter.
 * If no front matter exists, one is created. If 'due' already exists, it is replaced.
 */
export function setDueProperty(content: string, dueValue: string): string {
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) {
      const frontMatter = content.slice(3, end);
      if (/^due\s*:/m.test(frontMatter)) {
        const updated = frontMatter.replace(/^due\s*:.*$/m, `due: ${dueValue}`);
        return `---${updated}${content.slice(end)}`;
      }
      return `---\ndue: ${dueValue}${frontMatter}\n---${content.slice(end + 4)}`;
    }
  }
  return `---\ndue: ${dueValue}\n---\n${content}`;
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
