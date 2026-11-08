import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig } from '../utils/config.js';
import { canUseStaffCommands } from '../utils/permissions.js';
import { postNotice } from '../utils/components.js';

// The notice always goes to this channel, no matter where the command is used.
const PROMOTION_CHANNEL_ID = '1563893509487067257';
// Every promotion is also copied here (with a timestamp).
const PROMOTION_LOG_CHANNEL_ID = '1569089373897625661';
const TEMPLATE_FILE = 'promotionmessage.json';

export default {
  data: new SlashCommandBuilder()
    .setName('promotion')
    .setDescription('Post a promotion notice.')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('employee').setDescription('The employee being promoted.').setRequired(true))
    .addRoleOption((o) => o.setName('new_rank').setDescription('Their new rank.').setRequired(true))
    .addStringOption((o) => o.setName('new_callsign').setDescription('Their new callsign.').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the promotion.').setRequired(true).setMaxLength(1000)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }
    if (!canUseStaffCommands(interaction.member, getGuildConfig(interaction.guildId))) {
      return interaction.reply({ content: "You don't have permission to post promotions.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const employee = interaction.options.getUser('employee', true);
    const rank = interaction.options.getRole('new_rank', true);
    const callsign = interaction.options.getString('new_callsign', true);
    const reason = interaction.options.getString('reason', true);

    return postNotice({
      interaction,
      templateFile: TEMPLATE_FILE,
      label: 'promotion',
      channelId: PROMOTION_CHANNEL_ID,
      logChannelId: PROMOTION_LOG_CHANNEL_ID,
      mentionUserIds: [employee.id],
      fields: {
        Employee: `<@${employee.id}>`,
        Reason: reason,
        'New Rank': `<@&${rank.id}>`,
        'New Callsign': callsign,
      },
    });
  },
};
