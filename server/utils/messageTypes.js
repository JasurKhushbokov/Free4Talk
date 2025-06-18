/**
 * Classifies Zoom chat messages into types
 * @param {string} message - The chat message to classify
 * @returns {'chat'|'command'|'event'|'file_share'|'reaction'} - The message type
 */
function getMessageType(message) {
  // Check for commands (starts with '/')
  if (message.startsWith('/')) {
    return 'command';
  }

  // Check for system events (common patterns)
  const eventPatterns = [
    /joined (the )?meeting/i,
    /left (the )?meeting/i,
    /(has )?entered the room/i,
    /(has )?exited the room/i
  ];
  if (eventPatterns.some(pattern => pattern.test(message))) {
    return 'event';
  }

  // Check for file shares
  const filePatterns = [
    /uploaded file/i,
    /shared file/i,
    /\.(pdf|docx?|xlsx?|pptx?|txt|zip|rar|jpg|png|gif)\b/i
  ];
  if (filePatterns.some(pattern => pattern.test(message))) {
    return 'file_share';
  }

  // Check for reactions (only emojis or common reactions)
  const reactionPattern = /^(\p{Emoji}|\+\d|👍|👎|😂|😊|🎉|🙌)+$/u;
  if (reactionPattern.test(message.trim())) {
    return 'reaction';
  }

  // Default to normal chat
  return 'chat';
}

module.exports = { getMessageType };
