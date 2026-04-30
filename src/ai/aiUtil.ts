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
import { ensureRunning } from '../llamaServer';
import { DEFAULT_AI_REWRITE_PERSONA, AI_REWRITE_PROMPT, AI_REWRITE_SELECTION_PROMPT } from './aiPrompts';
import { preprocessPrompt } from './promptPreprocess';
import { USE_DEEP_AGENTS, invokeDeepAgent, streamDeepAgent } from './deepAgent';
import { readIndexYaml } from '../utils/indexUtil';
import { invokeAI, streamAI, hasScriptedAnswer, type AIUsageInfo, type StreamCallbacks } from './langGraph';
import { logger } from '../utils/logUtil';

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
 * gather all prior conversation turns. Folders are expected
 * to contain HUMAN.md (if they're part of a thread), and the same is true for folders containing AI.md
 * Walking stops at the first folder whose name doesn't match either pattern.
 *
 * Returns messages in chronological order (oldest first), ready to pass as
 * the `history` parameter to `invokeAI` / `invokeAI`.
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
      // Folder doesn't match H{N} or A{N} — we've reached the conversation root
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

  // If the prompt contains images, verify the selected model supports vision
  if (processedPrompt.images.length > 0) {
    const config = getConfig();
    const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
    if (activeModel && !activeModel.vision) {
      return {
        error: `The selected model "${activeModel.name}" does not support images. Please select a vision-capable model or remove image files from your prompt.`,
      };
    }
  }

  // If using a LLAMACPP model, ensure the server is running before inference
  {
    const config = getConfig();
    const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
    if (activeModel?.provider === 'LLAMACPP') {
      await ensureRunning();
    }
  }

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

  if (streamCallbacks && !hasScriptedAnswer()) {
    // ── Streaming path ──
    logger.log("running streaming AI call");
    try {
      const result = USE_DEEP_AGENTS
        ? await streamDeepAgent(processedPrompt, history, streamCallbacks, signal)
        : await streamAI(processedPrompt, history, streamCallbacks, signal);
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
    const result = USE_DEEP_AGENTS
      ? await invokeDeepAgent(processedPrompt, history)
      : await invokeAI(processedPrompt, history);
    content = result.content;
    thinking = result.thinking;
    usage = result.usage;
  }

  // Record token usage if available
  if (usage) {
    const config = getConfig();
    const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
    const provider = activeModel?.provider ?? 'ANTHROPIC';
    recordUsage(provider, usage.input_tokens, usage.output_tokens);
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
 * Rewrite content using the configured AI rewrite prompt.
 * Returns the rewritten text and optional usage info.
 */
export async function handleRewriteContent(
  content: string,
  filePath: string,
  hasIndexFile: boolean,
): Promise<{ rewrittenContent: string; usage?: AIUsageInfo } | { error: string }> {
  // If using a LLAMACPP model, ensure the server is running before inference
  const config = getConfig();
  const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
  if (activeModel?.provider === 'LLAMACPP') {
    await ensureRunning();
  }

  // Resolve the rewrite prompt template
  const selectedPromptName = config.aiRewritePrompt;
  const namedPrompt = selectedPromptName
    ? (config.aiRewritePrompts ?? []).find((p) => p.name === selectedPromptName)
    : undefined;
  const personaPart = namedPrompt?.prompt ?? DEFAULT_AI_REWRITE_PERSONA;

  const { aboveContent, belowContent } = await buildDocumentContext(filePath, hasIndexFile);

  const prompt = {
    text: `${personaPart} ${AI_REWRITE_PROMPT}\n\n${aboveContent}<content>\n${content}\n</content>${belowContent}`,
    images: [] as never[],
    fileDirectivesFound: false,
  };

  const result = USE_DEEP_AGENTS
    ? await invokeDeepAgent(prompt)
    : await invokeAI(prompt);

  // Record token usage if available
  if (result.usage) {
    const provider = activeModel?.provider ?? 'ANTHROPIC';
    recordUsage(provider, result.usage.input_tokens, result.usage.output_tokens);
  }

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
): Promise<{ rewrittenContent: string; usage?: AIUsageInfo } | { error: string }> {
  // If using a LLAMACPP model, ensure the server is running before inference
  const config = getConfig();
  const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
  if (activeModel?.provider === 'LLAMACPP') {
    await ensureRunning();
  }

  // Resolve the rewrite prompt template
  const selectedPromptName = config.aiRewritePrompt;
  const namedPrompt = selectedPromptName
    ? (config.aiRewritePrompts ?? []).find((p) => p.name === selectedPromptName)
    : undefined;
  const personaPart = namedPrompt?.prompt ?? DEFAULT_AI_REWRITE_PERSONA;

  // Build content with <rewrite_region> tags wrapping the selected portion
  const textWithSelection =
    content.slice(0, selectionFrom) +
    '<rewrite_region>' +
    content.slice(selectionFrom, selectionTo) +
    '</rewrite_region>' +
    content.slice(selectionTo);

  const { aboveContent, belowContent } = await buildDocumentContext(filePath, hasIndexFile);

  const prompt = {
    text: `${personaPart} ${AI_REWRITE_SELECTION_PROMPT}\n\n${aboveContent}<content>\n${textWithSelection}\n</content>${belowContent}`,
    images: [] as never[],
    fileDirectivesFound: false,
  };

  const result = USE_DEEP_AGENTS
    ? await invokeDeepAgent(prompt)
    : await invokeAI(prompt);

  // Record token usage if available
  if (result.usage) {
    const provider = activeModel?.provider ?? 'ANTHROPIC';
    recordUsage(provider, result.usage.input_tokens, result.usage.output_tokens);
  }

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
 * Walk up the H/A folder hierarchy from folderPath, collecting
 * HUMAN.md / AI.md entries in chronological (top-down) order.
 */
export async function gatherThreadEntries(
  folderPath: string,
): Promise<{ isThread: boolean; entries: ThreadEntry[] }> {
  // Check whether folderPath is part of a thread at all
  const humanFilePath = path.join(folderPath, 'HUMAN.md');
  const isHumanFolder = await fs.access(humanFilePath).then(() => true).catch(() => false);

  const aiFilePath = path.join(folderPath, 'AI.md');
  const isAIFolder = await fs.access(aiFilePath).then(() => true).catch(() => false);

  if (!isHumanFolder && !isAIFolder) {
    return { isThread: false, entries: [] };
  }

  const entries: ThreadEntry[] = [];
  let walker = folderPath;

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
      } catch {
        break;
      }
    } else if (walkerIsHuman) {
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
      } catch {
        break;
      }
    } else {
      break;
    }

    walker = path.dirname(walker);
  }

  return { isThread: true, entries };
}
