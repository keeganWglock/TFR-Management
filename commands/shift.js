import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE_DIR } from '../utils/paths.js';
import { getGuildConfig } from '../utils/config.js';

// Every start / break / end event is logged here as an embed that @-mentions the user.
const SHIFT_LOG_CHANNEL_ID = '1568774885361065995';
// Timezone used for the "Recent Shifts" / "Online Since" times.
const TIMEZONE = 'America/New_York';

const SHIFT_BUTTON_ACTIONS = new Set([
  'startshift',
  'endshift',
  'startbreak',
  'endbreak',
  'confirmwipe',
  'cancelwipe',
]);

export function isShiftButton(customId) {
  return SHIFT_BUTTON_ACTIONS.has(customId.split('_')[0]);
}

// ---------------------------------------------------------------------------
// Database (one JSON file per guild in /database)
// ---------------------------------------------------------------------------
function dbPath(guildId) {
  return path.join(DATABASE_DIR, `${guildId}.json`);
}

function readDatabase(guildId) {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  const filePath = dbPath(guildId);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '{}');
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    // Keep a copy of the unreadable file so no data is silently lost.
    const backup = `${filePath}.corrupt-${Date.now()}`;
    console.error(`[DB ERROR] Database for guild ${guildId} is unreadable, backed up to ${backup}:`, error);
    try {
      fs.renameSync(filePath, backup);
    } catch (renameError) {
      console.error('[DB ERROR] Backup failed:', renameError);
    }
    return {};
  }
}

function writeDatabase(guildId, data) {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  const filePath = dbPath(guildId);
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    console.error(`[DB ERROR] Error writing database for guild ${guildId}:`, error);
  }
}

function defaultProfile() {
  return {
    totalShiftTime: 0,
    totalBreakTime: 0,
    currentStatus: 'OFFLINE',
    lastShiftEnded: null,
    currentShiftStart: null,
    currentBreakStart: null,
    sessionStart: null,
    sessionSeconds: 0,
    recentShifts: [],
  };
}

// Returns the user's profile (creating / upgrading it inside `db` if needed).
function getProfile(db, userId) {
  const profile = { ...defaultProfile(), ...(db[userId] ?? {}) };
  if (!Array.isArray(profile.recentShifts)) profile.recentShifts = [];
  // Upgrade profiles saved by the old version of the bot.
  if (profile.currentStatus !== 'OFFLINE' && !profile.sessionStart) {
    profile.sessionStart = profile.currentShiftStart ?? profile.currentBreakStart ?? Date.now();
  }
  db[userId] = profile;
  return profile;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 seconds';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds > 1 ? 's' : ''}`);
  return parts.join(' ');
}

function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIMEZONE,
  });
}

const secondsBetween = (from, to) => Math.max(0, Math.floor((to - from) / 1000));

// ---------------------------------------------------------------------------
// Shift state machine
// ---------------------------------------------------------------------------
// Applies a button action to a profile. Returns null if the action doesn't fit the
// current status (e.g. a stale dashboard), otherwise what the caller should do next.
function applyAction(profile, action, now) {
  const status = profile.currentStatus;

  if (action === 'startshift' && status === 'OFFLINE') {
    profile.currentStatus = 'ONLINE';
    profile.currentShiftStart = now;
    profile.currentBreakStart = null;
    profile.sessionStart = now;
    profile.sessionSeconds = 0;
    return { role: 'add', log: { title: 'Shift Started', color: 0x2ecc71, details: [] } };
  }

  if (action === 'startbreak' && status === 'ONLINE') {
    const worked = secondsBetween(profile.currentShiftStart ?? now, now);
    profile.totalShiftTime += worked;
    profile.sessionSeconds += worked;
    profile.currentStatus = 'BREAK';
    profile.currentBreakStart = now;
    profile.currentShiftStart = null;
    return {
      role: 'remove',
      log: {
        title: 'Break Started',
        color: 0xe67e22,
        details: [{ name: 'Shift Time So Far', value: `\`${formatDuration(profile.sessionSeconds)}\`` }],
      },
    };
  }

  if (action === 'endbreak' && status === 'BREAK') {
    const onBreak = secondsBetween(profile.currentBreakStart ?? now, now);
    profile.totalBreakTime += onBreak;
    profile.currentStatus = 'ONLINE';
    profile.currentShiftStart = now;
    profile.currentBreakStart = null;
    return {
      role: 'add',
      log: {
        title: 'Break Ended',
        color: 0x3498db,
        details: [{ name: 'Break Length', value: `\`${formatDuration(onBreak)}\`` }],
      },
    };
  }

  if (action === 'endshift' && (status === 'ONLINE' || status === 'BREAK')) {
    if (status === 'ONLINE') {
      const worked = secondsBetween(profile.currentShiftStart ?? now, now);
      profile.totalShiftTime += worked;
      profile.sessionSeconds += worked;
    } else {
      profile.totalBreakTime += secondsBetween(profile.currentBreakStart ?? now, now);
    }

    const sessionSeconds = profile.sessionSeconds;
    profile.recentShifts.unshift(`${formatTime(profile.sessionStart)} - ${formatDuration(sessionSeconds)}`);
    profile.recentShifts = profile.recentShifts.slice(0, 5);

    profile.currentStatus = 'OFFLINE';
    profile.lastShiftEnded = now;
    profile.currentShiftStart = null;
    profile.currentBreakStart = null;
    profile.sessionStart = null;
    profile.sessionSeconds = 0;
    return {
      role: 'remove',
      log: {
        title: 'Shift Ended',
        color: 0xe74c3c,
        details: [{ name: 'Total Shift Length', value: `\`${formatDuration(sessionSeconds)}\`` }],
      },
    };
  }

  return null;
}

