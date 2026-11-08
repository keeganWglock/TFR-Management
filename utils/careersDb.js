import fs from 'node:fs';
import path from 'node:path';
import { DATABASE_DIR } from './paths.js';

// database/careers.json -> { "pending": { "<userId>": { "messageId": "...", "at": 1700000000000 } } }
// Used so a person can't have more than one application waiting for review.
const FILE = path.join(DATABASE_DIR, 'careers.json');

function read() {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  let data = {};
  if (fs.existsSync(FILE)) {
    try {
      const raw = fs.readFileSync(FILE, 'utf8');
      data = raw.trim() ? JSON.parse(raw) : {};
    } catch (error) {
      const backup = `${FILE}.corrupt-${Date.now()}`;
      console.error(`[CAREERS DB] Unreadable, backed up to ${backup}:`, error);
      try {
        fs.renameSync(FILE, backup);
      } catch (renameError) {
        console.error('[CAREERS DB] Backup failed:', renameError);
      }
      data = {};
    }
  }
  if (!data.pending || typeof data.pending !== 'object') data.pending = {};
  return data;
}

function write(data) {
  const temp = `${FILE}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, FILE);
  } catch (error) {
    console.error('[CAREERS DB] Write failed:', error);
  }
}

// The user's waiting application, or null. Entries older than `expiryMs` are dropped.
export function getPending(userId, expiryMs) {
  const data = read();
  const entry = data.pending[userId];
  if (!entry) return null;
  if (Date.now() - entry.at > expiryMs) {
    delete data.pending[userId];
    write(data);
    return null;
  }
  return entry;
}

export function setPending(userId, messageId) {
  const data = read();
  data.pending[userId] = { messageId, at: Date.now() };
  write(data);
}

export function clearPending(userId) {
  const data = read();
  if (data.pending[userId]) {
    delete data.pending[userId];
    write(data);
  }
}
