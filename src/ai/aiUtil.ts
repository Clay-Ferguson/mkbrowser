/**
 * AI utility functions for MkBrowser.
 * This module runs in the main process only — never import from the renderer.
 */

import path from 'node:path';
import { fdir } from 'fdir';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { getConfig } from '../configMgr';
import { recordUsage } from './usageTracker';
import { getActiveModel, getActiveProvider, ensureModelServerRunning } from './aiModel';
import { DEFAULT_AI_REWRITE_PERSONA, AI_REWRITE_PROMPT, AI_REWRITE_SELECTION_PROMPT } from './aiPrompts';
import { preprocessPrompt, type PreprocessResult } from './promptPreprocess';
import { ALLOW_DEEP_AGENTS, invokeDeepAgent, streamDeepAgent } from './deepAgent';
import { readIndexYaml } from '../utils/indexUtil';
import { invokeAI, streamAI, resolveActivePersona, hasScriptedAnswer, type AIUsageInfo, type AIInvokeResult, type StreamCallbacks } from './langGraph';
import { logger } from '../utils/logUtil';
import { readAiHint } from './aiHint';

/**
 * Convert a raw AI API error into a short, user-friendly message.
 * Falls back to the original message if no known pattern matches.
 */
export function friendlyAIError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/429|quota|rate.?limit/i.test(raw))
    return 'AI rate limit exceeded — please wait a moment and try again.';
  if (/401|unauthorized|invalid.*key|api.?key/i.test(raw))
    return 'AI authentication failed — check your API key in settings.';
  if (/403|forbidden|permission/i.test(raw))
    return 'AI access denied — your API key may lack the required permissions.';
  if (/404|model.*not found/i.test(raw))
    return 'AI model not found — check the model name in settings.';
  if (/5\d{2}|server.?error|internal.?error/i.test(raw))
    return 'AI service is temporarily unavailable — please try again later.';
  if (/timeout|timed?.?out|ETIMEDOUT|ECONNABORTED/i.test(raw))
    return 'AI request timed out — please try again.';
  if (/ENOTFOUND|ECONNREFUSED|network|fetch failed/i.test(raw))
    return 'Could not reach the AI service — check your network connection.';

  // Strip very long SDK error prefixes to keep the message readable
  const short = raw.replace(/^\[\w+ Error\]:\s*/i, '').slice(0, 200);
  return short || 'An unknown AI error occurred.';
}

/**
 * Find the first available folder name of the form `<baseName>`, `<baseName>1`,
 * `<baseName>2`, etc. inside `parentDir`. Uses fdir to scan existing subdirectory names.
 *
 * @param parentDir  Directory to scan for existing numbered subfolders.
 * @param baseName   Base folder name, e.g. "A".
 * @returns          Full absolute path for the first available folder.
 */
