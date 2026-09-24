# Search Code Review

Review of the search features (Search dialog, `searchFolder`, saved searches, results view, hashtag search, Search and Replace).
Items marked **(confirmed)** were checked by running `searchFolder` against small test folders; the rest come from reading the code.

Mark items done by changing `[ ]` to `[*]`.

## Bugs, most important first

- [*] **1. A multi-line query is flattened to one line before it is searched (confirmed).**
  `executeSearch` (`src/renderer/searchUtil.ts:42`) turns each `{{nl}}` into a space before sending the query.
  - **Literal search:** a two-line query can never match two-line text in a file. The probe searched for `one⏎line` in a file containing `one⏎line` and got 0 results.
  - **Advanced search:** a `//` comment on one line now comments out everything after it. The probe ran `$('hello') // c` + newline + `|| $('line')` and matched only the `hello` file. The `|| $('line')` half was silently ignored. `advancedQuery.ts:91-96` guards against this for a comment on the last line, but this decoding step brings the problem back for comments on earlier lines.
  - The results header also shows the raw `{{nl}}` tokens, because the store keeps `definition.searchText`.

- [*] **2. Search errors look like "No results found".**
  The `search-folder` handler (`src/main.ts:619-626`) catches every error and returns `[]`. So an advanced query that times out (the case the `AdvancedQueryTimeoutError` code is built for) just shows an empty result list. So does an advanced query with a syntax error (`search.ts:166-173`), and so does any unexpected failure. The comment on `executeSearch` says it "throws whatever the IPC call throws; callers report it", and every caller has a `'Search failed: '` error path, but none of those paths can ever run.

- [*] **3. When there are more than 500 hits, the user's sort order doesn't decide which 500 are kept.**
  `searchFolder` sorts by name-match first, then match count, then keeps the top 500 (`search.ts:712-714`). The renderer re-sorts those 500 by the chosen time or name. So a broad search sorted "newest first" can quietly drop the newest files. The UI shows "500 files found" and gives no sign that anything was cut off.

- [*] **4. "Recent Files" treats file-name hits differently from content hits.**
  In content mode, file-name hits are removed from the list before the "500 newest" trim (`search.ts:602-610`). They are only trimmed by date when there are more than 500 of them (`:623`). So a Recent Files search returns name matches from anywhere in the tree, however old, while content matches are limited to recent files. Also, the 500 newest files are chosen after the name hits have been removed, so the content half can reach past the true 500 newest files.

- [*] **5. Editing a saved search with an empty query fills in unrelated text.**
  `SearchDialog.tsx:69-71` treats an empty saved query as "no initial value" and falls back to the global highlight text. So opening a saved Recent Files search (empty text) shows your last literal search instead. Because a search with a name auto-saves (next item), clicking Search also overwrites the saved definition with that text.

- [*] **6. Clicking Search silently overwrites a saved search.**
  When the name field isn't empty, `handleSearch` saves before running (`BrowseView.tsx:680-683`). Load a saved search, tweak it for a one-off run, click Search, and the saved version is replaced with no confirmation.

- [*] **7. Overlapping searches can show the wrong results.**
  `executeSearch` has no way to tell an old request from a new one. If a slow search A finishes after a newer search B (a new search, a refresh, or a hashtag click), A's results and definition overwrite B's.

## Smaller bugs

- [*] **Full-path ignore patterns don't work for folders (confirmed).** fdir gives directory paths with a trailing `/` (`/x/sub/`), and the patterns are anchored, so an entry `/x/sub` never matches. The probe still returned `sub/c.md`. Matching by name works. The Settings text only promises names, but `buildExcludePredicate` says it matches full paths too. This affects every tool that crawls folders, not just search.
- [ ] **Ctrl-click on a hashtag doesn't do a whole-tag match.** `App.tsx:395` says it does, but `$("#foo")` is a case-insensitive substring match, so it also matches `#foobar`. The only real difference from a normal click is that it skips file-name matches.
- [*] **A search with zero results hides its own tab.** The results tab only appears when there are results (`AppTabButtons.tsx:92`), so the search switches to a view with no tab. Deleting the last result hides the tab the same way. Also, a Recent Files search with an empty query and no results shows "No search yet", because `hasSearched` needs either a query or results (`SearchResultsView.tsx:99`).
- [ ] **Folder and binary results offer Edit.** File Names mode returns folders, and name matching returns `.pdf`/`.zip` files. They get the same Edit button and document icon as notes. Clicking Edit on a folder asks the app to open it for editing (`setPendingEditFile`). Not yet checked what that does in practice.
- [ ] **Search and Replace disagree on case.** Search ignores case; Replace (`searchAndReplace.ts:87`) matches it exactly. Previewing with Search and then running Replace can give different counts.
- [ ] **Wildcard in File Names mode isn't anchored.** `*.md` also matches `notes.md.bak`, and `a*` matches any name containing an "a". Most people expect glob behaviour when matching file names.
- [ ] **Delete confirms even when no saved search has that name.** The Delete button asks for confirmation for whatever name is typed, whether or not a saved search exists with it.
- [*] **Blank lines in a query collapse.** Consecutive newlines become a single `{{nl}}`, so blank lines are lost on save.

