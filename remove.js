import { isStaff } from './dashboard.js';
import { getTicket } from '../utils/tickets.js';

export default {
  name: 'remove',
  description: 'Removes a user (by ID or mention) from the ticket you are in.',
  async execute(message, args) {
    if (!isStaff(message.member)) return;
    const ticket = getTicket(message.channel.id);
    if (!ticket) return message.reply('This command only works inside a ticket channel.');

    const userId = args[0]?.match(/^(?:<@!?)?(\d{17,20})>?$/)?.[1];
    if (!userId) return message.reply('Usage: `-remove <user ID>`');

    if (userId === ticket.owner) {
      return message.reply("❌ You can't remove the ticket owner - close the ticket instead.");
    }
    if (userId === message.client.user.id) return message.reply("❌ I can't remove myself from the ticket.");

    if (!message.channel.permissionOverwrites.cache.has(userId)) {
      return message.reply('That user was not added to this ticket individually, so there is nothing to remove.');
    }

    try {
      await message.channel.permissionOverwrites.delete(userId, `Removed by ${message.author.username}`);
    } catch (error) {
      return message.reply(`❌ I couldn't remove that user: ${error.message}`);
    }
    return message.channel.send({
      content: `✅ <@${userId}> was removed from the ticket by <@${message.author.id}>.`,
      allowedMentions: { parse: [] },
    });
  },
};