export async function findNextNumberedFolder(parentDir: string, baseName: string): Promise<string> {
  // Try bare baseName first (e.g. "A"), then "A1", "A2", ...
  const bare = path.join(parentDir, baseName);
  if (!existsSync(bare)) {
    return bare;
  }
  for (let i = 1; i <= 20; i++) {
    const candidate = path.join(parentDir, `${baseName}${i}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No available folder name found for "${baseName}" in "${parentDir}" (tried bare + 1–20)`);
}

/**
 * Find the first available filename of the form `<baseName>.md`, `<baseName>1.md`,
 * `<baseName>2.md`, etc. inside `dir`. Uses fdir to scan existing filenames.
 *
 * @param dir       Directory to scan (must already exist).
 * @param baseName  Base name without extension, e.g. "AI".
 * @returns         Full absolute path for the first available file.
 */
export async function findNextNumberedFile(dir: string, baseName: string): Promise<string> {
  let existingFiles: string[] = [];
  try {
    existingFiles = await new fdir()
      .withFullPaths()
      .withMaxDepth(0)
      .crawl(dir)
      .withPromise();
  } catch {
    // Directory might be empty or just created — treat as no existing files
  }

  const existingNames = new Set(existingFiles.map((f) => path.basename(f)));

  // Try <baseName>.md first, then <baseName>1.md, <baseName>2.md, ...
  const primaryName = `${baseName}.md`;
  if (!existingNames.has(primaryName)) {
    return path.join(dir, primaryName);
  }

  let counter = 1;
  for (;;) {
    const candidate = `${baseName}${counter}.md`;
    if (!existingNames.has(candidate)) {
      return path.join(dir, candidate);
    }
    counter++;
  }
}

/**
 * Walk up the folder hierarchy from the current HUMAN.md's parent folder to
 * gather all prior conversation turns. Each turn folder is expected to contain
 * exactly one of AI.md or HUMAN.md; walking stops at the first folder that
 * contains neither (the conversation root). A folder containing both is an
 * error.
 *
 * Returns messages in chronological order (oldest first), ready to pass as
 * the `history` parameter to `invokeAI` / `streamAI`.
 *
 * @param currentHumanFolder  Absolute path of the folder containing the
 *                            current HUMAN.md (the one the user clicked
 *                            "Ask AI" on). This folder itself is NOT included
 *                            in the history — its content is the new prompt.
 */
export async function gatherConversationHistory(
  currentHumanFolder: string
): Promise<BaseMessage[]> {
  const history: BaseMessage[] = [];

  // Start walking from the parent of the current H-folder
  let walker = path.dirname(currentHumanFolder);

  // eslint-disable-next-line no-constant-condition
  while (true) {

    const aiFileExists = existsSync(path.join(walker, 'AI.md'));
    const humanFileExists = existsSync(path.join(walker, 'HUMAN.md'));

    if (aiFileExists && humanFileExists) {
      // throw error to user saying there cannot be both files
      throw new Error(`Folder "${walker}" contains BOTH AI.md and HUMAN.md, which is unexpected. Please ensure each conversation turn folder contains only one of these files.`);
    }

    if (aiFileExists) {
      // Agent folder — look for AI.md
      const aiFile = path.join(walker, 'AI.md');
      try {
        const content = await fs.readFile(aiFile, 'utf-8');
        history.unshift(new AIMessage(content));
      } catch {
        // AI.md missing or unreadable — stop here
        break;
      }
    } else if (humanFileExists) {
      // Human folder — look for HUMAN.md
      const humanFile = path.join(walker, 'HUMAN.md');
      try {
        const rawContent = await fs.readFile(humanFile, 'utf-8');
        // Historical turns: includeImages=false to avoid re-sending costly images
        const processed = await preprocessPrompt(rawContent, walker, false);
        history.unshift(new HumanMessage(processed.text));
      } catch {
        // HUMAN.md missing or unreadable — stop here
        break;
      }
    } else {
      // Folder has neither AI.md nor HUMAN.md — we've reached the conversation root
      break;
    }

    // Move up one level
    walker = path.dirname(walker);
  }

  return history;
}

/** Result of handleAskAI — either a success with paths and usage, or an error. */
export type AskAIResult =
  | { outputPath: string; responseFolder: string; usage?: AIUsageInfo }
  | { error: string };

/**
 * Orchestrate an AI prompt: preprocess, validate, invoke (streaming or not),
 * record usage, and write AI.md / THINK.md to disk.
 *
 * Electron-specific concerns (cancel listener, webContents.send) are handled
 * by the caller via `streamCallbacks` and `signal`.
 *
 * @param prompt            Raw prompt text from the user
 * @param parentFolderPath  Folder containing the H/ folder with HUMAN.md
 * @param streamCallbacks   If non-null, use streaming; null = non-streaming invoke
 * @param signal            Optional AbortSignal for cancellation
 * @param onStreamDone      Called when streaming finishes successfully
 * @param onStreamError     Called when streaming throws (before re-throw)
 */
export async function handleAskAI(
  prompt: string,
  parentFolderPath: string,
  streamCallbacks: StreamCallbacks | null,
  signal?: AbortSignal,
  onStreamDone?: () => void,
  onStreamError?: (err: unknown) => void,
): Promise<AskAIResult> {
  logger.log("running handleAskAI()");
  // Preprocess the prompt first (before creating folders) so we can
  // detect images and validate vision support before any side effects.
  const processedPrompt = await preprocessPrompt(prompt, parentFolderPath);

  // If the prompt contains images, verify the selected model supports vision.
  // Skip this check when a scripted answer is queued (Playwright tests): we
  // won't actually call the LLM, so the model's vision capability is irrelevant.
  if (processedPrompt.images.length > 0 && !hasScriptedAnswer()) {
    const activeModel = getActiveModel();
    if (activeModel && !activeModel.vision) {
      return {
        error: `The selected model "${activeModel.name}" does not support images. Please select a vision-capable model or remove image files from your prompt.`,
      };
    }
  }

  // If using a LLAMACPP model, ensure the server is running before inference
  await ensureModelServerRunning();

  // Find the next available response folder: A/, A1/, A2/, ...
  const responseFolder = await findNextNumberedFolder(parentFolderPath, 'A');

  // Create the response folder
  await fs.mkdir(responseFolder, { recursive: true });

  // Response always goes into AI.md inside the numbered folder
  const outputPath = path.join(responseFolder, 'AI.md');

  // Gather conversation history from the folder hierarchy
  const history = await gatherConversationHistory(parentFolderPath);

  let content: string;
  let thinking: string | undefined;
  let usage: AIUsageInfo | undefined;
  const config = getConfig();

  // Apply the user's selected persona so it stays operative in conversation,
  // exactly as it does for one-shot AI Rewrite calls.
  const persona = resolveActivePersona();

  if (streamCallbacks && !hasScriptedAnswer()) {
    // ── Streaming path ──
    logger.log("running streaming AI call");
    try {
      const result = (ALLOW_DEEP_AGENTS && config.agenticMode)
        ? await streamDeepAgent(processedPrompt, history, streamCallbacks, signal, persona)
        : await streamAI(processedPrompt, history, streamCallbacks, signal, persona);
      content = result.content;
      thinking = result.thinking;
      usage = result.usage;

      // Handle cancellation: mark partial content
      if (signal?.aborted && content.length > 0) {
        content += '\n\n---\n*[Response interrupted by user]*';
      }

      onStreamDone?.();
    } catch (streamErr) {
      onStreamError?.(streamErr);
      throw streamErr;
    }

    // If aborted with no content, clean up the empty response folder
    if (signal?.aborted && content.length === 0) {
      try { await fs.rm(responseFolder, { recursive: true }); } catch { /* ignore */ }
      return { error: 'Response cancelled by user' };
    }
  } else {
    // ── Non-streaming path ──
    logger.log("running non-streaming AI call");
    const result = (ALLOW_DEEP_AGENTS && config.agenticMode)
      ? await invokeDeepAgent(processedPrompt, history, persona)
      : await invokeAI(processedPrompt, history, persona);
    content = result.content;
    thinking = result.thinking;
    usage = result.usage;
  }

  // Record token usage if available
  if (usage) {
    await recordUsage(getActiveProvider(), usage.input_tokens, usage.output_tokens);
  }

  // Write the response
  await fs.writeFile(outputPath, content, 'utf-8');

  // Write thinking content (if any) to THINK.md alongside AI.md
  if (thinking && thinking.length > 0) {
    const thinkingPath = path.join(responseFolder, 'THINK.md');
    await fs.writeFile(thinkingPath, thinking, 'utf-8');
  }

  return { outputPath, responseFolder, usage };
}

/**
 * Builds above/below document context from sibling md/txt files ordered by .INDEX.yaml.
 * Skips the current file and non-markdown/text files. Returns empty strings if the index
 * can't be read or fullDocContext is disabled.
 */
async function buildDocumentContext(
  filePath: string,
  hasIndexFile: boolean,
): Promise<{ aboveContent: string; belowContent: string }> {
  const empty = { aboveContent: '', belowContent: '' };
  if (!hasIndexFile) return empty;

  const config = getConfig();
  if (!config.fullDocContext) return empty;

  const folderPath = path.dirname(filePath);
  const currentFileName = path.basename(filePath);
  const indexYaml = await readIndexYaml(folderPath);
  if (!indexYaml?.files) return empty;

  const supportedExts = new Set(['.md', '.txt']);
  const currentIndex = indexYaml.files.findIndex((e) => e.name === currentFileName);

  const readFile = async (name: string): Promise<string> => {
    try {
      return await fs.readFile(path.join(folderPath, name), 'utf8');
    } catch {
      return '';
    }
  };

  const aboveParts: string[] = [];
  const belowParts: string[] = [];

  for (let i = 0; i < indexYaml.files.length; i++) {
    const entry = indexYaml.files[i];
    if (entry.name === currentFileName) continue;
    if (!supportedExts.has(path.extname(entry.name).toLowerCase())) continue;
    const text = await readFile(entry.name);
    if (!text) continue;
    if (i < currentIndex) aboveParts.push(text);
    else belowParts.push(text);
  }

  const aboveContent = aboveParts.length > 0 ? aboveParts.join('\n\n') + '\n\n' : '';
  const belowContent = belowParts.length > 0 ? '\n\n' + belowParts.join('\n\n') : '';
  return { aboveContent, belowContent };
}

/**
 * Run a rewrite prompt through the AI, streaming when callbacks are provided.
 *
 * Mirrors the streaming/non-streaming branching in {@link handleAskAI} so the
 * AI Rewrite buttons can drive the same StreamingDialog as Ask AI. Scripted
 * (test) answers always take the non-streaming path so no stream events fire.
 */
async function invokeRewrite(
  prompt: PreprocessResult,
  persona: string,
  streamCallbacks: StreamCallbacks | null,
  signal?: AbortSignal,
  onStreamDone?: () => void,
  onStreamError?: (err: unknown) => void,
): Promise<AIInvokeResult> {
  const config = getConfig();
  const useDeepAgent = ALLOW_DEEP_AGENTS && config.agenticMode;

  if (streamCallbacks && !hasScriptedAnswer()) {
    try {
      const result = useDeepAgent
        ? await streamDeepAgent(prompt, [], streamCallbacks, signal, persona)
        : await streamAI(prompt, [], streamCallbacks, signal, persona);
      onStreamDone?.();
      return result;
    } catch (streamErr) {
      onStreamError?.(streamErr);
      throw streamErr;
    }
  }

  return useDeepAgent ? await invokeDeepAgent(prompt, [], persona) : await invokeAI(prompt, [], persona);
}

/**
 * Shared core of the AI Rewrite handlers: ensures the local server is running,
 * resolves the persona, assembles the rewrite prompt (instruction + document
 * context + the content to rewrite), invokes the model, and records usage.
 *
 * Returns the raw rewritten text from the model — callers handle any splicing
 * — or a clean error when the user cancels before any content streams.
 *
 * @param promptInstruction  The leading instruction (e.g. {@link AI_REWRITE_PROMPT}).
 * @param innerContent       The text placed inside the `<content>` tags.
 */
async function runRewrite(
  promptInstruction: string,
  innerContent: string,
  filePath: string,
  hasIndexFile: boolean,
  streamCallbacks: StreamCallbacks | null,
  signal?: AbortSignal,
  onStreamDone?: () => void,
  onStreamError?: (err: unknown) => void,
): Promise<{ content: string; usage?: AIUsageInfo } | { error: string }> {
  // If using a LLAMACPP model, ensure the server is running before inference
  await ensureModelServerRunning();

  // Resolve the persona. It's woven into the system prompt by the invocation
  // layer (see resolveActivePersona/buildSystemPrompt), so it's no longer
  // prefixed to the prompt text here. Fall back to the default editor persona
  // when the user hasn't selected one.
  const persona = resolveActivePersona() ?? DEFAULT_AI_REWRITE_PERSONA;

  const { aboveContent, belowContent } = await buildDocumentContext(filePath, hasIndexFile);

  const prompt: PreprocessResult = {
    text: `${promptInstruction}\n\n${aboveContent}<content>\n${innerContent}\n</content>${belowContent}`,
    images: [],
  };

  const result = await invokeRewrite(prompt, persona, streamCallbacks, signal, onStreamDone, onStreamError);

  // If the user cancelled before any content streamed, surface a clean error.
  if (signal?.aborted && result.content.length === 0) {
    return { error: 'Rewrite cancelled by user' };
  }

  // Record token usage if available
  if (result.usage) {
    await recordUsage(getActiveProvider(), result.usage.input_tokens, result.usage.output_tokens);
  }

  return { content: result.content, usage: result.usage };
}

/**
 * Rewrite content using the configured AI rewrite prompt.
 * Returns the rewritten text and optional usage info.
 *
 * When `streamCallbacks` is provided, tokens are streamed to the renderer so
 * the StreamingDialog can show live progress (see {@link invokeRewrite}).
 */
export async function handleRewriteContent(
  content: string,
  filePath: string,
  hasIndexFile: boolean,
  streamCallbacks: StreamCallbacks | null = null,
  signal?: AbortSignal,
  onStreamDone?: () => void,
  onStreamError?: (err: unknown) => void,
): Promise<{ rewrittenContent: string; usage?: AIUsageInfo } | { error: string }> {
  const result = await runRewrite(
    AI_REWRITE_PROMPT,
    content,
    filePath,
    hasIndexFile,
    streamCallbacks,
    signal,
    onStreamDone,
    onStreamError,
  );
  if ('error' in result) return result;

  return { rewrittenContent: result.content, usage: result.usage };
}

/**
 * Rewrite a selected region of content using the configured AI rewrite prompt.
 * The full file content is sent for context, with <rewrite_region> tags marking the
 * portion to rewrite. The AI returns only the rewritten portion, which is spliced
 * back into the full content using the original character offsets.
 */
export async function handleRewriteContentSection(
  content: string,
  selectionFrom: number,
  selectionTo: number,
  filePath: string,
  hasIndexFile: boolean,
  streamCallbacks: StreamCallbacks | null = null,
  signal?: AbortSignal,
  onStreamDone?: () => void,
  onStreamError?: (err: unknown) => void,
): Promise<{ rewrittenContent: string; usage?: AIUsageInfo } | { error: string }> {
  // Build content with <rewrite_region> tags wrapping the selected portion
  const textWithSelection =
    content.slice(0, selectionFrom) +
    '<rewrite_region>' +
    content.slice(selectionFrom, selectionTo) +
    '</rewrite_region>' +
    content.slice(selectionTo);

  const result = await runRewrite(
    AI_REWRITE_SELECTION_PROMPT,
    textWithSelection,
    filePath,
    hasIndexFile,
    streamCallbacks,
    signal,
    onStreamDone,
    onStreamError,
  );
  if ('error' in result) return result;

  // Splice the rewritten portion back into the original content using offsets
  const rewrittenContent =
    content.slice(0, selectionFrom) +
    result.content +
    content.slice(selectionTo);

  return { rewrittenContent, usage: result.usage };
}

/**
 * Create a reply-to-AI folder with an empty HUMAN.md.
 * If createSubFolder is true, finds the next numbered H/ folder;
 * otherwise creates HUMAN.md directly in parentFolderPath.
 */
export async function handleReplyToAI(
  parentFolderPath: string,
  createSubFolder: boolean,
): Promise<{ folderPath: string; filePath: string } | { error: string }> {
  if (createSubFolder) {
    // Find the next available human folder: H/, H1/, H2/, ...
    const humanFolder = await findNextNumberedFolder(parentFolderPath, 'H');

    // Create the folder
    await fs.mkdir(humanFolder, { recursive: true });

    // Create an empty HUMAN.md inside it
    const filePath = path.join(humanFolder, 'HUMAN.md');
    await fs.writeFile(filePath, '', 'utf-8');

    return { folderPath: humanFolder, filePath };
  } else {
    // Create HUMAN.md directly in the parent folder
    const filePath = path.join(parentFolderPath, 'HUMAN.md');

    // Check if HUMAN.md already exists
    try {
      await fs.access(filePath);
      return { error: 'HUMAN.md already exists in this folder' };
    } catch {
      // File doesn't exist — proceed
    }

    await fs.writeFile(filePath, '', 'utf-8');
    return { folderPath: parentFolderPath, filePath };
  }
}

/** A single entry in an AI conversation thread. */
export interface ThreadEntry {
  role: 'human' | 'ai';
  folderPath: string;
  filePath: string;
  fileName: string;
  modifiedTime: number;
  createdTime: number;
}

/**
 * A conversation branch folder directly underneath the folder being viewed.
 * These are the "A*" (AI) / "H*" (Human) folders that continue the thread
 * past the turn currently displayed.  When present, the user is viewing the
 * conversation somewhere in the middle rather than at its tail.
 */
export interface ThreadChildFolder {
  /** Role implied by the folder name's first character (H=human, A=ai) */
  role: 'human' | 'ai';
  /** Folder name (e.g. "A", "A1", "H") */
  name: string;
  /** Absolute path to the folder */
  path: string;
  /** Short preview snippet from the folder's HUMAN.md / AI.md, if any */
  aiHint?: string;
}

/** Matches conversation branch folder names: H, A, H1, A2, etc. */
const THREAD_CHILD_FOLDER_RE = /^[AH]\d*$/;

/**
 * List the conversation branch folders ("A*" / "H*") directly underneath
 * folderPath, sorted naturally by name.
 */
async function gatherThreadChildFolders(folderPath: string): Promise<ThreadChildFolder[]> {
  const childFolders: ThreadChildFolder[] = [];
  try {
    const dirents = await fs.readdir(folderPath, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.isDirectory() && THREAD_CHILD_FOLDER_RE.test(dirent.name)) {
        const childPath = path.join(folderPath, dirent.name);
        childFolders.push({
          role: dirent.name.startsWith('H') ? 'human' : 'ai',
          name: dirent.name,
          path: childPath,
          aiHint: await readAiHint(childPath, dirent.name),
        });
      }
    }
  } catch {
    // Folder unreadable — treat as having no children
  }
  childFolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return childFolders;
}

