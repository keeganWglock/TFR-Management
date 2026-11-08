import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// ⚙️ MAKE SURE THIS ID MATCHES YOUR SERVER'S WELCOME CHANNEL PERFECTLY
const WELCOME_CHANNEL_ID = '1563765848680956006';

export default {
    name: 'guildMemberAdd',
    async execute(member) {
        const { guild } = member;
        const channel = guild.channels.cache.get(WELCOME_CHANNEL_ID);

        if (!channel) {
            return console.error(`[WELCOME ERROR] Channel ID ${WELCOME_CHANNEL_ID} not found.`);
        }

        // Clean plain text greeting replacing the old embed structure
        const welcomeText = `👋 Welcome ${member} to **${guild.name}**! We hope you enjoy your stay with us.`;

        // 🔘 Action Row with the live member count display button first
        const row = new ActionRowBuilder().addComponents(
            // 👥 This creates an unclickable button serving as an aesthetic stats tracker badge
            new ButtonBuilder()
                .setCustomId('welcome_member_count')
                .setLabel(`👥 ${guild.memberCount}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),

            // This Button Creator is a link button.
            new ButtonBuilder()
                .setLabel('Bulletin')
                .setURL('https://discord.com/channels/1563765847598571663/1563766360759205908')
                .setStyle(ButtonStyle.Link)
        );

        try {
            await channel.send({
                content: welcomeText,
                components: [row]
            });
        } catch (error) {
            console.error('[WELCOME SYSTEM ERROR] Failed to send message:', error);
        }
    }
};


/*
====================================================================
📝 WELCOME SYSTEM REUSABLE PLACEHOLDERS CHEAT SHEET
====================================================================

You can use these data strings anywhere inside your welcome embed 
descriptions, titles, field names, or text content:

• \`\${member}\`           -> Pings the joining user (e.g., @Keegan)
• \`\${member.user.username}\` -> The plain text name of the user (e.g., keegan_dev)
• \`\${member.id}\`          -> The unique 18-digit Discord ID of the user
• \`\${guild.name}\`        -> The current name of your Discord server
• \`\${guild.memberCount}\`  -> The total member count after they join (e.g., 1450)

--------------------------------------------------------------------
🕒 DYNAMIC MARKDOWN TIMESTAMPS:
--------------------------------------------------------------------
Discord auto-translates these into the user's local timezone:

• Created Relative: \`<t:\${Math.floor(member.user.createdTimestamp / 1000)}:R>\`
  ↳ Displays as: "3 years ago" or "2 months ago"
  
• Created Full:     \`<t:\${Math.floor(member.user.createdTimestamp / 1000)}:F>\`
  ↳ Displays as: "Monday, June 15, 2023 4:30 PM"

====================================================================
*/