async function sendShiftLog(interaction, log) {
  try {
    const channel = await interaction.client.channels.fetch(SHIFT_LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') return;
    // Don't write one server's shifts into another server's log channel.
    if (channel.guildId && channel.guildId !== interaction.guildId) return;

    const userId = interaction.user.id;
    const embed = new EmbedBuilder()
      .setTitle(log.title)
      .setColor(log.color)
      .setDescription(`**User:** <@${userId}>`)
      .addFields(
        { name: 'Username', value: `<@${userId}> (${interaction.user.username})`, inline: true },
        { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
        ...log.details.map((detail) => ({ ...detail, inline: true })),
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setFooter({ text: `User ID: ${userId}` })
      .setTimestamp();

    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[SHIFT LOG] Failed to send shift log:', error);
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function compileDashboard(profile, userId) {
  const isOnline = profile.currentStatus === 'ONLINE';
  const isBreak = profile.currentStatus === 'BREAK';

  let titleText = "You're Offline";
  let color = '#efefef';
  if (isOnline) {
    titleText = "You're Online";
    color = '#2ecc71';
  }
  if (isBreak) {
    titleText = "You're on Break";
    color = '#e67e22';
  }

  const embed = new EmbedBuilder().setTitle(titleText).setColor(color).setTimestamp();

  if (profile.currentStatus === 'OFFLINE' && profile.lastShiftEnded) {
    const ago = Math.floor((Date.now() - profile.lastShiftEnded) / 1000);
    embed.setDescription(`Your last shift ended \`${formatDuration(ago)}\` ago.`);
  }

  let liveShiftSeconds = profile.totalShiftTime;
  let liveBreakSeconds = profile.totalBreakTime;
  if (isOnline && profile.currentShiftStart) {
    liveShiftSeconds += secondsBetween(profile.currentShiftStart, Date.now());
  } else if (isBreak && profile.currentBreakStart) {
    liveBreakSeconds += secondsBetween(profile.currentBreakStart, Date.now());
  }

  embed.addFields(
    { name: 'Total Shift Time', value: `\`${formatDuration(liveShiftSeconds)}\``, inline: true },
    { name: 'Total Break Time', value: `\`${formatDuration(liveBreakSeconds)}\``, inline: true },
  );

  if (isOnline && profile.currentShiftStart) {
    embed.addFields({ name: 'Online Since', value: `\`${formatTime(profile.currentShiftStart)}\``, inline: false });
  } else if (isBreak && profile.currentBreakStart) {
    embed.addFields({ name: 'On Break Since', value: `\`${formatTime(profile.currentBreakStart)}\``, inline: false });
  }

  if (profile.recentShifts.length > 0) {
    embed.addFields({
      name: `Recent Shifts [${profile.recentShifts.length}]`,
      value: profile.recentShifts.map((entry) => `\`${entry}\``).join('\n'),
      inline: false,
    });
  }

  const row = new ActionRowBuilder();
  if (profile.currentStatus === 'OFFLINE') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`startshift_${userId}`).setLabel('Start Shift').setStyle(ButtonStyle.Danger),
    );
  } else if (profile.currentStatus === 'ONLINE') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`endshift_${userId}`).setLabel('End Shift').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`startbreak_${userId}`).setLabel('Start Break').setStyle(ButtonStyle.Danger),
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId(`endshift_${userId}`).setLabel('End Shift').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`endbreak_${userId}`).setLabel('End Break').setStyle(ButtonStyle.Danger),
    );
  }

  return { embeds: [embed], components: [row] };
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
export async function handleButton(interaction) {
  const [action, userId] = interaction.customId.split('_');
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!interaction.inGuild()) return;
  const config = getGuildConfig(interaction.guildId);
  if (!config) return ephemeral('This server is not set up in the configuration file.');

  if (interaction.user.id !== userId) {
    return ephemeral("You cannot control somebody else's shift.");
  }

  // --- Roster wipe confirmation ---
  if (action === 'confirmwipe' || action === 'cancelwipe') {
    if (!interaction.member?.roles?.cache?.has(config.requiredAdminRoleID)) {
      return ephemeral('You lack permissions to confirm this administrative wipe operation.');
    }
    if (action === 'cancelwipe') {
      return interaction.update({ content: '❌ **Administrative roster wipe aborted safely.**', embeds: [], components: [] });
    }
    writeDatabase(interaction.guildId, {});
    return interaction.update({
      content: '✅ **Roster wipe completely executed. All database entries cleared.**',
      embeds: [],
      components: [],
    });
  }

  // --- Shift buttons ---
  if (!interaction.member?.roles?.cache?.has(config.requiredManageRoleID)) {
    return ephemeral('You no longer retain the required role to manipulate shifts.');
  }

  // Read -> change -> write happens with no awaits in between, so two people clicking
  // at the same moment can never overwrite each other's data.
  const db = readDatabase(interaction.guildId);
  const profile = getProfile(db, userId);
  const result = applyAction(profile, action, Date.now());
  if (result) writeDatabase(interaction.guildId, db);

  await interaction.update(compileDashboard(profile, userId));
  if (!result) return; // stale button - the dashboard was just refreshed

  if (config.onDutyRoleID) {
    try {
      if (result.role === 'add') await interaction.member.roles.add(config.onDutyRoleID);
      else await interaction.member.roles.remove(config.onDutyRoleID);
    } catch (error) {
      console.warn(`[SHIFT] Could not update the on-duty role for ${userId}: ${error.message}`);
    }
  }
  await sendShiftLog(interaction, result.log);
}

