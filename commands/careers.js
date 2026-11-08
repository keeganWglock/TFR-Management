import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { loadTemplate } from '../utils/components.js';

const CAREERS_FILE = 'careersmessage.json';
const APPLICATION_FILES = {
  tfr_application: 'tfrapplicationmessage.json',
  tfr_ems: 'tfremsmessage.json',
  tfr_pio: 'piomessage.json',
  tfr_fire_marshal: 'firemarshalmessage.json',
};

export function isCareersInteraction(customId) {
  return typeof customId === 'string' && customId.startsWith('careers:');
}

export async function handleButton(interaction) {
  if (!interaction.isStringSelectMenu() || !interaction.values?.length) return;

  const validIds = new Set(['careers:department_select', 'careers:division_select', 'careers:apply_select']);
  if (!validIds.has(interaction.customId)) return;

  const selectedValue = interaction.values[0];
  const templateFile = APPLICATION_FILES[selectedValue];
  if (!templateFile) {
    const payload = { content: '❌ That option is not set up yet.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  }

  try {
    const components = await loadTemplate(templateFile);
    const payload = {
      components,
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    };

    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  } catch (error) {
    const payload = {
      content: `❌ Couldn't load that application: ${error.message}`,
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  }
}

export async function handleModal() {
  return;
}

export async function handleCareersDmMessage() {
  return false;
}

export default {
  name: 'careers',
  description: 'Posts the careers message from data/careersmessage.json.',
  async execute(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return;

    try {
      const components = await loadTemplate(CAREERS_FILE);
      await message.channel.send({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
      await message.reply(`Couldn't post the careers message: ${error.message}`).catch(() => {});
    }
  },
};
