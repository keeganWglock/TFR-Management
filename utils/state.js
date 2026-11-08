// Message IDs the bot deletes on purpose (e.g. the "-say" command message).
// The server logger skips these so they don't spam the log channel.
export const ignoredDeletes = new Set();
