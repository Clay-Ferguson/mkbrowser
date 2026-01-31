const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Detects timestamps in MM/DD/YYYY, MM/DD/YY, or with HH:MM:SS AM/PM format
 * Two-digit years are interpreted as 2000+YY (e.g., "26" becomes "2026")
 * Returns the timestamp in milliseconds, or 0 if not found
 * 
 * @param content - The text content to search for timestamps
 * @returns Timestamp in milliseconds since epoch, or 0 if not found
 */
export function extractTimestamp(content: string): number {
  // Regex for MM/DD/YYYY or MM/DD/YY HH:MM:SS AM/PM format (with optional time)
  const dateTimeRegex = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM))?/i;
  const match = content.match(dateTimeRegex);
  
  if (match) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);
    
    // Convert 2-digit year to 4-digit (assumes 2000s)
    if (year < 100) {
      year += 2000;
    }
    
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    
    if (match[4]) {
      // Time part exists
      hours = parseInt(match[4], 10);
      minutes = parseInt(match[5], 10);
      seconds = parseInt(match[6], 10);
      const ampm = match[7]?.toUpperCase();
      
      // Convert to 24-hour format
      if (ampm === 'PM' && hours !== 12) {
        hours += 12;
      } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
      }
    }
    
    // Create Date object (month is 0-indexed in JavaScript)
    const date = new Date(year, month - 1, day, hours, minutes, seconds);
    const timestamp = date.getTime();
    
    return timestamp;
  }
  
  return 0;
}

/**
 * Checks if a timestamp (in milliseconds) represents a time in the past
 * 
 * @param timestamp - The timestamp in milliseconds since epoch (0 is treated as invalid)
 * @param lookbackDays - Optional number of days to look back from now
 * @returns True if the timestamp is in the past (and within lookbackDays, if provided), false otherwise
 */
export function past(timestamp: number, lookbackDays?: number): boolean {
  // Treat 0 as invalid timestamp (not found)
  if (timestamp === 0) {
    return false;
  }
  
  const now = Date.now();
  if (lookbackDays === undefined) {
    return timestamp < now;
  }

  const maxLookbackMs = lookbackDays * MS_PER_DAY;
  const cutoff = now - maxLookbackMs;
  return timestamp < now && timestamp >= cutoff;
}

/**
 * Checks if a timestamp (in milliseconds) represents a time in the future
 * 
 * @param timestamp - The timestamp in milliseconds since epoch (0 is treated as invalid)
 * @param lookaheadDays - Optional number of days to look ahead from now
 * @returns True if the timestamp is in the future (and within lookaheadDays, if provided), false otherwise
 */
export function future(timestamp: number, lookaheadDays?: number): boolean {
  // Treat 0 as invalid timestamp (not found)
  if (timestamp === 0) {
    return false;
  }
  
  const now = Date.now();
  if (lookaheadDays === undefined) {
    return timestamp > now;
  }

  const maxLookaheadMs = lookaheadDays * MS_PER_DAY;
  const cutoff = now + maxLookaheadMs;
  return timestamp > now && timestamp <= cutoff;
}

/**
 * Checks if a timestamp (in milliseconds) represents today's date
 * 
 * @param timestamp - The timestamp in milliseconds since epoch (0 is treated as invalid)
 * @returns True if the timestamp's date matches today's date, false otherwise
 */
export function today(timestamp: number): boolean {
  // Treat 0 as invalid timestamp (not found)
  if (timestamp === 0) {
    return false;
  }
  
  const now = new Date();
  const checkDate = new Date(timestamp);
  
  return (
    now.getFullYear() === checkDate.getFullYear() &&
    now.getMonth() === checkDate.getMonth() &&
    now.getDate() === checkDate.getDate()
  );
}
