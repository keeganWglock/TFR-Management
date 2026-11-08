import { Events, MessageFlags } from 'discord.js';
import { handleButton as handleVerifyButton } from '../commands/verify.js';
import { handleButton as handleShiftButton, isShiftButton } from '../commands/shift.js';
import {
  handleButton as handleFeedbackButton,
  handleModal as handleFeedbackModal,
  isFeedbackInteraction,
} from '../commands/feedback.js';
import { handleButton as handleTicketButton, isTicketInteraction } from '../commands/assistance.js';
import {
  handleButton as handleCareersButton,
  handleModal as handleCareersModal,
  isCareersInteraction,
} from '../commands/careers.js';
import {
  handleButton as handleTrButton,
  handleModal as handleTrModal,
  isTrInteraction,
} from '../commands/tr.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.slashCommands.get(interaction.commandName);
        if (command) await command.execute(interaction);
      } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('verify1:')) await handleVerifyButton(interaction);
        else if (isFeedbackInteraction(interaction.customId)) await handleFeedbackButton(interaction);
        else if (isTicketInteraction(interaction.customId)) await handleTicketButton(interaction);
        else if (isCareersInteraction(interaction.customId)) await handleCareersButton(interaction);
        else if (isShiftButton(interaction.customId)) await handleShiftButton(interaction);
        else if (isTrInteraction(interaction.customId)) await handleTrButton(interaction);
      } else if (interaction.isStringSelectMenu()) {
        if (isTicketInteraction(interaction.customId)) await handleTicketButton(interaction);
        else if (isCareersInteraction(interaction.customId)) await handleCareersButton(interaction);
      } else if (interaction.isModalSubmit()) {
        if (isFeedbackInteraction(interaction.customId)) await handleFeedbackModal(interaction);
        else if (isCareersInteraction(interaction.customId)) await handleCareersModal(interaction);
        else if (isTrInteraction(interaction.customId)) await handleTrModal(interaction);
      }
    } catch (error) {
      console.error('[INTERACTION ERROR]', error);
      const payload = { content: '❌ Something went wrong handling that. Please try again.', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {
        // Interaction expired - nothing else we can do.
      }
    }
  },
};
