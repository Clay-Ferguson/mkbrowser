# MkBrowser User Guide

MkBrowser is a file explorer designed for managing Markdown notes with inline rendering.

## Browsing and Editing

MkBrowser displays your files and folders in a single streamlined list.

### Viewing Content
- **Markdown Files**: Click on any `.md` file to expand it and view its rendered content directly in the list. You don't need to open a separate preview pane.
- **Images**: Click on image files to preview them inline.
- **Folders**: Click on a folder to navigate into it.

### Editing Files
When a Markdown file is expanded, you can edit its content:
1. Click the **Edit** button (pencil icon) in the top-right corner of the file card.
2. The view switches to a code editor where you can make changes.
3. Press `Save` button or use `Ctrl+S` / `Cmd+S` to save your changes.
4. Click the **Close** button (X icon) to return to the rendered view.

### Renaming
You can rename any file or folder:
- **Button**: Click the **Rename** button (pencil icon on the folder row) next to the item.
- **Double-click**: Double-click the file or folder name text.
- Enter the new name and press `Enter` to confirm, or `Esc` to cancel.

### File Operations (Cut, Copy, Paste, Delete)
You can manage your files using the application menu or keyboard shortcuts.
- **Selection**: 
    - Click the checkbox next to any file or folder to select it.
    - Select multiple items to perform batch operations.
    - Use **Select All** from the **Edit** menu to select all items in the current folder.
- **Delete**: 
    - Select items and click the **Trash** icon or press the `Delete` key.
- **Cut/Paste**:
    - Select items and choose **Cut** from the **Edit** menu to move files.
    - Navigate to the destination folder and choose **Paste**.

### Split and Join

MkBrowser provides **Split** and **Join** operations to help you break apart large files or combine multiple files into one. These features work with text (`.txt`) and Markdown (`.md`) files.

#### Split

The **Split** feature divides a single file into multiple smaller files using a double blank line as the delimiter.

**How to use Split:**

1. Click the checkbox next to the text or Markdown file you want to split (select exactly one file).
2. Go to **Edit → Split** in the menu bar.
3. The file will be divided at each occurrence of a **double blank line** (two consecutive empty lines).

**What happens:**

- The original file is renamed with a `-00` suffix (e.g., `my-notes.md` becomes `my-notes-00.md`).
- Each subsequent section becomes a new file with incrementing numbers: `my-notes-01.md`, `my-notes-02.md`, etc.
- The numbered suffixes ensure files sort alphabetically in the correct order.

**Example:**

If you have a file `chapter.md` with this content:

```
# Part One

This is the first section.


# Part Two

This is the second section.


# Part Three

This is the third section.
```

After splitting, you'll have three files:
- `chapter-00.md` containing "# Part One..."
- `chapter-01.md` containing "# Part Two..."
- `chapter-02.md` containing "# Part Three..."

**Requirements:**
- Exactly one file must be selected.
- The file must be a `.txt` or `.md` file.
- The file must contain at least one double blank line (the delimiter).

#### Join

The **Join** feature combines multiple files into a single file, inserting a double blank line between each file's content.

**How to use Join:**

1. Click the checkboxes next to two or more text or Markdown files you want to combine.
2. Go to **Edit → Join** in the menu bar.
3. The files will be merged into a single file.

**What happens:**

- Files are sorted alphabetically by filename before joining.
- The content of all files is concatenated with a **double blank line** (`\n\n\n`) separator between each file's content.
- The combined content is written to the alphabetically first file.
- The other files are deleted (only after verifying the write succeeded).

**Example:**

If you select these three files:
- `notes-00.md` (content: "First part")
- `notes-01.md` (content: "Second part")
- `notes-02.md` (content: "Third part")

After joining, only `notes-00.md` remains, containing:

```
First part


Second part


Third part
```

**Requirements:**
- At least two files must be selected.
- All selected items must be files (not folders).
- All files must be `.txt` or `.md` files.

**Safety:** The Join operation verifies that the combined content was written correctly by checking the file size before deleting the other files. This ensures no data is lost.

## Searching

MkBrowser includes a powerful search feature to help you find content across your notes.

### Using Search
1. Click the **Search** button in the toolbar or press `Ctrl+Shift+F`.
2. Enter your search query.
3. Choose your search options:
    - **Search Target**: Choose to search **File Content** or **File Names**.
    - **Search Mode**: 
        - **Literal**: Exact text match.
        - **Wildcard**: Use `*` to match any characters (e.g., `note-*.md`).
        - **Advanced**: Use custom predicate functions (see below).
    - **Search Scope**: Search inside **Entire File** or match specific **File Lines**.

### Advanced Search Predicates
In **Advanced Mode**, you can write JavaScript-like expressions to filter files. The following custom functions and variables are available:

*   **`$('text')`**: Returns `true` if the file content contains the text "text" (case-insensitive).
    *   Example: `$('important')` finds files containing "important".
*   **`ts`**: A pre-existing variable containing the first date/timestamp found in the file (format: MM/DD/YYYY). Returns a number representing the date in milliseconds, or 0 if no timestamp is found.
*   **`past(date, lookbackDays?)`**: Returns `true` if the date is in the past. The optional `lookbackDays` parameter limits results to timestamps within the specified number of days ago (e.g., `past(ts, 7)` matches timestamps from the last 7 days).
*   **`future(date, lookaheadDays?)`**: Returns `true` if the date is in the future. The optional `lookaheadDays` parameter limits results to timestamps within the specified number of days ahead (e.g., `future(ts, 30)` matches timestamps within the next 30 days).
*   **`today(date)`**: Returns `true` if the date is today.

**Examples:**
*   Find files with "TODO" that are due in the future:
    ```javascript
    $('#TODO') && future(ts)
    ```
