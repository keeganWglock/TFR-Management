import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { fetchSendableChannel, loadTemplate } from '../utils/components.js';
import { createTranscript } from '../utils/transcript.js';
import {
  claimTicketInDb,
  findOpenTicketByOwner,
  generateSupportId,
  getTicket,
  removeTicket,
  saveTicket,
  updateTicket,
} from '../utils/tickets.js';
import { lookupRoblox } from '../utils/roblox.js';

const general_catagory = '1564432900223533218';
const internal_affairs_catagory = '1564433221364621365';
const executive_officers_catagory = '1564433292927963136';
const department_administrative_catagory = '1564802837366710433';
const SUPPORT_ROLE_IDS = {
  general: '1564424983713808445',
  internal_affairs: '1564102920826257438',
  executive_officers: '1564424983038398504',
  department_administrative: '1564424982463914105',
};
const TICKET_LOG_CHANNEL_ID = '1565490837645951037';
const DELETE_DELAY_MS = 5000;
const closing = new Set();

const SUPPORT_FILES = {
  general: 'supportmessagegeneral.json',
  hr: 'supportmessagehr.json',
  internal_affairs: 'supportmessageinternal_affairs.json',
  executive_officers: 'supportmessageexecutive_officers.json',
  department_administrative: 'supportmessagedepartment_administrative.json',
};

const isValidId = (id) => /^\d{17,20}$/.test(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (content) => new TextDisplayBuilder().setContent(content);

export function getAssistanceCategoryId(kind = 'general') {
  const normalized = String(kind ?? '').trim().toLowerCase().replace(/[-_\s]+/g, '');
  const categoryId =
    ['internalaffairs', 'ia', 'internalaffairssupport', 'internal-affairs-support', 'internalaffairsupport'].includes(normalized)
      ? internal_affairs_catagory
      : ['executiveofficers', 'executiveofficer', 'executive', 'executiveofficeresupport'].includes(normalized)
        ? executive_officers_catagory
        : ['departmentadministrative', 'departmentadmin', 'deptadmin', 'administrative', 'departmentadministrativesupport'].includes(normalized)
          ? department_administrative_catagory
          : general_catagory;

  if (!categoryId || categoryId === 'YOUR_GENERAL_CATEGORY_ID' || categoryId === 'YOUR_INTERNAL_AFFAIRS_CATEGORY_ID' || categoryId === 'YOUR_EXECUTIVE_OFFICERS_CATEGORY_ID' || categoryId === 'YOUR_DEPARTMENT_ADMINISTRATIVE_CATEGORY_ID') {
    throw new Error('No assistance ticket category is configured in assistance.js. Set the category IDs for each assistance path.');
  }

  return categoryId;
}

export function isTicketInteraction(customId) {
  return typeof customId === 'string' && customId.startsWith('ticket:');
}

export function resolveTicketCategoryId(kind = 'general') {
  const normalized = String(kind ?? '').trim().toLowerCase().replace(/[-_\s]+/g, '');

  if (['general', 'support', 'default'].includes(normalized)) return general_catagory;
  if (['internalaffairs', 'ia', 'internalaffairssupport', 'internalaffairsupport'].includes(normalized)) return internal_affairs_catagory;
  if (['executiveofficers', 'executiveofficer', 'executive'].includes(normalized)) return executive_officers_catagory;
  if (['departmentadministrative', 'departmentadmin', 'deptadmin', 'administrative'].includes(normalized)) return department_administrative_catagory;

  return general_catagory || internal_affairs_catagory || executive_officers_catagory || department_administrative_catagory;
}

function ticketInfo(channel) {
  return channel ? getTicket(channel.id) : null;
}

export function isStaff(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roleIds = Object.values(SUPPORT_ROLE_IDS);
  return roleIds.some((roleId) => member.roles?.cache?.has(roleId));
}

function walkText(nodes, visit) {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 10 && typeof node.content === 'string') visit(node);
    if (Array.isArray(node.components)) walkText(node.components, visit);
  }
}

function ensureTicketButtons(components) {
  const json = JSON.stringify(components);
  if (json.includes('"ticket:claim"') && json.includes('"ticket:close"')) return components;
  const row = {
    type: 1,
    components: [
      { type: 2, style: 3, label: 'Claim', custom_id: 'ticket:claim' },
      { type: 2, style: 4, label: 'Close', custom_id: 'ticket:close' },
    ],
  };
  const container = components.find((c) => c?.type === 17 && Array.isArray(c.components));
  if (container) container.components.push(row);
  else components.push(row);
  return components;
}