/**
 * Walk up the H/A folder hierarchy from folderPath, collecting
 * HUMAN.md / AI.md entries in chronological (top-down) order.  Also returns
 * any conversation branch folders ("A*" / "H*") directly underneath
 * folderPath so the caller can let the user drill deeper into the thread.
 */
export async function gatherThreadEntries(
  folderPath: string,
): Promise<{ isThread: boolean; entries: ThreadEntry[]; childFolders: ThreadChildFolder[] }> {
  // Check whether folderPath is part of a thread at all
  const humanFilePath = path.join(folderPath, 'HUMAN.md');
  const isHumanFolder = await fs.access(humanFilePath).then(() => true).catch(() => false);

  const aiFilePath = path.join(folderPath, 'AI.md');
  const isAIFolder = await fs.access(aiFilePath).then(() => true).catch(() => false);

  if (!isHumanFolder && !isAIFolder) {
    return { isThread: false, entries: [], childFolders: [] };
  }

  const entries: ThreadEntry[] = [];
  let walker = folderPath;
  let lastAddedRole: 'ai' | 'human' | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const walkerHumanFile = path.join(walker, 'HUMAN.md');
    const walkerIsHuman = await fs.access(walkerHumanFile).then(() => true).catch(() => false);

    const walkerAiFile = path.join(walker, 'AI.md');
    const walkerIsAI = await fs.access(walkerAiFile).then(() => true).catch(() => false);

    if (walkerIsAI) {
      try {
        const stat = await fs.stat(walkerAiFile);
        entries.unshift({
          role: 'ai',
          folderPath: walker,
          filePath: walkerAiFile,
          fileName: 'AI.md',
          modifiedTime: stat.mtimeMs,
          createdTime: stat.birthtimeMs,
        });
        lastAddedRole = 'ai';
      } catch {
        break;
      }
    } else if (walkerIsHuman) {
      // Two consecutive HUMAN.md files means we've hit the top of the conversation
      if (lastAddedRole === 'human') {
        break;
      }
      try {
        const stat = await fs.stat(walkerHumanFile);
        entries.unshift({
          role: 'human',
          folderPath: walker,
          filePath: walkerHumanFile,
          fileName: 'HUMAN.md',
          modifiedTime: stat.mtimeMs,
          createdTime: stat.birthtimeMs,
        });
        lastAddedRole = 'human';
      } catch {
        break;
      }
    } else {
      break;
    }

    walker = path.dirname(walker);
  }

  // Drill downward from folderPath: as long as there is exactly one
  // conversation branch folder, follow it and append its turn so the thread
  // also shows the future of the conversation.  Stop at a fork (multiple
  // branch folders mean we can't know which path to follow) or at the tail,
  // returning whatever branch folders remain as clickable choices.
  let childFolders = await gatherThreadChildFolders(folderPath);
  while (childFolders.length === 1) {
    const childPath = childFolders[0].path;

    const childAiFile = path.join(childPath, 'AI.md');
    const childIsAI = await fs.access(childAiFile).then(() => true).catch(() => false);

    const childHumanFile = path.join(childPath, 'HUMAN.md');
    const childIsHuman = await fs.access(childHumanFile).then(() => true).catch(() => false);

    let entry: ThreadEntry | null = null;
    try {
      if (childIsAI) {
        const stat = await fs.stat(childAiFile);
        entry = {
          role: 'ai',
          folderPath: childPath,
          filePath: childAiFile,
          fileName: 'AI.md',
          modifiedTime: stat.mtimeMs,
          createdTime: stat.birthtimeMs,
        };
      } else if (childIsHuman) {
        const stat = await fs.stat(childHumanFile);
        entry = {
          role: 'human',
          folderPath: childPath,
          filePath: childHumanFile,
          fileName: 'HUMAN.md',
          modifiedTime: stat.mtimeMs,
          createdTime: stat.birthtimeMs,
        };
      }
    } catch {
      // stat failed — treat as no turn file
    }

    // Folder has no turn file — leave it as a clickable child instead
    if (!entry) break;

    entries.push(entry);
    childFolders = await gatherThreadChildFolders(childPath);
  }

  return { isThread: true, entries, childFolders };
}