*   Find files with "Meeting" that happened in the past:
    ```javascript
    $('#meeting') && past(ts)
    ```
*   Find files with "TODO" due within the next 7 days:
    ```javascript
    $('#TODO') && future(ts, 7)
    ```
*   Find files with "Review" from the last 30 days:
    ```javascript
    $('#review') && past(ts, 30)
    ```
*   Find files containing both "project" and "urgent":
    ```javascript
    $('#project') && $('#urgent')
    ```

### Saving Search Definitions
You can save frequently used searches for quick access later.

1. In the Search dialog, enter your search query and configure the options.
2. Type a name for your search in the **Search Name** field.
3. Click **Search** to execute and save the definition.

Once saved, your search definitions appear in the **Search** menu on the application's main menu bar (sorted alphabetically). Simply click a saved search to execute it immediately.

**Tip:** Hold **Ctrl** while clicking a search menu item to open the Search dialog with that definition pre-filled. This allows you to review the search parameters before running it, or to edit and update the saved definition.

## Replace in Files

MkBrowser includes a **Replace in Files** feature that allows you to find and replace text across all Markdown (`.md`) and text (`.txt`) files in the current folder and all subfolders.

### Using Replace in Files

1. Navigate to the folder where you want to perform the replacement.
2. Go to **Edit → Replace in Files** in the menu bar.
3. In the dialog that appears:
   - **Search for**: Enter the exact text you want to find.
   - **Replace with**: Enter the replacement text (can be empty to delete matches).
4. Click **Replace** to perform the replacement, or **Cancel** to close the dialog.

### What Happens

- The replacement searches recursively through all subfolders.
- Only `.md` and `.txt` files are processed.
- All occurrences of the search text are replaced (not just the first occurrence in each file).
- The search is **case-sensitive** and matches **exact text** only.
- Files configured in your **Ignored Paths** setting (see Settings) are skipped.

### Results Summary

After the replacement completes, a dialog will show you:
- The total number of replacements made.
- The number of files that were modified.
- If any files could not be processed, you'll see a count of failed files.

**Example:**
> "Replaced 15 occurrences in 4 files."

### Tips

- **Preview first**: Use the Search feature to find matches before replacing, so you know what will be changed.
- **Backup**: For large-scale replacements, consider backing up your folder first.
- **Special characters**: The search treats your text literally—special characters like `*`, `.`, or `?` are matched exactly as typed, not as wildcards or patterns.

## Folder Analysis

MkBrowser can analyze the contents of the current folder to provide useful statistics about your notes. Currently, the analysis extracts and counts all **hashtags** found across your Markdown and text files.

### Running an Analysis

1. Navigate to the folder you want to analyze.
2. Go to **Tools → Folder Analysis** in the menu bar.
3. The analysis will immediately scan all `.md` and `.txt` files recursively (including subfolders), then display the results in the **Analysis** view.

### What Gets Scanned

- All `.md` and `.txt` files in the current folder and all subfolders are included.
- Files and folders matching your **Ignored Paths** setting (see Settings) are skipped.
- The scan extracts hashtags — words starting with `#` followed by letters, numbers, underscores, or hyphens (e.g., `#project`, `#in-progress`, `#v2`).

### Analysis Results

The Analysis view shows:

- **Total files scanned**: The number of `.md` and `.txt` files that were processed.
- **Hashtag list**: Every unique hashtag found, sorted by frequency (most common first). Each entry shows the hashtag name and its total number of occurrences across all scanned files.

### The Analysis Tab

After running an analysis, an **Analysis** tab appears in the tab bar at the top of the application (alongside Browse, Search, and Settings). You can switch between tabs freely — the analysis results are preserved until you run a new analysis or close the application.

**Note:** The Analysis tab only appears after you've run at least one analysis. It is not shown on a fresh application start.

## Exporting

You can export the contents of the current folder into a single document.

1. Click the **Export** button in the toolbar.
2. Configure the export settings:
    - **Output Folder**: Choose where to save the exported file.
    - **File Name**: Name the output file.
    - **Include Subfolders**: Check this to include content from all subfolders recursively.
    - **Include File Names**: Adds the filename as a header before each file's content.
    - **Include Dividers**: Adds a visual separator between files.
    - **Export to PDF**: If checked, the application will attempt to generate a PDF file instead of a Markdown file.
3. Click **Export** to finish.
## LaTeX Math Support

MkBrowser supports rendering mathematical equations using LaTeX syntax via KaTeX, compatible with GitHub's math rendering.

### Syntax

- **Inline Math**: Wrap your equation in single dollar signs: `$equation$`
  - Example: `$f(x)$` renders as an inline formula
  
- **Block Math**: Use double dollar signs on separate lines for display equations:
  ````
  $$
  equation
  $$
  ````

### Escaping Dollar Signs for Currency

Since `$` is used for math delimiters, use the standard LaTeX escape `\$` to display literal dollar signs (e.g., for monetary values):

| You type | Renders as |
|----------|------------|
| `\$100` | $100 |
| `\$49.99` | $49.99 |
| `$x^2$` | *x²* (math) |

This is the same escape convention used in traditional LaTeX and is compatible with most Markdown-with-math systems.

### Example

Here's how to write the calculus limit definition:

````markdown
## Calculus Limit Definition

For a function $f(x)$, the derivative at a point $x$ is defined as:

$$
f'(x) = \lim_{h \to 0} \frac{f(x + h) - f(x)}{h}
$$

This course costs \$99.
````

**Rendered output:**

For a function $f(x)$, the derivative at a point $x$ is defined as:

$$
f'(x) = \lim_{h \to 0} \frac{f(x + h) - f(x)}{h}
$$

This course costs $99.