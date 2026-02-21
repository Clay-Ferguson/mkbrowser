
The parent folder's name is always the predecessor in the lineage — no ambiguity, no manifest needed.

### System Prompt & Configuration

A `SYSTEM.md` file at the conversation root defines the system prompt. Configuration (model, temperature, provider) can follow an inheritance model — defined at the root and optionally overridden in child folders.

---

## Implementation Approach

### The AI Maintains Its Own Structure

Rather than writing extensive code to manage the conversation folder structure, the system prompt will describe the folder conventions to the AI. The AI is given file/folder creation and editing tools and manages the structure itself.

MkBrowser's implementation responsibilities are limited to:

1. **System prompt setup** — Describe the H/A folder convention, file naming rules, and the AI's role in maintaining structure
2. **Tool provisioning** — Provide file creation, folder creation, and file editing tools (scoped to the response folder)
3. **Context assembly** — Walk up parent folders to reconstruct the conversation for each request
4. **Submit UI** — A button that triggers context assembly and LLM invocation
5. **Response capture** — The LLM's API response text is a success/fail status; the actual content is written to files by the AI via tools

### Tech Stack

- **LangChain.js** — LLM abstraction, tool calling, structured output
- **Electron main process** — All AI/filesystem operations run in main, exposed to renderer via IPC
- **Sandboxed tools** — AI file operations are restricted to writing within its designated `A` response folder only

---

## Benefits of This Design

### 1. Complete Transparency
Conversations are plain files and folders. No database, no proprietary format. Inspect any conversation with `ls` and `cat`. Nothing is hidden.

### 2. Full Portability
Archive a conversation with `tar` or `zip`. Copy it to another machine. Email it. Put it on a USB drive. No export step needed — the filesystem IS the format.

### 3. Git-Native Version Control
Every conversation is diffable, branchable, and recoverable with standard Git. You get full history for free. Teams can collaborate on conversations via pull requests.

### 4. Rich Artifact Responses
The AI's response isn't trapped in a text box. It can be an entire project structure — source code, tests, documentation, configuration files. Ask "build me a React component with tests" and get a folder you can immediately run.

### 5. Natural Multi-Agent Support
Branching (sibling `A`, `A1`, `A2` folders) makes multi-agent workflows native rather than bolted-on. Send the same prompt to Claude and GPT-4, get separate response folders, compare them side-by-side.

### 6. Consensus Systems
A third AI agent can be given two sibling response folders and asked to evaluate, compare, or synthesize them. The multi-agent branching structure makes this architecturally natural.

### 7. Branching Visibility at a Glance
Listing a directory immediately reveals whether a conversation branched. Seeing `A` and `A1` means two agent replies exist. Seeing `H` and `H1` means the human rephrased. No metadata needed to detect this.

### 8. Conversation Search Across Threads
MkBrowser's existing search infrastructure (literal, wildcard, advanced modes) works immediately across all conversations. "Find every time Claude suggested using a factory pattern" is just a content search over `RESPONSE.md` files.

### 9. Conversation Forking
"I liked where this was going at turn 5 but turn 7 went off the rails" — copy turns 1–5 into a new conversation root and continue. Filesystem copy makes this trivial.

### 10. Human-Readable Without MkBrowser
Even without the application, conversations are fully navigable and readable in any file manager or terminal. The design degrades gracefully to the simplest possible tools.

### 11. Minimal Path Depth (H/A Convention)
Single-character folder names maximize the number of turns before hitting filesystem path limits. Linear conversations use bare `H`/`A` (zero overhead). Numbering only appears when branching actually occurs, costing characters only when disambiguation is genuinely needed.

### 12. Implicit Ordering
The parent-child relationship encodes turn order. Walking `..` from any folder reconstructs the exact conversation lineage without ambiguity — no manifest file needed for linear threads.

### 13. Self-Organizing via System Prompt
The AI maintains the conversation structure itself via tools, guided by the system prompt. This minimizes custom code and lets the protocol evolve by editing a prompt rather than rewriting application logic.

### 14. Attachment-Native
Multimodal prompts are natural — drop images, PDFs, or any files alongside `PROMPT.md` and they're included in the prompt. No special upload UI needed.

### 15. Replay and Export
A flattener can walk the folder tree and produce a single Markdown document (for sharing), or convert to OpenAI/Anthropic conversation format (for fine-tuning or migration).

---

## Future Considerations

### Context Window Management
As conversations grow, older turns may need summarization rather than verbatim inclusion. Strategies include:
- Automatic summarization of turns beyond a configurable depth
- Selective `@include` directives in `PROMPT.md` to reference specific earlier artifacts
- File inclusion policies to avoid re-sending large attachments from earlier turns

### Streaming and Progress Visibility  
While the AI writes its response to files, the user needs real-time feedback:
- Stream conversational text to a temporary `_STREAMING.md` that updates live, finalized to `RESPONSE.md` on completion
- Show a progress panel displaying the raw LLM stream during tool execution

### Atomic Response Creation
If the process crashes mid-response, a partial turn folder could result. Writing to a temporary `_A_pending/` folder and renaming to `A/` on completion ensures atomicity.

### Sandboxing and Validation
- AI file tools must be scoped to only write within the designated response folder — never to parent or sibling turns
- Post-completion validation should verify `RESPONSE.md` exists and the folder structure conforms to convention
- The raw API response should always be captured independently, not relying solely on the AI writing `RESPONSE.md`

### Cost Tracking
Turn metadata (model used, token count, cost, timestamp) can be stored in a small metadata file per turn, enabling a cost dashboard view in MkBrowser.

### Thread View
A flat, scrollable chat-like rendering of the conversation — synthesized on the fly from the folder structure — would give casual users a familiar experience while power users work directly in the folder view.