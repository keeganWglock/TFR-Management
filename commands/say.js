import { PermissionFlagsBits } from 'discord.js';
import { ignoredDeletes } from '../utils/state.js';

export default {
  name: 'say',
  description: 'Makes the bot repeat whatever you type after "-say".',
  async execute(message, args, argsText) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    if (!argsText) {
      await message.reply('Usage: `-say <message>`');
      return;
    }

    try {
      // @everyone / @here are blocked; user and role mentions still work.
      await message.channel.send({ content: argsText, allowedMentions: { parse: ['users', 'roles'] } });
    } catch (error) {
      await message.reply(`❌ I couldn't send that: ${error.message}`).catch(() => {});
      return;
    }

    ignoredDeletes.add(message.id);
    await message.delete().catch(() => ignoredDeletes.delete(message.id));
  },
};