- [*] **An advanced-query timeout blocked the main process for ~30 seconds, not 1.** (Found while fixing bug 2.) After the first file timed out, each of the up to 32 files already being read still ran the query for its own full 1s timeout. The predicate now fails immediately after the first timeout.

## Stale docs and comments

- [ ] `AGENTS.md` names `src/services/api.ts` and `src/types/shared.ts`. Neither exists; the real files are `src/renderer/api.ts` and `src/shared/shared.ts`, and the `vi.mock` path it gives is wrong for the same reason.
- [*] `main.ts:594`: the comment "Search folder recursively…" sits above the `open-external` handler.
- [ ] `SearchResultsView.tsx:75` has a leftover `// console.log`.

## Simplification and architecture suggestions

- [*] **1. Drop the `{{nl}}` encoding.** The config file can store newlines in a string, so save and send the query exactly as typed. That fixes bug 1 at its source and removes the encode/decode code in three places.
- [ ] **2. Fix the swapped names.** `SearchDefinition.searchMode` holds literal/wildcard/advanced, while the dialog's `searchMode` holds content/filenames (which the definition calls `searchTarget`). Pick one pair, such as `matchType` and `target`, and use it everywhere. The type unions are also copied in five places: `SearchDialog.tsx:16-19`, `main/search.ts:114-115`, inline in `preload.ts` and `main.ts`, and `shared.ts`. Import them from `shared.ts` only.
- [ ] **3. Make the dialog work with a `SearchDefinition` directly.** Right now `BrowseView` converts `SearchOptions` to a `SearchDefinition` twice (`handleSearch`, `handleSaveSearchDefinition`), and back again in `handleEditSearch` and `handleSelectSearchDefinition`. That's four hand-written field-by-field copies, and each new option has to be added to all of them.
- [ ] **4. Pass an options object instead of 8 arguments.** Change `searchFolder` and the IPC call to `searchFolder(folder, def)`, and have the handler return `{ results, truncated, error? }`. That fixes bugs 2 and 3 and lets the UI show "showing 500 of N".
- [*] **5. Simplify the content branch of `searchFolder` (`search.ts:538-701`).** It currently has the calendar pre-pass, a name pass, two separate recent-file trims and three places that build `statCache`. A straight pipeline would do the same job: crawl, then calendar filter, then one recent-file trim over all candidates, then match on name and content. It's easier to follow, fixes bug 4, and only adds a stat of files that are already being stat'd.
- [*] **6. Sort once, in the main process, before the cut-off**, using the user's `sortBy`/`sortDirection`. The renderer's sort can then go, or move to a tested pure function in `shared/`.
- [*] **7. Add a request token or generation counter** to `executeSearch`, and ignore results from older requests (fixes bug 7).
- [ ] **8. Small cleanups:**
  - [ ] `wildcardToRegex` builds a regex with the `i` flag only for `search.ts:201` to rebuild it with `gi`. Build it once.
  - [ ] `globalHighlight.escapeRegExp` duplicates `escapeRegexLiteral` in `pathPattern.ts`.
  - [*] `setSearchResults` takes 6 positional parameters. (Replaced by `setSearchOutcome` and `removeSearchResult`.)

## What looks solid

The `node:vm` sandbox, the size limit and error handling on file reads, the concurrency limit, the guards against empty queries hanging, and the UTF-8 safety check in Search and Replace.

## Suggested order

Fix bugs 1, 2 and 5 first: they're the ones that silently return wrong results or change saved data. Suggestions 1 and 4 cover most of them.
