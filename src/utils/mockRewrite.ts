/**
 * POC mock rewrite function that applies simple text transformations.
 * In a real implementation, this would be replaced by an AI rewrite call.
 */
export function mockRewrite(text: string): string {
  let result = text;
  // Fix common typo: "teh" -> "the"
  result = result.replace(/\bteh\b/g, 'the');
  // Capitalize proper noun: "texas" -> "Texas"
  result = result.replace(/\btexas\b/gi, 'Texas');
  // Remove marker text
  result = result.replace(/\[delete this\]/g, '');
  // Append a new last line
  result = result + '\nmy new last line';
  return result;
}
