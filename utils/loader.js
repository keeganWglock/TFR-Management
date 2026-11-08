import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMMANDS_DIR, EVENTS_DIR } from './paths.js';

async function importDir(dir) {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.js'));
  const modules = [];
  for (const file of files) {
    try {
      modules.push({ file, mod: await import(pathToFileURL(path.join(dir, file)).href) });
    } catch (error) {
      console.error(`[LOAD ERROR] ${file}:`, error);
    }
  }
  return modules;
}

// Slash commands export default { data, execute(interaction) }.
// Prefix commands export default { name, aliases?, execute(message, args, argsText) }.
export async function loadCommands(client) {
  for (const { file, mod } of await importDir(COMMANDS_DIR)) {
    const command = mod.default;
    const handler = typeof command?.execute === 'function'
      ? command.execute
      : typeof command?.executeSlash === 'function'
        ? command.executeSlash
        : null;

    if (!command || typeof handler !== 'function') {
      console.warn(`[LOAD] commands/${file} has no default export with an execute() function - skipped.`);
      continue;
    }

    const normalizedCommand = { ...command, execute: handler };

    if (normalizedCommand.data) {
      client.slashCommands.set(normalizedCommand.data.name, normalizedCommand);
      console.log(`[LOAD] Slash command /${normalizedCommand.data.name}`);
    } else if (normalizedCommand.name) {
      for (const key of [normalizedCommand.name, ...(normalizedCommand.aliases ?? [])]) {
        client.prefixCommands.set(key.toLowerCase(), normalizedCommand);
      }
      console.log(`[LOAD] Prefix command ${normalizedCommand.name}`);
    } else {
      console.warn(`[LOAD] commands/${file} needs either "data" or "name" - skipped.`);
    }
  }
}

// Event files export default { name, once?, execute(...args) } or { register(client) }.
export async function loadEvents(client) {
  for (const { file, mod } of await importDir(EVENTS_DIR)) {
    const event = mod.default;
    if (!event) continue;
    if (typeof event.register === 'function') {
      event.register(client);
      console.log(`[LOAD] Event module ${file}`);
    } else if (event.name && typeof event.execute === 'function') {
      const handler = (...args) => event.execute(...args);
      if (event.once) client.once(event.name, handler);
      else client.on(event.name, handler);
      console.log(`[LOAD] Event ${event.name}`);
    }
  }
}

export async function registerGuildCommands(client, guild) {
  const body = [...client.slashCommands.values()].map((command) => command.data.toJSON());
  try {
    await guild.commands.set(body);
    console.log(`[SUCCESS] Registered ${body.length} slash command(s) for ${guild.name} (${guild.id})`);
  } catch (error) {
    console.error(`[ERROR] Failed to register commands for ${guild.name} (${guild.id}):`, error.message);
  }
}
