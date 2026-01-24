/**
 * Utility functions for ordinal numbering of files and folders.
 * 
 * Ordinal format: 5-digit zero-padded number followed by underscore
 * Example: "00010_", "00020_", "00030_"
 * 
 * Starting number: 10
 * Increment: 10
 */

/** Regex to match an existing ordinal prefix (e.g., "00010_") */
const ORDINAL_PREFIX_REGEX = /^\d{5}_/;

/** Regex to extract the ordinal number from a prefix */
const ORDINAL_NUMBER_REGEX = /^(\d{5})_/;

/**
 * Strip an existing ordinal prefix from a filename if present.
 * @param name The filename that may contain an ordinal prefix
 * @returns The filename without the ordinal prefix
 */
export function stripOrdinalPrefix(name: string): string {
  return name.replace(ORDINAL_PREFIX_REGEX, '');
}

/**
 * Check if a filename has an ordinal prefix.
 * @param name The filename to check
 * @returns True if the filename starts with an ordinal prefix
 */
export function hasOrdinalPrefix(name: string): boolean {
  return ORDINAL_PREFIX_REGEX.test(name);
}

/**
 * Extract the ordinal number from a filename.
 * @param name The filename to extract from
 * @returns The ordinal number, or null if no ordinal prefix exists
 */
export function extractOrdinal(name: string): number | null {
  const match = name.match(ORDINAL_NUMBER_REGEX);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Get the next ordinal prefix for inserting a new item below the given item.
 * @param name The filename of the current item
 * @returns The next ordinal prefix (e.g., "00011_"), or null if no ordinal prefix exists
 */
export function getNextOrdinalPrefix(name: string): string | null {
  const ordinal = extractOrdinal(name);
  if (ordinal === null) return null;
  return formatOrdinalPrefix(ordinal + 1);
}

/**
 * Format a number as a 5-digit zero-padded ordinal prefix.
 * @param ordinal The ordinal number (e.g., 10, 20, 30)
 * @returns The formatted prefix string (e.g., "00010_")
 */
export function formatOrdinalPrefix(ordinal: number): string {
  return ordinal.toString().padStart(5, '0') + '_';
}

/**
 * Represents a rename operation to be performed.
 */
export interface RenameOperation {
  /** Original full path of the file/folder */
  oldPath: string;
  /** New full path after renaming */
  newPath: string;
  /** Original filename (for display/debugging) */
  oldName: string;
  /** New filename (for display/debugging) */
  newName: string;
}

/**
 * Calculate the rename operations needed to apply ordinal numbering to a list of items.
 * Items are processed in the order provided (should be alphabetically sorted).
 * 
 * @param items Array of items with name and path properties, in desired order
 * @param dirPath The directory path containing the items
 * @returns Array of rename operations to perform
 */
export function calculateRenameOperations(
  items: Array<{ name: string; path: string }>,
  dirPath: string
): RenameOperation[] {
  const operations: RenameOperation[] = [];
  let ordinal = 10; // Start at 10

  for (const item of items) {
    // Strip any existing ordinal prefix
    const baseName = stripOrdinalPrefix(item.name);
    
    // Create the new name with ordinal prefix
    const newName = formatOrdinalPrefix(ordinal) + baseName;
    
    // Only add to operations if the name actually changes
    if (item.name !== newName) {
      operations.push({
        oldPath: item.path,
        newPath: `${dirPath}/${newName}`,
        oldName: item.name,
        newName,
      });
    }

    ordinal += 10; // Increment by 10
  }

  return operations;
}