async function createTicket(interaction, kind = 'general') {
  const reply = (content) => interaction.editReply({ content });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const normalizedKind = String(kind ?? '').trim().toLowerCase().replace(/[-_\s]+/g, '');
  const categoryId = resolveTicketCategoryId(kind);
  const supportRoleId = SUPPORT_ROLE_IDS[normalizedKind] ?? SUPPORT_ROLE_IDS.general;
  if (!isValidId(categoryId) || !isValidId(supportRoleId)) {
    return reply('❌ Tickets are not set up yet. Set the category IDs for each assistance path in assistance.js.');
  }

  const guild = interaction.guild;
  const user = interaction.user;
  const existing = findOpenTicketByOwner(guild, user.id);
  if (existing) return reply(`❌ You already have an open ticket: <#${existing}>`);

  let channel;
  let supportId;
  try {
    const ticketOwnerMember = guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
    const supportRole = guild.roles.cache.get(supportRoleId) ?? (await guild.roles.fetch(supportRoleId).catch(() => null));
    const botMember = guild.members.me ?? guild.members.cache.get(interaction.client.user.id) ?? (await guild.members.fetch({ user: interaction.client.user.id, force: true }).catch(() => null));

    if (!guild.roles.everyone) throw new Error('The guild everyone role could not be resolved.');
    if (!ticketOwnerMember && !user) throw new Error('The ticket owner could not be resolved.');
    if (!supportRole) throw new Error(`Support role ${supportRoleId} could not be resolved.`);
    if (!botMember) throw new Error('The bot member could not be resolved for the ticket channel permissions.');

    supportId = generateSupportId();
    const name = `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 90) || `ticket-${user.id}`;
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: supportId,
      reason: `Ticket opened by ${user.username}`,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: ticketOwnerMember ?? user,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
        },
        {
          id: supportRole,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
        },
        {
          id: botMember,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
        },
      ],
    });
  } catch (error) {
    console.error('[TICKET] Could not create the ticket channel:', error);
    return reply(`❌ Couldn't create your ticket: ${error.message}`);
  }

  saveTicket(channel.id, { guildId: guild.id, owner: user.id, supportId, claimedBy: null, roblox: null });

  let roblox = null;
  try {
    roblox = await lookupRoblox(guild.id, user.id);
    if (roblox) updateTicket(channel.id, { roblox });
  } catch (error) {
    console.warn(`[TICKET] Roblox lookup failed for ${user.id}: ${error.message}`);
  }

  try {
    const templateFile = SUPPORT_FILES[kind] ?? SUPPORT_FILES.general;
    const components = await loadTemplate(templateFile);
    walkText(components, (node) => {
      node.content = node.content
        .replaceAll('{user}', () => `<@${user.id}>`)
        .replaceAll('{support}', () => `<@&${supportRoleId}>`)
        .replaceAll('{supportid}', () => supportId)
        .replace(/\{robloxid\}/gi, () => roblox?.id ?? 'Not verified')
        .replace(/\{robloxurl\}/gi, () => roblox?.profile ?? 'Not verified')
        .replace(/\{roblox\}/gi, () => roblox?.name ?? 'Not verified');
    });
    await channel.send({
      components: ensureTicketButtons(components),
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], users: [user.id], roles: [supportRoleId] },
    });
  } catch (error) {
    console.error('[TICKET] Could not post the support message:', error);
    await channel.send({ content: `<@${user.id}> your ticket was created, but the support message failed to load: ${error.message}` }).catch(() => {});
  }

  return reply(`✅ Your ticket has been created: <#${channel.id}>`);
}

async function claimTicket(interaction) {
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  const channel = interaction.channel;
  const info = ticketInfo(channel);
  if (!info) return ephemeral('This is not a ticket channel.');
  if (!isStaff(interaction.member)) return ephemeral('Only support staff can claim tickets.');

  const result = claimTicketInDb(channel.id, interaction.user.id);
  if (!result.ok) {
    return ephemeral(
      result.claimedBy === interaction.user.id
        ? 'You have already claimed this ticket.'
        : `This ticket was already claimed by <@${result.claimedBy}>.`,
    );
  }

  return interaction.reply({
    content: `<@${interaction.user.id}> has claimed the ticket.`,
    allowedMentions: { parse: [] },
  });
}

function buildCloseLog({ channel, info, closer, transcriptUrl }) {
  const lines = [
    `**Support ID:** ${info.supportId ?? 'Unknown'}`,
    `**Opened By:** ${info.owner ? `<@${info.owner}>` : 'Unknown'}`,
    `**Roblox:** ${info.roblox ? `[${info.roblox.name}](${info.roblox.profile}) (${info.roblox.id})` : 'Not verified'}`,
    `**Closed By:** <@${closer.id}>`,
  ];
  if (info.claimedBy) lines.push(`**Claimed By:** <@${info.claimedBy}>`);
  lines.push(`**Ticket:** #${channel.name}`, `**Closed At:** <t:${Math.floor(Date.now() / 1000)}:F>`);

  return new ContainerBuilder()
    .addTextDisplayComponents(text('## Ticket Closed'))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text(lines.join('\n')))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Transcript').setStyle(ButtonStyle.Link).setURL(transcriptUrl),
      ),
    );
}

