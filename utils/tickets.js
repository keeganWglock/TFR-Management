import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { DATABASE_DIR } from './paths.js';

// Ticket records live in database/tickets.json:
// { "tickets": { "<channelId>": { guildId, owner, supportId, claimedBy } }, "usedIds": ["Support-12345", ...] }
// usedIds is never cleared, so a Support ID can never be handed out twice.
const FILE = path.join(DATABASE_DIR, 'tickets.json');

function read() {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  let data = {};
  if (fs.existsSync(FILE)) {
    try {
      const raw = fs.readFileSync(FILE, 'utf8');
      data = raw.trim() ? JSON.parse(raw) : {};
    } catch (error) {
      const backup = `${FILE}.corrupt-${Date.now()}`;
      console.error(`[TICKET DB] Unreadable, backed up to ${backup}:`, error);
      try {
        fs.renameSync(FILE, backup);
      } catch (renameError) {
        console.error('[TICKET DB] Backup failed:', renameError);
      }
      data = {};
    }
  }
  if (!data.tickets || typeof data.tickets !== 'object') data.tickets = {};
  if (!Array.isArray(data.usedIds)) data.usedIds = [];
  return data;
}

function write(data) {
  const temp = `${FILE}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, FILE);
  } catch (error) {
    console.error('[TICKET DB] Write failed:', error);
  }
}

export function getTicket(channelId) {
  return read().tickets[channelId] ?? null;
}

export function saveTicket(channelId, ticket) {
  const data = read();
  data.tickets[channelId] = ticket;
  write(data);
}

// Merges extra fields (e.g. Roblox info) into an existing ticket record.
export function updateTicket(channelId, patch) {
  const data = read();
  if (!data.tickets[channelId]) return;
  Object.assign(data.tickets[channelId], patch);
  write(data);
}

export function removeTicket(channelId) {
  const data = read();
  if (data.tickets[channelId]) {
    delete data.tickets[channelId];
    write(data);
  }
}

// Marks a ticket as claimed. Returns { ok: true } or { ok: false, claimedBy }.
// Read -> change -> write has no awaits, so two simultaneous claims can't both win.
export function claimTicketInDb(channelId, userId) {
  const data = read();
  const ticket = data.tickets[channelId];
  if (!ticket) return { ok: false, claimedBy: null };
  if (ticket.claimedBy) return { ok: false, claimedBy: ticket.claimedBy };
  ticket.claimedBy = userId;
  write(data);
  return { ok: true, claimedBy: userId };
}

// The user's open ticket channel in this guild, if any. Records whose channel no longer exists are dropped.
export function findOpenTicketByOwner(guild, ownerId) {
  const data = read();
  let changed = false;
  let found = null;
  for (const [channelId, ticket] of Object.entries(data.tickets)) {
    if (ticket.guildId !== guild.id) continue;
    if (!guild.channels.cache.has(channelId)) {
      delete data.tickets[channelId];
      changed = true;
      continue;
    }
    if (ticket.owner === ownerId) found = channelId;
  }
  if (changed) write(data);
  return found;
}

// Creates a random "Support-#####" ID that has never been used before.
export function generateSupportId() {
  const data = read();
  const used = new Set(data.usedIds);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = `Support-${randomInt(10000, 100000)}`;
    if (!used.has(id)) {
      data.usedIds.push(id);
      write(data);
      return id;
    }
  }
  throw new Error('No unused Support IDs are left.');
}
