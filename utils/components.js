import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MessageFlags } from 'discord.js';
import { DATA_DIR } from './paths.js';

// Loads a Components V2 template from /data. Accepts either a bare array of
// components or an object like { "flags": 32768, "components": [...] }.
export async function loadTemplate(fileName) {
  let raw;
  try {
    raw = JSON.parse(await readFile(path.join(DATA_DIR, fileName), 'utf8'));
  } catch (error) {
    throw new Error(`Could not read data/${fileName}: ${error.message}`);
  }
  const components = Array.isArray(raw) ? raw : raw?.components;
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error(`data/${fileName} needs a "components" array.`);
  }
  return components;
}

function walk(nodes, visit) {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    visit(node);
    if (Array.isArray(node.components)) walk(node.components, visit);
  }
}

// Fills a notice template (promotion / infraction):
//   - every "**Label:**" line gets its value appended
//   - "{user}" becomes the signer's name
//   - if `timestamp` is given (log copy only) a "**Timestamp:**" line is added under the fields
export function fillNotice(components, { fields, signedBy, timestamp = null, fileName = 'template' }) {
  const labels = Object.keys(fields);
  const found = new Set();
  let timestampPlaced = false;

  walk(components, (node) => {
    if (node.type !== 10 || typeof node.content !== 'string') return;

    const out = [];
    let lastFieldIndex = -1;
    let touched = false;

    for (const line of node.content.split('\n')) {
      const trimmed = line.trim();
      const label = labels.find((l) => trimmed.startsWith(`**${l}:**`));
      if (label) {
        out.push(`**${label}:** ${fields[label]}`);
        lastFieldIndex = out.length - 1;
        found.add(label);
        touched = true;
      } else if (line.includes('{user}')) {
        out.push(line.replaceAll('{user}', () => signedBy));
        touched = true;
      } else {
        out.push(line);
      }
    }

    if (timestamp && touched && !timestampPlaced) {
      out.splice(lastFieldIndex === -1 ? out.length : lastFieldIndex + 1, 0, `**Timestamp:** ${timestamp}`);
      timestampPlaced = true;
    }
    node.content = out.join('\n');
  });

  for (const label of labels) {
    if (!found.has(label)) throw new Error(`data/${fileName} is missing a "**${label}:**" line.`);
  }
  return components;
}

export async function fetchSendableChannel(client, channelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') {
    throw new Error(`Channel ${channelId} was not found or the bot cannot send messages there.`);
  }
  return channel;
}

// Posts a filled notice to its public channel and a timestamped copy to its log channel.
// The interaction must already be deferred (ephemeral).
export async function postNotice({ interaction, templateFile, fields, channelId, logChannelId, label, mentionUserIds = [] }) {
  const signedBy =
    interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;

  let publicComponents;
  let logComponents;
  try {
    publicComponents = fillNotice(await loadTemplate(templateFile), { fields, signedBy, fileName: templateFile });
    logComponents = fillNotice(await loadTemplate(templateFile), {
      fields,
      signedBy,
      timestamp: `<t:${Math.floor(Date.now() / 1000)}:F>`,
      fileName: templateFile,
    });
  } catch (error) {
    return interaction.editReply({ content: `❌ ${error.message}` });
  }

  try {
    const target = await fetchSendableChannel(interaction.client, channelId);
    await target.send({
      components: publicComponents,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], users: mentionUserIds },
    });
  } catch (error) {
    console.error(`[${label.toUpperCase()}] Failed to post notice:`, error);
    return interaction.editReply({ content: `❌ Couldn't post the ${label}: ${error.message}` });
  }

  let logNote = '';
  try {
    const logChannel = await fetchSendableChannel(interaction.client, logChannelId);
    // No pings in the log copy, so the employee isn't notified twice.
    await logChannel.send({
      components: logComponents,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(`[${label.toUpperCase()}] Failed to post log copy:`, error);
    logNote = `\n⚠️ The ${label} was posted, but I couldn't write it to the log channel: ${error.message}`;
  }

  return interaction.editReply({ content: `✅ ${label[0].toUpperCase()}${label.slice(1)} posted in <#${channelId}>.${logNote}` });
}
