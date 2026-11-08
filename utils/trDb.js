import fs from 'node:fs';
import path from 'node:path';
import { DATABASE_DIR } from './paths.js';

// database/tr.json -> { "requests": { "<messageId>": { userId, date, time, notes, createdAt, acceptedBy } } }
const FILE = path.join(DATABASE_DIR, 'tr.json');

function read() {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  let data = {};
  if (fs.existsSync(FILE)) {
    try {
      const raw = fs.readFileSync(FILE, 'utf8');
      data = raw.trim() ? JSON.parse(raw) : {};
    } catch (error) {
      const backup = `${FILE}.corrupt-${Date.now()}`;
      console.error(`[TR DB] Unreadable, backed up to ${backup}:`, error);
      try {
        fs.renameSync(FILE, backup);
      } catch (renameError) {
        console.error('[TR DB] Backup failed:', renameError);
      }
      data = {};
    }
  }
  if (!data.requests || typeof data.requests !== 'object') data.requests = {};
  return data;
}

function write(data) {
  const temp = `${FILE}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, FILE);
  } catch (error) {
    console.error('[TR DB] Write failed:', error);
  }
}

export function getRequest(messageId) {
  return read().requests[messageId] ?? null;
}

export function saveRequest(messageId, request) {
  const data = read();
  data.requests[messageId] = { ...request, createdAt: Date.now(), acceptedBy: null };
  write(data);
}

// True if this user has a request nobody has accepted yet (and it isn't older than expiryMs).
export function hasOpenRequest(userId, expiryMs) {
  return Object.values(read().requests).some(
    (r) => r.userId === userId && !r.acceptedBy && Date.now() - r.createdAt < expiryMs,
  );
}

// Marks a request as accepted. Returns { ok: true, request } or { ok: false, acceptedBy }.
// Read -> change -> write has no awaits, so two FTOs clicking together can't both win.
export function acceptRequest(messageId, ftoId) {
  const data = read();
  const request = data.requests[messageId];
  if (!request) return { ok: false, acceptedBy: null, missing: true };
  if (request.acceptedBy) return { ok: false, acceptedBy: request.acceptedBy };
  request.acceptedBy = ftoId;
  write(data);
  return { ok: true, request };
}
