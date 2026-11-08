import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';

// ---- CONFIG -------------------------------------------------------------
const CONFIG = {
  // The panel that -verify posts is loaded from this file (relative to where you start the bot).
  panelFile: path.join(process.cwd(), 'data', 'verificationmessage.json'),
  logChannelId: '1569093281995030609',
  verifiedRoleId: '1565490212061057055',

  // "Change Account": if you have a Dock PID, each click creates a personal Dock verification
  // link for that user. Otherwise it falls back to the static link below (leave one of them set).
  dockPid: 'PID-p1bMvnJm', // e.g. 'pid-yourapp' (a PID owned by your Dock API key)
  changeAccountUrl: '', // e.g. the Dock verification page your server uses
};

// ---- DOCK API -------------------------------------------------------------
// Set DOCK_API_KEY in your .env and restart the bot.
const DOCK = 'https://api.docksys.xyz';

async function dockFetch(pathAndQuery, options = {}, attempt = 0) {
  const key = process.env.DOCK_API_KEY?.trim();
  if (!key) throw new Error('DOCK_API_KEY is not set - add it to your .env and restart the bot.');

  const res = await fetch(`${DOCK}${pathAndQuery}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers },
  });

  // Dock paces requests (about 1 per second) and answers 429 with Retry-After.
  if (res.status === 429 && attempt < 1) {
    const wait = Math.min(Number(res.headers.get('Retry-After') || 1), 3);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return dockFetch(pathAndQuery, options, attempt + 1);
  }
  return res;
}

// ---- ACCOUNT LOOKUP -------------------------------------------------------
// Returns { id, name, created, profile } for a Discord user with a linked Roblox account, or null.
// Dock gives the Roblox ID; the username and account age come from Roblox's public API.
async function lookupRobloxLink(discordId, guildId) {
  const res = await dockFetch(
    `/api/v1/public/discord-to-roblox?discordId=${encodeURIComponent(discordId)}&guildId=${encodeURIComponent(guildId)}`,
  );
  if (res.status === 404) return null; // not linked
  if (!res.ok) throw new Error(`Dock API ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  const d = body?.data ?? body; // works for { data: { robloxId } } and a flat { robloxId }
  const robloxId = d?.robloxId ?? d?.roblox_id ?? d?.data?.robloxId;
  if (!robloxId) return null;

  let name = `Roblox user ${robloxId}`;
  let created;
  try {
    const r = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
    if (r.ok) {
      const u = await r.json();
      name = u.name ?? name;
      created = u.created; // ISO date string
    }
  } catch {
    // Roblox lookup is cosmetic - verification still works without it.
  }
  return { id: String(robloxId), name, created, profile: `https://www.roblox.com/users/${robloxId}/profile` };
}

// Creates a personal Dock verification link for "Change Account", or falls back to the static URL.
async function getChangeAccountUrl(discordId, guildId) {
  if (!CONFIG.dockPid) {
    return CONFIG.changeAccountUrl || null; // null = not set up yet
  }
  const res = await dockFetch('/api/v1/verify/session', {
    method: 'POST',
    body: JSON.stringify({ pid: CONFIG.dockPid, clientId: discordId, guildId }),
  });
  if (!res.ok) throw new Error(`Dock API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const url = (await res.json())?.data?.verifyUrl;
  if (!url) throw new Error('Dock did not return a verifyUrl.');
  return url;
}

const text = (content) => new TextDisplayBuilder().setContent(content);
const ts = (value) => {
  if (value == null) return 'Unknown';
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : new Date(value).getTime();
  return `<t:${Math.floor(ms / 1000)}:D>`;
};

// ---- COMPONENT BUILDERS --------------------------------------------------
// Reads data/verificationmessage.json on every -verify, so edits apply without a restart.
// Accepts either a bare array of components or an object like { "components": [...] }.
async function loadPanel() {
  const raw = JSON.parse(await readFile(CONFIG.panelFile, 'utf8'));
  const components = Array.isArray(raw) ? raw : raw.components;
  if (!Array.isArray(components) || !components.length) {
    throw new Error('verificationmessage.json needs a "components" array.');
  }
  if (!JSON.stringify(components).includes('"verify1:begin"')) {
    throw new Error('verificationmessage.json has no button with custom_id "verify1:begin".');
  }
  return components;
}

function buildConfirm(robloxUser) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify1:change').setLabel('Change Account').setStyle(ButtonStyle.Secondary),
  );
  const container = new ContainerBuilder().addTextDisplayComponents(text('## Roblox Verification'));

  if (robloxUser) {
    container.addTextDisplayComponents(
      text(`You **already** have the Roblox account **${robloxUser.name}** linked.`),
      text('To switch to a different account, click **Change Account**.\nTo continue using your current account, click **Continue**.'),
    );
    row.addComponents(
      new ButtonBuilder().setCustomId('verify1:continue').setLabel('Continue').setStyle(ButtonStyle.Success),
    );
  } else {
    container.addTextDisplayComponents(
      text('No Roblox account is linked to your Discord account yet. Click **Change Account** to link one, then press Begin Verification again.'),
    );
  }
  return container.addActionRowComponents(row);
}

function buildSuccess(robloxUser) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      text('## Verification Successful'),
      text(`You have been verified under the account of **${robloxUser.name}**.`),
    );
}

function buildLog(member, robloxUser) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      text('## New Verification'),
      text(`${member} has successfully completed the verification process and is now officially verified.`),
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      text(
        `**Joined At:** ${ts(robloxUser.created)}\n` +
          `**Verified At:** ${ts(Date.now())}\n` +
          `**Roblox Username:** ${robloxUser.name}\n` +
          `**Roblox ID:** ${robloxUser.id}\n` +
          `**Discord ID:** ${member.id}\n` +
          `**Discord Username:** @${member.user.username}`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Visit Profile')
          .setStyle(ButtonStyle.Link)
          .setURL(robloxUser.profile),
      ),
    );
}

// ---- COMMAND + BUTTON HANDLERS ----------------------------------------------
// Handles the "Begin Verification" and "Continue" buttons (called from events/verifyButtons.js).
// "Continue" reuses the lookup from "Begin" (if done in the last 2 minutes) to save API calls.
const recentLookups = new Map(); // discordId -> { user, at }

export async function handleButton(interaction) {
  const id = interaction.user.id;

  if (interaction.customId === 'verify1:change') {
    const url = await getChangeAccountUrl(id, interaction.guildId);
    recentLookups.delete(id); // force a fresh lookup after they relink
    if (!url) {
      return interaction.reply({
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            text('## Change Account'),
            text('Changing accounts is not set up yet. Please ask a staff member for help.'),
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      components: [
        new ContainerBuilder()
          .addTextDisplayComponents(
            text('## Change Account'),
            text('Open the link below to link a different Roblox account, then press **Begin Verification** again.'),
          )
          .addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setLabel('Link Account').setStyle(ButtonStyle.Link).setURL(url),
            ),
          ),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }

  let robloxUser;
  const recent = recentLookups.get(id);
  if (interaction.customId === 'verify1:continue' && recent && Date.now() - recent.at < 120_000) {
    robloxUser = recent.user;
  } else {
    robloxUser = await lookupRobloxLink(id, interaction.guildId);
    if (robloxUser) recentLookups.set(id, { user: robloxUser, at: Date.now() });
    else recentLookups.delete(id);
  }

  if (interaction.customId === 'verify1:begin') {
    return interaction.reply({
      components: [buildConfirm(robloxUser)],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }

  if (interaction.customId === 'verify1:continue') {
    if (!robloxUser) {
      return interaction.update({ components: [buildConfirm(null)], flags: MessageFlags.IsComponentsV2 });
    }
    try {
      await interaction.member.roles.add(CONFIG.verifiedRoleId);
    } catch (err) {
      if (err.code !== 50013) throw err;
      // Administrator does NOT bypass role hierarchy, so work out exactly what is wrong.
      const guild = interaction.guild;
      const role = await guild.roles.fetch(CONFIG.verifiedRoleId).catch(() => null);
      const me = guild.members.me;
      const reasons = [];
      if (!role) {
        reasons.push(`role ${CONFIG.verifiedRoleId} was not found in this server (wrong ID?)`);
      } else {
        if (role.managed) reasons.push(`role "${role.name}" is managed by a bot/integration and cannot be assigned`);
        if (role.position >= me.roles.highest.position) {
          reasons.push(
            `role "${role.name}" (position ${role.position}) is not BELOW the bot's highest role ` +
              `"${me.roles.highest.name}" (position ${me.roles.highest.position}) - drag the bot's role above it`,
          );
        }
      }
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) reasons.push('the bot lacks Manage Roles');
      throw new Error(`Can't give the verified role: ${reasons.join('; ') || 'unknown - check the role order in Server Settings > Roles'}`);
    }
    await interaction.update({ components: [buildSuccess(robloxUser)], flags: MessageFlags.IsComponentsV2 });

    const logChannel = await interaction.guild.channels.fetch(CONFIG.logChannelId);
    await logChannel.send({ components: [buildLog(interaction.member, robloxUser)], flags: MessageFlags.IsComponentsV2 });
  }
}

// Your index.js loads module.default and runs command.execute(message, args) for "-verify".
export default {
  name: 'verify',
  description: 'Posts the verification panel.',
  async execute(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return;
    try {
      const components = await loadPanel();
      await message.channel.send({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
      await message.reply(`Couldn't load the verification panel: ${err.message}`);
    }
  },
};