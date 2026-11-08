import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { loadTemplate } from '../utils/components.js';

const DASHBOARD_FILE = 'dashboardmessage.json';

export function isStaff(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return Boolean(member.roles?.cache?.has('1563753564067602530'));
}

export default {
  name: 'dashboard',
  description: 'Posts the ticket dashboard from data/dashboardmessage.json.',
  async execute(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return;
    try {
      const components = await loadTemplate(DASHBOARD_FILE);
      await message.channel.send({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
      await message.reply(`Couldn't post the dashboard: ${error.message}`).catch(() => {});
    }
  },
};
