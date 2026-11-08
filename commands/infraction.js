import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig } from '../utils/config.js';
import { canUseStaffCommands } from '../utils/permissions.js';
import { postNotice } from '../utils/components.js';

// The notice always goes to this channel, no matter where the command is used.
const INFRACTION_CHANNEL_ID = '1564461003830337566';
// Every infraction is also copied here (with a timestamp).
const INFRACTION_LOG_CHANNEL_ID = '1569089403056300102';
const TEMPLATE_FILE = 'infractionmessage.json';

export default {
  data: new SlashCommandBuilder()
    .setName('infraction')
    .setDescription('Post an infraction notice.')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('user').setDescription('The employee receiving the infraction.').setRequired(true))
    .addStringOption((o) => o.setName('outcome').setDescription('The outcome of the infraction.').setRequired(true).setMaxLength(500))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the infraction.').setRequired(true).setMaxLength(1000)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }
    if (!canUseStaffCommands(interaction.member, getGuildConfig(interaction.guildId))) {
      return interaction.reply({ content: "You don't have permission to post infractions.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('user', true);
    const outcome = interaction.options.getString('outcome', true);
    const reason = interaction.options.getString('reason', true);

    return postNotice({
      interaction,
      templateFile: TEMPLATE_FILE,
      label: 'infraction',
      channelId: INFRACTION_CHANNEL_ID,
      logChannelId: INFRACTION_LOG_CHANNEL_ID,
      mentionUserIds: [user.id],
      fields: {
        Employee: `<@${user.id}>`,
        Reason: reason,
        Outcome: outcome,
      },
    });
  },
};
