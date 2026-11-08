import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { fetchSendableChannel, loadTemplate } from '../utils/components.js';
import {
  FEEDBACK_CHANNEL_ID,
  PANEL_FILE,
  addRating,
  buildFeedbackMessage,
  buildStatsEmbed,
  getCounts,
  isValidId,
} from '../utils/feedback.js';

const MODAL_ID = 'feedback:modal';

export function isFeedbackInteraction(customId) {
  return customId.startsWith('feedback:');
}

function buildModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Employee Feedback')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Who are you giving feedback to?')
        .setUserSelectMenuComponent(
          new UserSelectMenuBuilder()
            .setCustomId('employee')
            .setPlaceholder('Select an employee')
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Rating')
        .setDescription('Enter a number from 1 to 5 (5 is the best).')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('rating')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(1)
            .setPlaceholder('1-5')
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Feedback')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('feedback')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setPlaceholder('Your feedback on this employee')
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Service (optional)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('service')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(300)
            .setRequired(false),
        ),
    );
}

// "Leave Feedback" button, and the "View Ratings" button on every feedback post.
export async function handleButton(interaction) {
  if (interaction.customId === 'feedback:open') {
    return interaction.showModal(buildModal());
  }

  if (interaction.customId.startsWith('feedback:stats:')) {
    const employeeId = interaction.customId.split(':')[2];
    if (!interaction.guildId || !isValidId(employeeId)) return;
    return interaction.reply({
      embeds: [buildStatsEmbed(employeeId, getCounts(interaction.guildId, employeeId))],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
}

export async function handleModal(interaction) {
  if (interaction.customId !== MODAL_ID) return;
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!interaction.inGuild()) return reply('This can only be used in a server.');

  const employee = interaction.fields.getSelectedUsers('employee', true).first();
  const ratingText = interaction.fields.getTextInputValue('rating').trim();
  const feedback = interaction.fields.getTextInputValue('feedback').trim();
  const service = (interaction.fields.getTextInputValue('service') ?? '').trim();

  if (!employee) return reply('❌ Please select an employee.');
  if (employee.bot) return reply('❌ You can\'t leave feedback for a bot.');
  if (employee.id === interaction.user.id) return reply('❌ You can\'t leave feedback for yourself.');
  if (!/^[1-5]$/.test(ratingText)) return reply('❌ The rating must be a single number from 1 to 5.');
  if (!feedback) return reply('❌ Please write some feedback.');
  if (!isValidId(FEEDBACK_CHANNEL_ID)) {
    return reply('❌ The feedback channel has not been set up yet (FEEDBACK_CHANNEL_ID in utils/feedback.js).');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const stars = Number(ratingText);
  const signedBy = interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;

  try {
    const components = await buildFeedbackMessage({ employeeId: employee.id, stars, feedback, service, signedBy });
    const channel = await fetchSendableChannel(interaction.client, FEEDBACK_CHANNEL_ID);
    await channel.send({
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], users: [employee.id] },
    });
  } catch (error) {
    console.error('[FEEDBACK] Failed to post feedback:', error);
    return interaction.editReply({ content: `❌ Couldn't post your feedback: ${error.message}` });
  }

  addRating(interaction.guildId, employee.id, stars); // counted only once it was posted
  return interaction.editReply({ content: `✅ Your feedback for <@${employee.id}> was submitted in <#${FEEDBACK_CHANNEL_ID}>.` });
}

// "-feedback" posts the main panel in the current channel.
export default {
  name: 'feedback',
  description: 'Posts the employee feedback panel from data/feedbackpanelmessage.json.',
  async execute(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return;
    try {
      const components = await loadTemplate(PANEL_FILE);
      if (!JSON.stringify(components).includes('"feedback:open"')) {
        throw new Error(`${PANEL_FILE} has no button with custom_id "feedback:open".`);
      }
      await message.channel.send({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
      await message.reply(`Couldn't post the feedback panel: ${error.message}`).catch(() => {});
    }
  },
};
