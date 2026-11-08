import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { fetchSendableChannel, loadTemplate } from '../utils/components.js';
import { acceptRequest, hasOpenRequest, saveRequest } from '../utils/trDb.js';

// ---------------------------------------------------------------------------
// TRAINING REQUEST SETTINGS - edit these
// ---------------------------------------------------------------------------
// Channel where requests are sent for the FTO team (each has an "I can do it!" button).
const TR_CHANNEL_ID = '1569093604012728423';
// Role of your FTOs. If set, only this role (or Manage Server) can press "I can do it!".
// Leave it as-is to let anyone who can see the FTO channel press it.
const FTO_ROLE_ID = '1564378678060781568';
// How long an unaccepted request blocks a second one from the same person.
const OPEN_REQUEST_EXPIRY_DAYS = 1;

const PANEL_FILE = 'trpanelmessage.json';
const RESPONSE_FILE = 'trresponsemessage.json';
const DM_FILE = 'trdmmessage.json';

const MODAL_ID = 'tr:modal';
const isValidId = (id) => /^\d{17,20}$/.test(id);
const expiryMs = () => OPEN_REQUEST_EXPIRY_DAYS * 86_400_000;

export function isTrInteraction(customId) {
  return customId.startsWith('tr:');
}

function canAccept(member) {
  if (!isValidId(FTO_ROLE_ID)) return true;
  if (member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return Boolean(member?.roles?.cache?.has(FTO_ROLE_ID));
}

function walkText(nodes, visit) {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 10 && typeof node.content === 'string') visit(node);
    if (Array.isArray(node.components)) walkText(node.components, visit);
  }
}

// ---------------------------------------------------------------------------
// The request message (data/trresponsemessage.json)
// ---------------------------------------------------------------------------
// Fills "**Label:**" lines (Requested By / Date / Time / Notes) and {user} {date} {time} {notes}
// placeholders, then adds the "I can do it!" button - or, once accepted, an "Accepted by" line.
const LABEL_ALIASES = {
  user: ['requested by', 'requester', 'user', 'trainee', 'employee', 'name', 'submitted by'],
  date: ['date', 'day', 'date and day', 'date & day', 'available date', 'availability', 'available'],
  time: ['time', 'preferred time', 'time preferred', 'preferred'],
  notes: ['notes', 'note', 'comments', 'additional notes'],
};

async function buildRequestMessage(request) {
  const components = await loadTemplate(RESPONSE_FILE);
  const values = {
    user: `<@${request.userId}>`,
    date: request.date,
    time: request.time,
    notes: request.notes || 'None',
  };
  let placed = false;

  for (const container of components) {
    if (container?.type !== 17 || !Array.isArray(container.components)) continue;

    for (let i = 0; i < container.components.length; i++) {
      const node = container.components[i];
      if (node?.type !== 10 || typeof node.content !== 'string' || placed) continue;

      let touched = false;
      const out = node.content.split('\n').map((line) => {
        const label = line.trim().match(/^\*\*(.+?):\*\*/)?.[1];
        const key = label && Object.keys(LABEL_ALIASES).find((k) => LABEL_ALIASES[k].includes(label.toLowerCase()));
        if (key) {
          touched = true;
          return `**${label}:** ${values[key]}`;
        }
        const replaced = line
          .replaceAll('{user}', () => values.user)
          .replaceAll('{date}', () => values.date)
          .replaceAll('{time}', () => values.time)
          .replaceAll('{notes}', () => values.notes);
        if (replaced !== line) touched = true;
        return replaced;
      });
      if (!touched) continue;
      node.content = out.join('\n');

      const extra = request.acceptedBy
        ? { type: 10, content: `**Accepted by:** <@${request.acceptedBy}>` }
        : {
            type: 1,
            components: [{ type: 2, style: 3, label: 'I can do it!', custom_id: 'tr:accept' }],
          };
      container.components.splice(i + 1, 0, extra);
      placed = true;
    }
  }

  if (!placed) {
    throw new Error(
      `data/${RESPONSE_FILE} needs text with {user}, {date}, {time} and {notes} (or lines like "**Date:**").`,
    );
  }
  return components;
}

// ---------------------------------------------------------------------------
// Panel button + request form
// ---------------------------------------------------------------------------
function buildModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Training Request')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('When are you available for training?')
        .setDescription('Include the date and the day, e.g. Friday, 10/17.')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('date').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('What time do you prefer?')
        .setDescription('Include your timezone, e.g. 6:00 PM EST.')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('time').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Notes for the people training you?')
        .setDescription('Optional.')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('notes').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false),
        ),
    );
}

