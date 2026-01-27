/**
 * Detects timestamps in MM/DD/YYYY or MM/DD/YYYY HH:MM:SS AM/PM format
 * Returns the timestamp in milliseconds, or 0 if not found
 * 
 * @param content - The text content to search for timestamps
 * @returns Timestamp in milliseconds since epoch, or 0 if not found
 */
export function extractTimestamp(content: string): number {
  // Regex for MM/DD/YYYY HH:MM:SS AM/PM format (with optional time)
  const dateTimeRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM))?/i;
  const match = content.match(dateTimeRegex);
  
  if (match) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    
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
 * @returns True if the timestamp is in the past, false otherwise
 */
export function past(timestamp: number): boolean {
  // Treat 0 as invalid timestamp (not found)
  if (timestamp === 0) {
    return false;
  }
  
  const now = Date.now();
  return timestamp < now;
}

/**
 * Checks if a timestamp (in milliseconds) represents a time in the future
 * 
 * @param timestamp - The timestamp in milliseconds since epoch (0 is treated as invalid)
 * @returns True if the timestamp is in the future, false otherwise
 */
export function future(timestamp: number): boolean {
  // Treat 0 as invalid timestamp (not found)
  if (timestamp === 0) {
    return false;
  }
  
  const now = Date.now();
  return timestamp > now;
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
