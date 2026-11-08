// ⚙️ SYSTEM SETTINGS
const AUTO_ROLE_ID = '1566093975473889521'; // 🏷️ Paste the Role ID you want automatically assigned here

export default {
    name: 'guildMemberAdd', // Uses the same event hook; Discord.js splits this across files perfectly!
    async execute(member) {
        const { guild } = member;

        try {
            const roleToAssign = guild.roles.cache.get(AUTO_ROLE_ID);
            
            if (!roleToAssign) {
                return console.error(`[AUTO-ROLE ERROR] Role ID ${AUTO_ROLE_ID} was not found in this server.`);
            }

            // Hierarchy safety check: Bot role must be physically above the target role in Server Settings
            if (roleToAssign.position >= guild.members.me.roles.highest.position) {
                return console.warn(`[WARNING] Cannot assign role "${roleToAssign.name}" because it sits higher than or equal to my highest role!`);
            }

            // Assign the role to the arriving user
            await member.roles.add(roleToAssign);
            console.log(`[AUTO-ROLE] Successfully assigned "${roleToAssign.name}" to ${member.user.username}`);

        } catch (error) {
            console.error('[AUTO-ROLE ERROR] Failed to execute role assignment:', error);
        }
    }
};