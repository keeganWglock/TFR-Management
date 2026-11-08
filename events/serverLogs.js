import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
} from 'discord.js';
import { ignoredDeletes } from '../utils/state.js';

// Paste the ID of your server-log channel here.
const SERVER_LOG_CHANNEL_ID = '1568085999194480680';

const COLORS = {
  green: 0x57f287,
  red: 0xed4245,
  yellow: 0xfee75c,
  blue: 0x5865f2,
  orange: 0xe67e22,
  grey: 0x95a5a6,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unix = (ms) => Math.floor(ms / 1000);
const stamp = (ms) => `<t:${unix(ms)}:F> (<t:${unix(ms)}:R>)`;

function trunc(value, max = 1000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const fieldValue = (value, max = 1000) => trunc(value, max) || '*(none)*';

function baseEmbed({ title, description, color, user, footer }) {
  const embed = new EmbedBuilder().setTitle(trunc(title, 250)).setColor(color).setTimestamp();
  if (description) embed.setDescription(trunc(description, 4000));
  if (user) {
    embed.setAuthor({ name: trunc(user.username ?? 'Unknown', 250), iconURL: user.displayAvatarURL?.() });
  }
  if (footer) embed.setFooter({ text: trunc(footer, 2000) });
  return embed;
}

const isValidId = (id) => /^\d{17,20}$/.test(id);
let cachedChannel = null;

async function getLogChannel(client) {
  if (!isValidId(SERVER_LOG_CHANNEL_ID)) return null;
  if (cachedChannel) return cachedChannel;
  const channel = await client.channels.fetch(SERVER_LOG_CHANNEL_ID).catch(() => null);
  if (channel && channel.isTextBased() && typeof channel.send === 'function' && channel.guildId) {
    cachedChannel = channel;
  }
  return cachedChannel;
}

async function sendLog(guild, embed) {
  try {
    const channel = await getLogChannel(guild.client);
    // Only log events from the server that owns the log channel.
    if (!channel || channel.guildId !== guild.id) return;
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[SERVER LOG] Failed to send log:', error.message);
  }
}

// Best-effort "who did it" lookup. Returns the audit log entry or null.
async function findAuditEntry(guild, type, targetId, { maxAgeMs = 10_000, match } = {}) {
  try {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    const logs = await guild.fetchAuditLogs({ type, limit: 8 });
    return (
      logs.entries.find(
        (entry) =>
          entry.targetId === targetId &&
          Date.now() - entry.createdTimestamp < maxAgeMs &&
          (!match || match(entry)),
      ) ?? null
    );
  } catch {
    return null;
  }
}

function addExecutor(embed, entry, label = 'Done by') {
  if (!entry) return;
  if (entry.executor) embed.addFields({ name: label, value: `<@${entry.executor.id}> (${trunc(entry.executor.username, 80)})`, inline: true });
  if (entry.reason) embed.addFields({ name: 'Reason', value: fieldValue(entry.reason), inline: false });
}

const channelTypeName = (type) => ChannelType[type] ?? 'Unknown';

// ---------------------------------------------------------------------------
// Event registration
// ---------------------------------------------------------------------------
function register(client) {
  if (!isValidId(SERVER_LOG_CHANNEL_ID)) {
    console.warn('[SERVER LOG] SERVER_LOG_CHANNEL_ID is not set in events/serverLogs.js - server logging is disabled.');
  }

  // Wraps every handler so one bad event can never crash the bot.
  const on = (eventName, handler) => {
    client.on(eventName, async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        console.error(`[SERVER LOG] Error in ${eventName}:`, error);
      }
    });
  };

  // ----- Members -----------------------------------------------------------
  on(Events.GuildMemberAdd, async (member) => {
    const embed = baseEmbed({
      title: 'Member Joined',
      description: `${member} (${member.user.username}) joined the server.`,
      color: COLORS.green,
      user: member.user,
      footer: `User ID: ${member.id}`,
    })
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: 'Account Created', value: stamp(member.user.createdTimestamp), inline: false },
        { name: 'Member Count', value: String(member.guild.memberCount), inline: true },
      );
    await sendLog(member.guild, embed);
  });

  on(Events.GuildMemberRemove, async (member) => {
    await sleep(1000); // give the audit log a moment to catch up
    const guild = member.guild;

    // Bans log themselves through guildBanAdd.
    if (await findAuditEntry(guild, AuditLogEvent.MemberBanAdd, member.id)) return;
    const kick = await findAuditEntry(guild, AuditLogEvent.MemberKick, member.id);

    const embed = baseEmbed({
      title: kick ? 'Member Kicked' : 'Member Left',
      description: `${member.user ?? `<@${member.id}>`} (${member.user?.username ?? 'unknown'}) ${kick ? 'was kicked from' : 'left'} the server.`,
      color: kick ? COLORS.orange : COLORS.red,
      user: member.user,
      footer: `User ID: ${member.id}`,
    });
    if (member.user) embed.setThumbnail(member.user.displayAvatarURL());
    if (member.joinedTimestamp) embed.addFields({ name: 'Joined', value: stamp(member.joinedTimestamp), inline: false });

    const roles = member.roles?.cache.filter((role) => role.id !== guild.id).map((role) => `<@&${role.id}>`) ?? [];
    if (roles.length) embed.addFields({ name: 'Roles', value: fieldValue(roles.join(' ')), inline: false });
    addExecutor(embed, kick, 'Kicked by');
    await sendLog(guild, embed);
  });

  on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (oldMember.partial) return; // nothing to compare against
    const guild = newMember.guild;
    const user = newMember.user;

    // Roles
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
    const removed = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
    if (added.size || removed.size) {
      const entry = await findAuditEntry(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
      const embed = baseEmbed({
        title: 'Member Roles Updated',
        description: `${newMember} (${user.username})`,
        color: COLORS.blue,
        user,
        footer: `User ID: ${newMember.id}`,
      });
      if (added.size) embed.addFields({ name: 'Roles Added', value: fieldValue(added.map((r) => `<@&${r.id}>`).join(' ')), inline: false });
      if (removed.size) embed.addFields({ name: 'Roles Removed', value: fieldValue(removed.map((r) => `<@&${r.id}>`).join(' ')), inline: false });
      addExecutor(embed, entry, 'Changed by');
      await sendLog(guild, embed);
    }

    // Nickname
    if (oldMember.nickname !== newMember.nickname) {
      const entry = await findAuditEntry(guild, AuditLogEvent.MemberUpdate, newMember.id);
      const embed = baseEmbed({
        title: 'Nickname Changed',
        description: `${newMember} (${user.username})`,
        color: COLORS.blue,
        user,
        footer: `User ID: ${newMember.id}`,
      }).addFields(
        { name: 'Before', value: fieldValue(oldMember.nickname ?? '*(no nickname)*'), inline: true },
        { name: 'After', value: fieldValue(newMember.nickname ?? '*(no nickname)*'), inline: true },
      );
      addExecutor(embed, entry, 'Changed by');
      await sendLog(guild, embed);
    }

    // Timeouts
    const oldUntil = oldMember.communicationDisabledUntilTimestamp ?? null;
    const newUntil = newMember.communicationDisabledUntilTimestamp ?? null;
    if (oldUntil !== newUntil) {
      const timedOut = newUntil && newUntil > Date.now();
      const cleared = !newUntil && oldUntil && oldUntil > Date.now();
      if (timedOut || cleared) {
        const entry = await findAuditEntry(guild, AuditLogEvent.MemberUpdate, newMember.id);
        const embed = baseEmbed({
          title: timedOut ? 'Member Timed Out' : 'Timeout Removed',
          description: `${newMember} (${user.username})`,
          color: timedOut ? COLORS.orange : COLORS.green,
          user,
          footer: `User ID: ${newMember.id}`,
        });
        if (timedOut) embed.addFields({ name: 'Timed Out Until', value: stamp(newUntil), inline: false });
        addExecutor(embed, entry, timedOut ? 'Timed out by' : 'Removed by');
        await sendLog(guild, embed);
      }
    }
  });

  on(Events.UserUpdate, async (oldUser, newUser) => {
    if (oldUser.partial) return;
    const changes = [];
    if (oldUser.username !== newUser.username) changes.push({ name: 'Username', value: `${fieldValue(oldUser.username, 400)} → ${fieldValue(newUser.username, 400)}` });
    if (oldUser.globalName !== newUser.globalName) changes.push({ name: 'Display Name', value: `${fieldValue(oldUser.globalName ?? '*(none)*', 400)} → ${fieldValue(newUser.globalName ?? '*(none)*', 400)}` });
    if (oldUser.avatar !== newUser.avatar) changes.push({ name: 'Avatar', value: 'Profile picture changed.' });
    if (!changes.length) return;

    for (const guild of client.guilds.cache.values()) {
      if (!guild.members.cache.has(newUser.id)) continue;
      const embed = baseEmbed({
        title: 'User Updated',
        description: `<@${newUser.id}> (${newUser.username})`,
        color: COLORS.blue,
        user: newUser,
        footer: `User ID: ${newUser.id}`,
      })
        .setThumbnail(newUser.displayAvatarURL())
        .addFields(changes.map((change) => ({ ...change, inline: false })));
      await sendLog(guild, embed);
    }
  });

  // ----- Bans --------------------------------------------------------------
  on(Events.GuildBanAdd, async (ban) => {
    await sleep(1000);
    if (ban.partial) await ban.fetch().catch(() => null);
    const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    const embed = baseEmbed({
      title: 'Member Banned',
      description: `${ban.user} (${ban.user.username}) was banned.`,
      color: COLORS.red,
      user: ban.user,
      footer: `User ID: ${ban.user.id}`,
    }).setThumbnail(ban.user.displayAvatarURL());
    if (ban.reason && !entry?.reason) embed.addFields({ name: 'Reason', value: fieldValue(ban.reason), inline: false });
    addExecutor(embed, entry, 'Banned by');
    await sendLog(ban.guild, embed);
  });

  on(Events.GuildBanRemove, async (ban) => {
    await sleep(1000);
    const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    const embed = baseEmbed({
      title: 'Member Unbanned',
      description: `${ban.user} (${ban.user.username}) was unbanned.`,
      color: COLORS.green,
      user: ban.user,
      footer: `User ID: ${ban.user.id}`,
    }).setThumbnail(ban.user.displayAvatarURL());
    addExecutor(embed, entry, 'Unbanned by');
    await sendLog(ban.guild, embed);
  });

  // ----- Messages ----------------------------------------------------------
  on(Events.MessageDelete, async (message) => {
    if (!message.guild) return;
    if (ignoredDeletes.delete(message.id)) return;
    if (message.author?.id === client.user.id) return;
    const channel = await getLogChannel(client);
    if (channel && message.channelId === channel.id) return;

    const embed = baseEmbed({
      title: 'Message Deleted',
      description: message.partial ? '*The message was not cached, so its content is unavailable.*' : null,
      color: COLORS.red,
      user: message.author ?? undefined,
      footer: `Message ID: ${message.id}`,
    }).addFields({ name: 'Channel', value: `<#${message.channelId}>`, inline: true });

    if (message.author) {
      embed.addFields({ name: 'Author', value: `<@${message.author.id}> (${trunc(message.author.username, 80)})`, inline: true });
    }
    if (!message.partial) {
      embed.addFields({ name: 'Content', value: fieldValue(message.content || '*(no text content)*'), inline: false });
      if (message.attachments.size) {
        embed.addFields({ name: 'Attachments', value: fieldValue(message.attachments.map((a) => a.name).join('\n')), inline: false });
      }
    }

    if (message.author) {
      const entry = await findAuditEntry(message.guild, AuditLogEvent.MessageDelete, message.author.id, {
        maxAgeMs: 8000,
        match: (e) => e.extra?.channel?.id === message.channelId,
      });
      if (entry?.executor) embed.addFields({ name: 'Deleted by', value: `<@${entry.executor.id}> (${trunc(entry.executor.username, 80)})`, inline: true });
    }
    await sendLog(message.guild, embed);
  });

  on(Events.MessageBulkDelete, async (messages, channel) => {
    if (!channel.guild) return;
    const embed = baseEmbed({
      title: 'Bulk Messages Deleted',
      description: `**${messages.size}** messages were deleted in <#${channel.id}>.`,
      color: COLORS.red,
      footer: `Channel ID: ${channel.id}`,
    });
    await sendLog(channel.guild, embed);
  });

  on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;
    if (oldMessage.partial || oldMessage.content == null) return; // original text unknown
    if (newMessage.partial) await newMessage.fetch().catch(() => null);
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return; // embed unfurl, pin, etc.

    const embed = baseEmbed({
      title: 'Message Edited',
      description: `[Jump to message](${newMessage.url})`,
      color: COLORS.yellow,
      user: newMessage.author ?? undefined,
      footer: `Message ID: ${newMessage.id}`,
    }).addFields(
      { name: 'Author', value: newMessage.author ? `<@${newMessage.author.id}> (${trunc(newMessage.author.username, 80)})` : 'Unknown', inline: true },
      { name: 'Channel', value: `<#${newMessage.channelId}>`, inline: true },
      { name: 'Before', value: fieldValue(oldMessage.content || '*(no text content)*', 1000), inline: false },
      { name: 'After', value: fieldValue(newMessage.content || '*(no text content)*', 1000), inline: false },
    );
    await sendLog(newMessage.guild, embed);
  });

  // ----- Voice -------------------------------------------------------------
  on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (!member) return;
    const guild = newState.guild;
    const user = member.user;

    let title = null;
    let color = COLORS.blue;
    const fields = [];

    if (oldState.channelId !== newState.channelId) {
      if (!oldState.channelId && newState.channelId) {
        title = 'Joined Voice Channel';
        color = COLORS.green;
        fields.push({ name: 'Channel', value: `<#${newState.channelId}>` });
      } else if (oldState.channelId && !newState.channelId) {
        title = 'Left Voice Channel';
        color = COLORS.red;
        fields.push({ name: 'Channel', value: `<#${oldState.channelId}>` });
      } else {
        title = 'Moved Voice Channels';
        color = COLORS.yellow;
        fields.push({ name: 'From', value: `<#${oldState.channelId}>` }, { name: 'To', value: `<#${newState.channelId}>` });
      }
    } else if (newState.channelId && oldState.serverMute !== newState.serverMute) {
      title = newState.serverMute ? 'Server Muted' : 'Server Unmuted';
      color = COLORS.orange;
      fields.push({ name: 'Channel', value: `<#${newState.channelId}>` });
    } else if (newState.channelId && oldState.serverDeaf !== newState.serverDeaf) {
      title = newState.serverDeaf ? 'Server Deafened' : 'Server Undeafened';
      color = COLORS.orange;
      fields.push({ name: 'Channel', value: `<#${newState.channelId}>` });
    }
    if (!title) return;

    const embed = baseEmbed({
      title,
      description: `${member} (${user.username})`,
      color,
      user,
      footer: `User ID: ${member.id}`,
    }).addFields(fields.map((field) => ({ ...field, inline: true })));
    await sendLog(guild, embed);
  });

  // ----- Channels ----------------------------------------------------------
  on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    const entry = await findAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const embed = baseEmbed({
      title: 'Channel Created',
      description: `<#${channel.id}> (${trunc(channel.name, 100)})`,
      color: COLORS.green,
      footer: `Channel ID: ${channel.id}`,
    }).addFields({ name: 'Type', value: channelTypeName(channel.type), inline: true });
    addExecutor(embed, entry, 'Created by');
    await sendLog(channel.guild, embed);
  });

  on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild) return;
    const entry = await findAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    const embed = baseEmbed({
      title: 'Channel Deleted',
      description: `#${trunc(channel.name, 100)}`,
      color: COLORS.red,
      footer: `Channel ID: ${channel.id}`,
    }).addFields({ name: 'Type', value: channelTypeName(channel.type), inline: true });
    addExecutor(embed, entry, 'Deleted by');
    await sendLog(channel.guild, embed);
  });

  on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push({ name: 'Name', value: `${fieldValue(oldChannel.name, 400)} → ${fieldValue(newChannel.name, 400)}` });
    if ((oldChannel.topic ?? null) !== (newChannel.topic ?? null)) changes.push({ name: 'Topic', value: `${fieldValue(oldChannel.topic ?? '*(none)*', 400)} → ${fieldValue(newChannel.topic ?? '*(none)*', 400)}` });
    if ((oldChannel.nsfw ?? null) !== (newChannel.nsfw ?? null)) changes.push({ name: 'Age-Restricted', value: `${oldChannel.nsfw} → ${newChannel.nsfw}` });
    if ((oldChannel.rateLimitPerUser ?? null) !== (newChannel.rateLimitPerUser ?? null)) changes.push({ name: 'Slowmode', value: `${oldChannel.rateLimitPerUser ?? 0}s → ${newChannel.rateLimitPerUser ?? 0}s` });
    if ((oldChannel.parentId ?? null) !== (newChannel.parentId ?? null)) {
      changes.push({
        name: 'Category',
        value: `${oldChannel.parentId ? `<#${oldChannel.parentId}>` : '*(none)*'} → ${newChannel.parentId ? `<#${newChannel.parentId}>` : '*(none)*'}`,
      });
    }
    const overwrites = (channel) =>
      channel.permissionOverwrites?.cache
        .map((o) => `${o.id}:${o.allow.bitfield}:${o.deny.bitfield}`)
        .sort()
        .join('|') ?? '';
    if (overwrites(oldChannel) !== overwrites(newChannel)) changes.push({ name: 'Permissions', value: 'Permission overwrites were changed.' });
    if (!changes.length) return;

    const entry = await findAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const embed = baseEmbed({
      title: 'Channel Updated',
      description: `<#${newChannel.id}>`,
      color: COLORS.yellow,
      footer: `Channel ID: ${newChannel.id}`,
    }).addFields(changes.map((change) => ({ ...change, inline: false })));
    addExecutor(embed, entry, 'Changed by');
    await sendLog(newChannel.guild, embed);
  });

  on(Events.ThreadCreate, async (thread) => {
    if (!thread.guild) return;
    const embed = baseEmbed({
      title: 'Thread Created',
      description: `<#${thread.id}> (${trunc(thread.name, 100)})`,
      color: COLORS.green,
      footer: `Thread ID: ${thread.id}`,
    });
    if (thread.parentId) embed.addFields({ name: 'Parent Channel', value: `<#${thread.parentId}>`, inline: true });
    if (thread.ownerId) embed.addFields({ name: 'Created by', value: `<@${thread.ownerId}>`, inline: true });
    await sendLog(thread.guild, embed);
  });

  on(Events.ThreadDelete, async (thread) => {
    if (!thread.guild) return;
    const embed = baseEmbed({
      title: 'Thread Deleted',
      description: trunc(thread.name, 100),
      color: COLORS.red,
      footer: `Thread ID: ${thread.id}`,
    });
    await sendLog(thread.guild, embed);
  });

  // ----- Roles -------------------------------------------------------------
  on(Events.GuildRoleCreate, async (role) => {
    const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);
    const embed = baseEmbed({
      title: 'Role Created',
      description: `<@&${role.id}> (${trunc(role.name, 100)})`,
      color: COLORS.green,
      footer: `Role ID: ${role.id}`,
    });
    addExecutor(embed, entry, 'Created by');
    await sendLog(role.guild, embed);
  });

  on(Events.GuildRoleDelete, async (role) => {
    const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);
    const embed = baseEmbed({
      title: 'Role Deleted',
      description: trunc(role.name, 100),
      color: COLORS.red,
      footer: `Role ID: ${role.id}`,
    });
    addExecutor(embed, entry, 'Deleted by');
    await sendLog(role.guild, embed);
  });

  on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push({ name: 'Name', value: `${fieldValue(oldRole.name, 400)} → ${fieldValue(newRole.name, 400)}` });
    if (oldRole.hexColor !== newRole.hexColor) changes.push({ name: 'Color', value: `${oldRole.hexColor} → ${newRole.hexColor}` });
    if (oldRole.hoist !== newRole.hoist) changes.push({ name: 'Displayed Separately', value: `${oldRole.hoist} → ${newRole.hoist}` });
    if (oldRole.mentionable !== newRole.mentionable) changes.push({ name: 'Mentionable', value: `${oldRole.mentionable} → ${newRole.mentionable}` });
    const grantedPermissions = oldRole.permissions.missing(newRole.permissions);
    const revokedPermissions = newRole.permissions.missing(oldRole.permissions);
    if (grantedPermissions.length) changes.push({ name: 'Permissions Added', value: fieldValue(grantedPermissions.join(', ')) });
    if (revokedPermissions.length) changes.push({ name: 'Permissions Removed', value: fieldValue(revokedPermissions.join(', ')) });
    if (!changes.length) return;

    const entry = await findAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const embed = baseEmbed({
      title: 'Role Updated',
      description: `<@&${newRole.id}>`,
      color: COLORS.yellow,
      footer: `Role ID: ${newRole.id}`,
    }).addFields(changes.map((change) => ({ ...change, inline: false })));
    addExecutor(embed, entry, 'Changed by');
    await sendLog(newRole.guild, embed);
  });

  // ----- Emojis ------------------------------------------------------------
  on(Events.GuildEmojiCreate, async (emoji) => {
    const embed = baseEmbed({
      title: 'Emoji Created',
      description: `${emoji} \`:${trunc(emoji.name, 80)}:\``,
      color: COLORS.green,
      footer: `Emoji ID: ${emoji.id}`,
    }).setThumbnail(emoji.imageURL());
    await sendLog(emoji.guild, embed);
  });

  on(Events.GuildEmojiDelete, async (emoji) => {
    const embed = baseEmbed({
      title: 'Emoji Deleted',
      description: `\`:${trunc(emoji.name, 80)}:\``,
      color: COLORS.red,
      footer: `Emoji ID: ${emoji.id}`,
    }).setThumbnail(emoji.imageURL());
    await sendLog(emoji.guild, embed);
  });

  on(Events.GuildEmojiUpdate, async (oldEmoji, newEmoji) => {
    if (oldEmoji.name === newEmoji.name) return;
    const embed = baseEmbed({
      title: 'Emoji Renamed',
      description: `${newEmoji} \`:${trunc(oldEmoji.name, 80)}:\` → \`:${trunc(newEmoji.name, 80)}:\``,
      color: COLORS.yellow,
      footer: `Emoji ID: ${newEmoji.id}`,
    });
    await sendLog(newEmoji.guild, embed);
  });

  // ----- Invites -----------------------------------------------------------
  on(Events.InviteCreate, async (invite) => {
    const guild = invite.guild?.id ? client.guilds.cache.get(invite.guild.id) : null;
    if (!guild) return;
    const embed = baseEmbed({
      title: 'Invite Created',
      description: `\`${invite.code}\``,
      color: COLORS.green,
      user: invite.inviter ?? undefined,
      footer: `Invite code: ${invite.code}`,
    }).addFields(
      { name: 'Channel', value: invite.channelId ? `<#${invite.channelId}>` : 'Unknown', inline: true },
      { name: 'Created by', value: invite.inviter ? `<@${invite.inviter.id}>` : 'Unknown', inline: true },
      { name: 'Max Uses', value: invite.maxUses ? String(invite.maxUses) : 'Unlimited', inline: true },
      { name: 'Expires', value: invite.expiresTimestamp ? stamp(invite.expiresTimestamp) : 'Never', inline: false },
    );
    await sendLog(guild, embed);
  });

  on(Events.InviteDelete, async (invite) => {
    const guild = invite.guild?.id ? client.guilds.cache.get(invite.guild.id) : null;
    if (!guild) return;
    const embed = baseEmbed({
      title: 'Invite Deleted',
      description: `\`${invite.code}\``,
      color: COLORS.red,
      footer: `Invite code: ${invite.code}`,
    });
    if (invite.channelId) embed.addFields({ name: 'Channel', value: `<#${invite.channelId}>`, inline: true });
    await sendLog(guild, embed);
  });

  // ----- Server ------------------------------------------------------------
  on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push({ name: 'Name', value: `${fieldValue(oldGuild.name, 400)} → ${fieldValue(newGuild.name, 400)}` });
    if (oldGuild.icon !== newGuild.icon) changes.push({ name: 'Icon', value: 'The server icon was changed.' });
    if (oldGuild.ownerId !== newGuild.ownerId) changes.push({ name: 'Owner', value: `<@${oldGuild.ownerId}> → <@${newGuild.ownerId}>` });
    if (!changes.length) return;

    const entry = await findAuditEntry(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
    const embed = baseEmbed({
      title: 'Server Updated',
      color: COLORS.yellow,
      footer: `Server ID: ${newGuild.id}`,
    }).addFields(changes.map((change) => ({ ...change, inline: false })));
    addExecutor(embed, entry, 'Changed by');
    await sendLog(newGuild, embed);
  });
}

export default { register };
