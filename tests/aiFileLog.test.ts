import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { LLMResult } from '@langchain/core/outputs';

// aiFileLog resolves its log dir via app.getPath('logs'). Point Electron at a
// throwaway dir created before the module is imported.
const { tmpLogs } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path') as typeof import('node:path');
  return { tmpLogs: nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'aiFileLog-test-')) };
});

vi.mock('electron', () => ({ app: { getPath: () => tmpLogs } }));

import { AiFileLogHandler, formatStamp, renderMessages } from '../src/main/ai/aiFileLog';

// aiFileLog appends 'ai' to app.getPath('logs').
const LOG_DIR = path.join(tmpLogs, 'ai');

function listLogs(): string[] {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR).sort();
}

function cleanLogDir() {
  if (fs.existsSync(LOG_DIR)) fs.rmSync(LOG_DIR, { recursive: true, force: true });
}

/**
 * Writes are queued and fire-and-forget, so tests must wait for them to land
 * rather than reading the directory immediately.
 */
async function waitForFiles(count: number): Promise<string[]> {
  for (let i = 0; i < 100; i++) {
    const files = listLogs();
    if (files.length >= count) return files;
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
  return listLogs();
}

/** Build a minimal LLMResult of the shape LangChain hands to handleLLMEnd. */
function makeResult(text: string, message?: unknown): LLMResult {
  return {
    generations: [[{ text, message } as never]],
  } as LLMResult;
}

beforeEach(() => {
  cleanLogDir();
});

afterAll(() => {
  fs.rmSync(tmpLogs, { recursive: true, force: true });
});

describe('formatStamp', () => {
  it('formats local time as YYYY-MM-DD--HH-MM-SS-mmm with zero padding', () => {
    // Local time deliberately — the filename is meant to be human readable.
    const d = new Date(2026, 7, 2, 4, 5, 6, 7); // 2026-08-02 04:05:06.007
    expect(formatStamp(d.getTime())).toBe('2026-08-02--04-05-06-007');
  });

  it('pads all fields to a fixed width so names sort lexically', () => {
    const a = formatStamp(new Date(2026, 10, 12, 14, 30, 5, 123).getTime());
    const b = formatStamp(new Date(2026, 10, 12, 14, 30, 5, 999).getTime());
    expect(a).toBe('2026-11-12--14-30-05-123');
    expect(a.length).toBe(b.length);
    expect(a < b).toBe(true);
  });
});

describe('renderMessages', () => {
  it('renders each message type with its content', () => {
    const out = renderMessages([
      new SystemMessage('you are helpful'),
      new HumanMessage('hello there'),
      new AIMessage('hi back'),
    ]);
    expect(out).toContain('[1] system');
    expect(out).toContain('you are helpful');
    expect(out).toContain('[2] human');
    expect(out).toContain('hello there');
    expect(out).toContain('[3] ai');
    expect(out).toContain('hi back');
  });

  it('replaces base64 image data with a placeholder', () => {
    const base64 = 'A'.repeat(5000);
    const msg = new HumanMessage({
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
      ],
    });
    const out = renderMessages([msg]);
    expect(out).toContain('what is this?');
    expect(out).toContain('[image: image/png, 5000 bytes base64 omitted]');
    expect(out).not.toContain(base64);
  });

  it('includes tool calls from an AI message', () => {
    const msg = new AIMessage({
      content: '',
      tool_calls: [{ name: 'mk_read_file', args: { path: '/tmp/x.md' }, id: 'call_1' }],
    });
    const out = renderMessages([msg]);
    expect(out).toContain('mk_read_file');
    expect(out).toContain('/tmp/x.md');
    expect(out).toContain('call_1');
  });

  it('includes the tool_call_id on a tool result message', () => {
    const out = renderMessages([new ToolMessage({ content: 'file contents', tool_call_id: 'call_1' })]);
    expect(out).toContain('[1] tool');
    expect(out).toContain('tool_call_id: call_1');
    expect(out).toContain('file contents');
  });
});

describe('AiFileLogHandler', () => {
  it('writes a prompt/response pair sharing one timestamp', async () => {
    const handler = new AiFileLogHandler();
    handler.handleChatModelStart({}, [[new SystemMessage('sys'), new HumanMessage('question?')]], 'run-1');
    handler.handleLLMEnd(makeResult('the answer'), 'run-1');

    const files = await waitForFiles(2);
    expect(files).toHaveLength(2);

    const [promptFile, responseFile] = files.slice().sort();
    expect(promptFile).toMatch(/^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}-\d{3}-prompt\.md$/);
    expect(responseFile).toMatch(/-response\.md$/);

    // Same round-trip => same stamp, differing only in the suffix.
    expect(promptFile!.replace('-prompt.md', '')).toBe(responseFile!.replace('-response.md', ''));

    expect(fs.readFileSync(path.join(LOG_DIR, promptFile!), 'utf-8')).toContain('question?');
    expect(fs.readFileSync(path.join(LOG_DIR, responseFile!), 'utf-8')).toContain('the answer');
  });

  it('gives distinct ascending names to round-trips starting in the same millisecond', async () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const handler = new AiFileLogHandler();
      handler.handleChatModelStart({}, [[new HumanMessage('a')]], 'run-a');
      handler.handleChatModelStart({}, [[new HumanMessage('b')]], 'run-b');
      handler.handleChatModelStart({}, [[new HumanMessage('c')]], 'run-c');
    } finally {
      spy.mockRestore();
    }

    const files = await waitForFiles(3);
    expect(files).toHaveLength(3);
    expect(new Set(files).size).toBe(3);
    // Still chronologically ordered despite the identical clock reading.
    expect(files.slice().sort()).toEqual(files);
  });

  it('writes an error file when the call fails', async () => {
    const handler = new AiFileLogHandler();
    handler.handleChatModelStart({}, [[new HumanMessage('boom?')]], 'run-err');
    handler.handleLLMError(new Error('rate limited'), 'run-err');

    const files = await waitForFiles(2);
    expect(files.some((f) => f.endsWith('-error.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('-response.md'))).toBe(false);

    const errFile = files.find((f) => f.endsWith('-error.md'))!;
    expect(fs.readFileSync(path.join(LOG_DIR, errFile), 'utf-8')).toContain('rate limited');
  });

  it('logs each round-trip of a tool loop separately', async () => {
    const handler = new AiFileLogHandler();
    const toolCall = new AIMessage({
      content: '',
      tool_calls: [{ name: 'mk_read_file', args: { path: '/x.md' }, id: 'c1' }],
    });

    handler.handleChatModelStart({}, [[new HumanMessage('read /x.md')]], 'run-1');
    handler.handleLLMEnd(makeResult('', toolCall), 'run-1');
    handler.handleChatModelStart(
      {},
      [[new HumanMessage('read /x.md'), toolCall, new ToolMessage({ content: '# hi', tool_call_id: 'c1' })]],
      'run-2',
    );
    handler.handleLLMEnd(makeResult('it says hi'), 'run-2');

    const files = await waitForFiles(4);
    expect(files).toHaveLength(4);

    // The second prompt must carry the first round-trip's tool result.
    const prompts = files.filter((f) => f.endsWith('-prompt.md'));
    expect(prompts).toHaveLength(2);
    const secondPrompt = fs.readFileSync(path.join(LOG_DIR, prompts[1]!), 'utf-8');
    expect(secondPrompt).toContain('tool_call_id: c1');
    expect(secondPrompt).toContain('# hi');
  });
});
