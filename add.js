import { PermissionFlagsBits } from 'discord.js';
import { isStaff } from './dashboard.js';
import { getTicket } from '../utils/tickets.js';

export default {
  name: 'add',
  description: 'Adds a user (by ID or mention) to the ticket you are in.',
  async execute(message, args) {
    if (!isStaff(message.member)) return;
    if (!getTicket(message.channel.id)) {
      return message.reply('This command only works inside a ticket channel.');
    }

    const userId = args[0]?.match(/^(?:<@!?)?(\d{17,20})>?$/)?.[1];
    if (!userId) return message.reply('Usage: `-add <user ID>`');

    const member = await message.guild.members.fetch(userId).catch(() => null);
    if (!member) return message.reply("❌ I couldn't find a member with that ID in this server.");

    const existing = message.channel.permissionOverwrites.cache.get(userId);
    if (existing?.allow.has(PermissionFlagsBits.ViewChannel)) {
      return message.reply({ content: `<@${userId}> is already in this ticket.`, allowedMentions: { parse: [] } });
    }

    try {
      await message.channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
      });
    } catch (error) {
      return message.reply(`❌ I couldn't add that user: ${error.message}`);
    }
    return message.channel.send({
      content: `✅ <@${userId}> was added to the ticket by <@${message.author.id}>.`,
      allowedMentions: { parse: [], users: [userId] },
    });
  },
};