async function closeTicket(interaction) {
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  const channel = interaction.channel;
  const info = ticketInfo(channel);
  if (!info) return ephemeral('This is not a ticket channel.');
  if (!isStaff(interaction.member) && interaction.user.id !== info.owner) {
    return ephemeral('Only support staff or the ticket owner can close this ticket.');
  }
  if (!isValidId(TICKET_LOG_CHANNEL_ID)) {
    return ephemeral('❌ The ticket log channel is not set up yet.');
  }
  if (closing.has(channel.id)) return ephemeral('This ticket is already being closed.');

  closing.add(channel.id);
  await interaction.reply({ content: 'Closing soon, saving transcript.' });

  let transcriptUrl;
  try {
    transcriptUrl = await createTranscript(interaction.client, channel.id);
  } catch (error) {
    console.error('[TICKET] Transcript failed:', error);
    closing.delete(channel.id);
    await channel.send({ content: `❌ I couldn't save the transcript (${error.message}). The ticket was left open - press **Close** to try again.` }).catch(() => {});
    return;
  }

  try {
    const logChannel = await fetchSendableChannel(interaction.client, TICKET_LOG_CHANNEL_ID);
    await logChannel.send({
      components: [buildCloseLog({ channel, info, closer: interaction.user, transcriptUrl })],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error('[TICKET] Could not write the close log:', error);
    closing.delete(channel.id);
    await channel.send({ content: `❌ I couldn't post the log (${error.message}). Transcript: ${transcriptUrl}\nThe ticket was left open.` }).catch(() => {});
    return;
  }

  await sleep(DELETE_DELAY_MS);
  try {
    await channel.delete(`Ticket closed by ${interaction.user.username}`);
    removeTicket(channel.id);
  } catch (error) {
    console.error('[TICKET] Could not delete the ticket channel:', error);
    await channel.send({ content: '⚠️ The log was saved, but I could not delete this channel. Please delete it manually.' }).catch(() => {});
  } finally {
    closing.delete(channel.id);
  }
}

export function buildSupportSelectMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket:type_select')
      .setPlaceholder('Select support type')
      .addOptions(
        { label: 'General Support', description: 'Open a general support ticket', value: 'general' },
        { label: 'Internal Affairs Support', description: 'Open an internal affairs support ticket', value: 'internal_affairs' },
        { label: 'Executive Officers', description: 'Open an executive officers support ticket', value: 'executive_officers' },
        { label: 'Department Administrative', description: 'Open a department administrative support ticket', value: 'department_administrative' },
      ),
  );
}

export async function handleButton(interaction) {
  if (!interaction.inGuild()) return;
  if (interaction.customId === 'ticket:create' || interaction.customId === 'ticket:create:general') return createTicket(interaction, 'general');
  if (interaction.customId === 'ticket:create:internal_affairs' || interaction.customId === 'ticket:create:internalaffairs' || interaction.customId === 'ticket:create:ia') return createTicket(interaction, 'internal_affairs');
  if (interaction.customId === 'ticket:create:executive_officers' || interaction.customId === 'ticket:create:executiveofficers') return createTicket(interaction, 'executive_officers');
  if (interaction.customId === 'ticket:create:department_administrative' || interaction.customId === 'ticket:create:departmentadministrative' || interaction.customId === 'ticket:create:department_admin') return createTicket(interaction, 'department_administrative');
  if (interaction.customId === 'ticket:type_select' && interaction.values?.length) return createTicket(interaction, interaction.values[0]);
  if (interaction.customId === 'ticket:claim') return claimTicket(interaction);
  if (interaction.customId === 'ticket:close') return closeTicket(interaction);
}

export function openAssistanceTicket(interaction, kind = 'general') {
  const ticketType = kind === 'hr' || kind === 'highrank' || kind === 'high_ranking' ? 'hr' : 'general';
  const categoryId = getAssistanceCategoryId(ticketType);

  return handleButton({
    ...interaction,
    categoryId,
    customId: `ticket:create:${ticketType}`,
    values: [ticketType],
    channel: interaction.channel,
    guild: interaction.guild,
    user: interaction.user,
    member: interaction.member,
    client: interaction.client,
    deferReply: interaction.deferReply?.bind(interaction),
    editReply: interaction.editReply?.bind(interaction),
    reply: interaction.reply?.bind(interaction),
    inGuild: () => Boolean(interaction.guild),
  });
}

export default {
  name: 'assistance',
  description: 'Posts the support type selector for general and high-ranking support tickets.',
  async execute(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return;

    try {
      const components = await loadTemplate('assistancemessage.json');
      await message.channel.send({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
      await message.reply(`Couldn't post the support selector: ${error.message}`).catch(() => {});
    }
  },
};
