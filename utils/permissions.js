import { PermissionFlagsBits } from 'discord.js';

// Who may use /promotion and /infraction:
// anyone with Manage Server, or the requiredAdminRoleID from serversConfig.json.
export function canUseStaffCommands(member, config) {
  if (!member || !member.permissions) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const roleId = config?.requiredAdminRoleID;
  return Boolean(roleId && member.roles?.cache?.has(roleId));
}
