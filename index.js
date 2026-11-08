import path from 'node:path';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import { ROOT_DIR } from './utils/paths.js';
import { loadCommands, loadEvents } from './utils/loader.js';

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const token = process.env.BOT_TOKEN?.trim();
if (!token) {
  console.error('[FATAL] BOT_TOKEN is not set. Add it to your .env file and restart.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.slashCommands = new Collection();
client.prefixCommands = new Collection();

process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));
process.on('uncaughtException', (error) => console.error('[UNCAUGHT EXCEPTION]', error));

await loadCommands(client);
await loadEvents(client);
try {
  await client.login(token);
} catch (error) {
  console.error('[FATAL] Could not log in - check BOT_TOKEN in your .env:', error.message);
  process.exit(1);
}
