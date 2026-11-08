import fs from 'node:fs';
import path from 'node:path';
import { Events, MessageFlags } from 'discord.js';
import { DATABASE_DIR } from '../utils/paths.js';
import { loadTemplate } from '../utils/components.js';
import { FEEDBACK_CHANNEL_ID, STICKY_FILE, isValidId } from '../utils/feedback.js';
import { ignoredDeletes } from '../utils/state.js';

const STATE_FILE = path.join(DATABASE_DIR, 'feedback-sticky.json');
const DELAY_MS = 1000; // short pause so a burst of messages causes one repost

function readStickyId() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).messageId ?? null;
  } catch {
    return null;
  }
}

function saveStickyId(messageId) {
  try {
    fs.mkdirSync(DATABASE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ messageId }));
  } catch (error) {
    console.error('[STICKY] Could not save sticky state:', error);
  }
}

function register(client) {
  if (!isValidId(FEEDBACK_CHANNEL_ID)) {
    console.warn('[STICKY] FEEDBACK_CHANNEL_ID is not set in utils/feedback.js - the feedback sticky is disabled.');
    return;
  }

  let stickyId = readStickyId();
  let timer = null;
  let running = false;
  let rerun = false;

  async function repost() {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      const channel = await client.channels.fetch(FEEDBACK_CHANNEL_ID);
      if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') return;

      // The sticky is already the newest message - nothing to do (this also stops loops).
      if (stickyId && channel.lastMessageId === stickyId) return;

      const components = await loadTemplate(STICKY_FILE);

      if (stickyId) {
        ignoredDeletes.add(stickyId); // keep the server logger quiet about it
        await channel.messages.delete(stickyId).catch(() => ignoredDeletes.delete(stickyId));
      }
      const sent = await channel.send({
        components,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      stickyId = sent.id;
      saveStickyId(stickyId);
    } catch (error) {
      console.error('[STICKY] Could not repost the sticky message:', error.message);
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      repost();
    }, DELAY_MS);
  }

  client.on(Events.MessageCreate, (message) => {
    if (message.channelId !== FEEDBACK_CHANNEL_ID) return;
    if (message.id === stickyId) return;
    schedule();
  });

  // Make sure the sticky exists / is at the bottom after a restart.
  client.once(Events.ClientReady, () => schedule());
}

export default { register };
