import { isStaff } from './dashboard.js';
import { getTicket } from '../utils/tickets.js';

// Discord text channel names are lowercase, with hyphens instead of spaces and no punctuation.
function toChannelName(input) {
  return input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export default {
  name: 'rename',
  description: 'Renames the ticket channel you are in.',
  async execute(message, args, argsText) {
    if (!isStaff(message.member)) return;
    if (!getTicket(message.channel.id)) {
      return message.reply('This command only works inside a ticket channel.');
    }
    if (!argsText) return message.reply('Usage: `-rename <new name>`');

    const name = toChannelName(argsText);
    if (!name) return message.reply("That name doesn't contain any usable characters.");

    try {
      // Discord only allows 2 renames per channel every 10 minutes, so don't wait forever.
      await Promise.race([
        message.channel.setName(name, `Renamed by ${message.author.username}`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Discord only allows 2 renames per channel every 10 minutes - try again later.')), 15_000)),
      ]);
    } catch (error) {
      return message.reply(`❌ I couldn't rename this ticket: ${error.message}`);
    }
    return message.reply(`✅ Renamed this ticket to **#${name}**.`);
  },
};
