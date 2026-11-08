import { Events } from 'discord.js';
import { registerGuildCommands } from '../utils/loader.js';

export default {
  name: Events.GuildCreate,
  async execute(guild) {
    await registerGuildCommands(guild.client, guild);
  },
};
