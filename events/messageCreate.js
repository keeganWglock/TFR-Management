import { Events } from 'discord.js';

const PREFIX = '-';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;

    if (!message.guild) {
      return;
    }

    if (!message.content.startsWith(PREFIX)) return;

    let rest = message.content.slice(PREFIX.length).trim();
    if (!rest) return;

    // Supports two-word commands such as "-mass shift" as well as "-say".
    const tokens = rest.split(/\s+/);
    let command = null;
    let consumed = 0;
    if (tokens.length >= 2) {
      command = message.client.prefixCommands.get(`${tokens[0]} ${tokens[1]}`.toLowerCase());
      consumed = 2;
    }
    if (!command) {
      command = message.client.prefixCommands.get(tokens[0].toLowerCase());
      consumed = 1;
    }
    if (!command) return;

    // Strip the command words but keep the rest exactly as typed (newlines included).
    for (let i = 0; i < consumed; i++) rest = rest.replace(/^\S+\s*/, '');
    const args = rest ? rest.split(/\s+/) : [];

    try {
      await command.execute(message, args, rest);
    } catch (error) {
      console.error(`[PREFIX ERROR] ${command.name}:`, error);
      await message.reply('❌ Something went wrong running that command.').catch(() => {});
    }
  },
};
