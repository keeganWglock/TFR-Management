import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './paths.js';

// Returns the config block for a guild from config/serversConfig.json, or null.
// Re-read on every call so edits apply without restarting the bot.
export function getGuildConfig(guildId) {
  const filePath = path.join(CONFIG_DIR, 'serversConfig.json');
  try {
    const all = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return all[guildId] ?? null;
  } catch (error) {
    console.error(`[CONFIG] Could not read config/serversConfig.json: ${error.message}`);
    return null;
  }
}
