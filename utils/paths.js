import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COMMANDS_DIR = path.join(ROOT_DIR, 'commands');
export const EVENTS_DIR = path.join(ROOT_DIR, 'events');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const CONFIG_DIR = path.join(ROOT_DIR, 'config');
export const DATABASE_DIR = path.join(ROOT_DIR, 'database');