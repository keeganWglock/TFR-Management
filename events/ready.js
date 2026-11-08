import { Events } from 'discord.js';
import { registerGuildCommands } from '../utils/loader.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[READY] Logged in as ${client.user.tag}!`);
    for (const guild of client.guilds.cache.values()) {
      await registerGuildCommands(client, guild);
      // Fill the member cache so the server logger can compare old/new member data.
      await guild.members.fetch().catch((error) => {
        console.warn(`[READY] Could not fetch members for ${guild.name}: ${error.message}`);
      });
    }
  },
};
