import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { rehypeDates } from '../src/shared/rehypeDates';
import { extractTimestamp, getDaysFromToday, formatDaysDisplay } from '../src/shared/timeUtil';

// Same plugin order as MarkdownView (rehypeDates ahead of rehype-katex, which isn't needed here).
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: true })
  .use(remarkRehype)
  .use(rehypeDates)
  .use(rehypeStringify);

function render(md: string): string {
  return String(processor.processSync(md));
}

const delta = (d: string) => formatDaysDisplay(getDaysFromToday(extractTimestamp(d)));
const span = (d: string) => `<span class="md-date" title="${delta(d)}">${d}</span>`;

describe('rehypeDates', () => {
  it('wraps short and long dates in prose, keeping the surrounding text', () => {
    expect(render('Due 01/12/26 or 1/12/2026, ok.'))
      .toBe(`<p>Due ${span('01/12/26')} or ${span('1/12/2026')}, ok.</p>`);
  });

  it('includes a trailing time in the date token', () => {
    expect(render('At 03/04/2026 2:30 PM sharp')).toContain(span('03/04/2026 2:30 PM'));
  });

  it('wraps dates inside nested inline formatting, lists and tables', () => {
    expect(render('**on 01/12/26**')).toContain(`<strong>on ${span('01/12/26')}</strong>`);
    expect(render('- item 02/03/26')).toContain(`<li>item ${span('02/03/26')}</li>`);
    expect(render('| a |\n| - |\n| 02/03/26 |')).toContain(`<td>${span('02/03/26')}</td>`);
  });

  it('leaves code, math and link text alone', () => {
    for (const md of ['`01/12/26`', '```\n01/12/26\n```', '$01/12/26$', '[01/12/26](x.md)']) {
      expect(render(md)).not.toContain('md-date');
    }
  });

  it('titles each date with its time delta from today', () => {
    const now = new Date();
    const today = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
    expect(render(`On ${today}`)).toContain(`title="today"`);
    expect(render('Back on 01/12/2000')).toMatch(/title="\d+y( \d+m)?( \d+d)? ago"/);
  });

  it('highlights an impossible date without a delta title', () => {
    expect(render('On 02/31/2026')).toContain('<span class="md-date">02/31/2026</span>');
  });

  it('ignores text with slashes that is not a date', () => {
    expect(render('path a/b/c and 13/45/2026')).not.toContain('md-date');
  });
});
