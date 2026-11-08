import fs from 'node:fs';
import path from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { DATABASE_DIR } from './paths.js';
import { loadTemplate } from './components.js';

// ---------------------------------------------------------------------------
// FEEDBACK SETTINGS - edit these
// ---------------------------------------------------------------------------
// Channel where finished feedback is posted (the sticky message also lives here).
export const FEEDBACK_CHANNEL_ID = '1568080563988992071';
// Star emoji. Use the custom emoji's ID and name; leave the ID as-is to fall back to ⭐.
export const STAR_EMOJI_ID = 'PASTE_STAR_EMOJI_ID_HERE';
export const STAR_EMOJI_NAME = 'star';
export const STAR_EMOJI_ANIMATED = false;

export const PANEL_FILE = 'feedbackpanelmessage.json';
export const SEND_FILE = 'feedbacksend.json';
export const STICKY_FILE = 'feedbackstickymessage.json';

export const isValidId = (id) => /^\d{17,20}$/.test(String(id));

export function starEmoji() {
  if (!isValidId(STAR_EMOJI_ID)) return '⭐';
  return `<${STAR_EMOJI_ANIMATED ? 'a' : ''}:${STAR_EMOJI_NAME}:${STAR_EMOJI_ID}>`;
}

// ---------------------------------------------------------------------------
// Ratings database: database/feedback-<guildId>.json
// { "<employeeId>": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } }
// ---------------------------------------------------------------------------
const dbFile = (guildId) => path.join(DATABASE_DIR, `feedback-${guildId}.json`);

export function readRatings(guildId) {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  const file = dbFile(guildId);
  if (!fs.existsSync(file)) return {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`;
    console.error(`[FEEDBACK DB] Unreadable, backed up to ${backup}:`, error);
    try {
      fs.renameSync(file, backup);
    } catch (renameError) {
      console.error('[FEEDBACK DB] Backup failed:', renameError);
    }
    return {};
  }
}

function writeRatings(guildId, data) {
  const file = dbFile(guildId);
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, file);
  } catch (error) {
    console.error('[FEEDBACK DB] Write failed:', error);
  }
}

export function getCounts(guildId, employeeId) {
  const entry = readRatings(guildId)[employeeId] ?? {};
  const counts = {};
  for (let star = 1; star <= 5; star++) counts[star] = Number(entry[star]) || 0;
  return counts;
}

// Read -> change -> write with no awaits in between, so simultaneous submissions can't clash.
export function addRating(guildId, employeeId, stars) {
  const db = readRatings(guildId);
  const entry = db[employeeId] ?? {};
  for (let star = 1; star <= 5; star++) entry[star] = Number(entry[star]) || 0;
  entry[stars] += 1;
  db[employeeId] = entry;
  writeRatings(guildId, db);
}

// ---------------------------------------------------------------------------
// Feedback message (data/feedbacksend.json)
// ---------------------------------------------------------------------------
// Fills the Employee / Rating / Feedback / Service lines, drops the Service line when it is
// empty, replaces the "sent by" placeholder, and adds a "View Ratings" button under the text.
export async function buildFeedbackMessage({ employeeId, stars, feedback, service, signedBy }) {
  const components = await loadTemplate(SEND_FILE);
  const values = {
    Employee: `<@${employeeId}>`,
    Rating: starEmoji().repeat(stars),
    Feedback: feedback,
    Service: service,
  };
  const required = ['Employee', 'Rating', 'Feedback'];
  const found = new Set();
  let buttonPlaced = false;

  for (const container of components) {
    if (container?.type !== 17 || !Array.isArray(container.components)) continue;

    for (let i = 0; i < container.components.length; i++) {
      const node = container.components[i];
      if (node?.type !== 10 || typeof node.content !== 'string') continue;

      const out = [];
      let hasFields = false;
      for (const line of node.content.split('\n')) {
        const trimmed = line.trim();
        const label = Object.keys(values).find((l) => trimmed.startsWith(`**${l}:**`));
        if (label) {
          hasFields = true;
          found.add(label);
          if (values[label]) out.push(`**${label}:** ${values[label]}`);
        } else {
          out.push(
            line
              .replaceAll('{user}', () => signedBy)
              .replaceAll('(user who used the panel)', () => signedBy),
          );
        }
      }
      node.content = out.join('\n');

      if (hasFields && !buttonPlaced) {
        container.components.splice(i + 1, 0, {
          type: 1,
          components: [{ type: 2, style: 2, label: 'View Ratings', custom_id: `feedback:stats:${employeeId}` }],
        });
        buttonPlaced = true;
        i += 1;
      }
    }
  }

  for (const label of required) {
    if (!found.has(label)) throw new Error(`data/${SEND_FILE} is missing a "**${label}:**" line.`);
  }
  return components;
}

// ---------------------------------------------------------------------------
// Star breakdown embed (the "View Ratings" button)
// ---------------------------------------------------------------------------
export function buildStatsEmbed(employeeId, counts) {
  const star = starEmoji();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const weighted = Object.entries(counts).reduce((sum, [stars, n]) => sum + Number(stars) * n, 0);
  const average = total ? (weighted / total).toFixed(1) : '0.0';

  const rows = [5, 4, 3, 2, 1].map((stars) => {
    const count = counts[stars];
    const filled = total ? Math.round((count / total) * 10) : 0;
    return `**${stars}** ${star}  ${'█'.repeat(filled)}${'░'.repeat(10 - filled)}  **${count}**`;
  });

  return new EmbedBuilder()
    .setTitle('Employee Ratings')
    .setColor('#fbbc04')
    .setDescription(
      `<@${employeeId}>\n\n**${average}** ${star} average from **${total}** rating${total === 1 ? '' : 's'}\n\n${rows.join('\n')}`,
    )
    .setTimestamp();
}