export async function handleButton(interaction) {
  if (!interaction.inGuild()) return;

  if (interaction.customId === 'tr:open') {
    if (!isValidId(TR_CHANNEL_ID)) {
      return interaction.reply({
        content: '❌ Training requests are not set up yet (TR_CHANNEL_ID in commands/tr.js).',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (hasOpenRequest(interaction.user.id, expiryMs())) {
      return interaction.reply({
        content: '❌ You already have a training request waiting to be accepted.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.showModal(buildModal());
  }

  if (interaction.customId === 'tr:accept') return acceptTraining(interaction);
}

export async function handleModal(interaction) {
  if (interaction.customId !== MODAL_ID) return;
  const reply = (content) => interaction.editReply({ content });

  if (!interaction.inGuild() || !isValidId(TR_CHANNEL_ID)) {
    return interaction.reply({ content: '❌ Training requests are not set up yet.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (hasOpenRequest(interaction.user.id, expiryMs())) {
    return reply('❌ You already have a training request waiting to be accepted.');
  }

  const request = {
    userId: interaction.user.id,
    date: interaction.fields.getTextInputValue('date').trim(),
    time: interaction.fields.getTextInputValue('time').trim(),
    notes: (interaction.fields.getTextInputValue('notes') ?? '').trim(),
  };
  if (!request.date || !request.time) return reply('❌ Please fill in the date and the time.');

  try {
    const channel = await fetchSendableChannel(interaction.client, TR_CHANNEL_ID);
    const components = await buildRequestMessage(request);
    const sent = await channel.send({
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    saveRequest(sent.id, request);
  } catch (error) {
    console.error('[TR] Could not post the training request:', error);
    return reply(`❌ Couldn't send your training request: ${error.message}`);
  }

  return reply('✅ Your training request was sent to the FTO team. You will get a DM when someone accepts it.');
}

// ---------------------------------------------------------------------------
// "I can do it!"
// ---------------------------------------------------------------------------
async function acceptTraining(interaction) {
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!canAccept(interaction.member)) return ephemeral('Only FTOs can accept training requests.');

  const messageId = interaction.message.id;
  const result = acceptRequest(messageId, interaction.user.id);
  if (!result.ok) {
    if (result.missing) return ephemeral('I have no record of this request.');
    return ephemeral(
      result.acceptedBy === interaction.user.id
        ? 'You already accepted this request.'
        : `This request was already accepted by <@${result.acceptedBy}>.`,
    );
  }

  await interaction.deferUpdate();
  const request = { ...result.request, acceptedBy: interaction.user.id };
  const notes = [];

  try {
    await interaction.editReply({
      components: await buildRequestMessage(request),
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error('[TR] Could not update the request message:', error);
    notes.push(`⚠️ The request was accepted, but I couldn't update the message: ${error.message}`);
  }

  // DM the person who requested the training.
  try {
    const user = await interaction.client.users.fetch(request.userId);
    const components = await loadTemplate(DM_FILE);
    const fto = interaction.member?.displayName ?? interaction.user.username;
    walkText(components, (node) => {
      node.content = node.content
        .replaceAll('{user}', () => `<@${user.id}>`)
        .replaceAll('{fto}', () => `<@${interaction.user.id}>`)
        .replaceAll('{ftoname}', () => fto)
        .replaceAll('{date}', () => request.date)
        .replaceAll('{time}', () => request.time);
    });
    await user.send({ components, flags: MessageFlags.IsComponentsV2 });
  } catch (error) {
    console.warn(`[TR] Could not DM ${request.userId}: ${error.message}`);
    notes.push(
      `⚠️ I couldn't DM <@${request.userId}> (${error.code === 50007 ? 'their DMs are closed' : error.message}). Please contact them yourself.`,
    );
  }

  if (notes.length) await interaction.followUp({ content: notes.join('\n'), flags: MessageFlags.Ephemeral });
}

// "-tr" posts the training request panel in the current channel.
export default {
  name: 'tr',
  description: 'Posts the training request panel from data/trpanelmessage.json.',
  async execute(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return;
    try {
      const components = await loadTemplate(PANEL_FILE);
      if (!JSON.stringify(components).includes('"tr:open"')) {
        throw new Error(`${PANEL_FILE} has no button with custom_id "tr:open".`);
      }
      await message.channel.send({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
      await message.reply(`Couldn't post the training request panel: ${error.message}`).catch(() => {});
    }
  },
};