// ---------------------------------------------------------------------------
// Slash command
// ---------------------------------------------------------------------------
export default {
  data: new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Complete shift tracking system suite.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub.setName('manage').setDescription('Open shift command dashboard.'),
    )
    .addSubcommand((sub) =>
      sub.setName('active').setDescription('View all personnel currently clocked into their duty shifts.'),
    )
    .addSubcommand((sub) =>
      sub.setName('leaderboard').setDescription('View current activity waves.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('admin')
        .setDescription('Administrative management for roster duty files.')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Action to perform')
            .setRequired(true)
            .addChoices({ name: 'wipe', value: 'wipe' }, { name: 'manage', value: 'manage' }),
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Pick modification type if managing.')
            .setRequired(false)
            .addChoices({ name: 'add time', value: 'add' }, { name: 'remove time', value: 'remove' }),
        )
        .addUserOption((opt) => opt.setName('target').setDescription('Roster member target profile').setRequired(false))
        .addIntegerOption((opt) =>
          opt.setName('hours').setDescription('Amount of hours to shift').setRequired(false).setMinValue(0),
        )
        .addIntegerOption((opt) =>
          opt.setName('minutes').setDescription('Amount of minutes to shift').setRequired(false).setMinValue(0),
        ),
    ),

  async execute(interaction) {
    const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (!interaction.inGuild()) return ephemeral('This command can only be used in a server.');
    const guildId = interaction.guildId;
    const config = getGuildConfig(guildId);
    if (!config) {
      return ephemeral('This server is not registered in config/serversConfig.json (or the file could not be read).');
    }

    const subcommand = interaction.options.getSubcommand();

    // /shift manage
    if (subcommand === 'manage') {
      if (!interaction.member.roles.cache.has(config.requiredManageRoleID)) {
        return ephemeral('You lack the required management role permission tier to run this command.');
      }
      const db = readDatabase(guildId);
      const profile = getProfile(db, interaction.user.id);
      writeDatabase(guildId, db);
      return interaction.reply(compileDashboard(profile, interaction.user.id));
    }

    // /shift active
    if (subcommand === 'active') {
      const db = readDatabase(guildId);
      const now = Date.now();
      const lines = [];

      for (const userId of Object.keys(db)) {
        const profile = getProfile(db, userId);
        if (profile.currentStatus !== 'ONLINE' && profile.currentStatus !== 'BREAK') continue;
        let sessionSeconds = profile.sessionSeconds;
        if (profile.currentStatus === 'ONLINE' && profile.currentShiftStart) {
          sessionSeconds += secondsBetween(profile.currentShiftStart, now);
        }
        lines.push(`<@${userId}> - Status: \`${profile.currentStatus}\` | Duration: \`${formatDuration(sessionSeconds)}\``);
      }

      if (lines.length === 0) {
        return interaction.reply({ content: 'No personnel are currently on active shift duties in this server.' });
      }

      let description = lines.join('\n');
      if (description.length > 4000) description = `${description.slice(0, 3990)}\n…`;

      const activeEmbed = new EmbedBuilder()
        .setTitle('🚨 Active Personnel Shift Log')
        .setDescription(description)
        .setColor('#0099ff')
        .setTimestamp();
      return interaction.reply({ embeds: [activeEmbed], allowedMentions: { parse: [] } });
    }

    // /shift leaderboard
    if (subcommand === 'leaderboard') {
      await interaction.deferReply();

      let members;
      try {
        await interaction.guild.members.fetch().catch(() => null); // fill the cache; falls back to what we have
        const role = await interaction.guild.roles.fetch(config.leaderboardRoleID);
        members = role ? [...role.members.values()] : [];
      } catch (error) {
        console.error('[SHIFT] Leaderboard role lookup failed:', error);
        return interaction.editReply({ content: 'Failed to read the configured tracking role.' });
      }

      if (members.length === 0) {
        return interaction.editReply({ content: 'No members inside this server possess the tracking configuration role.' });
      }

      const db = readDatabase(guildId);
      const rows = members.map((member) => {
        const totalSeconds = db[member.id]?.totalShiftTime ?? 0;
        let requiredSeconds = 0;
        for (const [roleId, quotaSeconds] of Object.entries(config.quotas ?? {})) {
          if (member.roles.cache.has(roleId)) {
            requiredSeconds = quotaSeconds;
            break;
          }
        }
        return { id: member.id, totalSeconds, requiredSeconds };
      });
      rows.sort((a, b) => b.totalSeconds - a.totalSeconds);

      const lines = [];
      let length = 0;
      let shown = 0;
      for (const row of rows) {
        const duration = formatDuration(row.totalSeconds);
        let line;
        if (row.requiredSeconds > 0) {
          const quota = formatDuration(row.requiredSeconds);
          line =
            row.totalSeconds >= row.requiredSeconds
              ? `<@${row.id}> - ${duration} - ✅ Met \`${quota} required\``
              : `<@${row.id}> - ${duration} - ❌ Missing \`${quota} required\``;
        } else {
          line = `<@${row.id}> - ${duration} - No Quota Configured`;
        }
        if (length + line.length + 1 > 3900) break;
        lines.push(line);
        length += line.length + 1;
        shown += 1;
      }
      if (shown < rows.length) lines.push(`…and ${rows.length - shown} more`);

      const lbEmbed = new EmbedBuilder()
        .setTitle('📋 Leaderboard: Activity Quotas')
        .setDescription(lines.join('\n'))
        .setColor('#ffcc00')
        .setFooter({ text: 'TFR Management' })
        .setTimestamp();
      return interaction.editReply({ embeds: [lbEmbed], allowedMentions: { parse: [] } });
    }

    // /shift admin
    if (subcommand === 'admin') {
      if (!interaction.member.roles.cache.has(config.requiredAdminRoleID)) {
        return ephemeral('You lack the permissions.');
      }

      const actionType = interaction.options.getString('action', true);

      if (actionType === 'wipe') {
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirmwipe_${interaction.user.id}`)
            .setLabel('Confirm Wipe')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`cancelwipe_${interaction.user.id}`)
            .setLabel('Cancel operation')
            .setStyle(ButtonStyle.Secondary),
        );
        return interaction.reply({
          content: '⚠️ **Are you sure you want to wipe the complete server roster logs? This is irreversible.**',
          components: [confirmRow],
        });
      }

      // actionType === 'manage'
      const type = interaction.options.getString('type');
      const targetUser = interaction.options.getUser('target');
      const hours = interaction.options.getInteger('hours') ?? 0;
      const minutes = interaction.options.getInteger('minutes') ?? 0;

      if (!type || !targetUser) {
        return ephemeral("Error: managing a profile requires choosing a 'type' and a 'target'.");
      }
      const modificationSeconds = hours * 3600 + minutes * 60;
      if (modificationSeconds <= 0) {
        return ephemeral('Please supply a time value higher than 0.');
      }

      const db = readDatabase(guildId);
      const profile = getProfile(db, targetUser.id);
      if (type === 'add') {
        profile.totalShiftTime += modificationSeconds;
      } else {
        profile.totalShiftTime = Math.max(0, profile.totalShiftTime - modificationSeconds);
      }
      writeDatabase(guildId, db);

      const verb = type === 'add' ? 'added' : 'removed';
      const direction = type === 'add' ? 'to' : 'from';
      return interaction.reply({
        content: `✅ Successfully **${verb}** \`${hours} hours, ${minutes} minutes\` ${direction} <@${targetUser.id}>.`,
        allowedMentions: { parse: [] },
      });
    }
  },
};
