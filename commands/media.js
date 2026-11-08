import {
  AttachmentBuilder,
  ContainerBuilder,
  InteractionContextType,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { fetchSendableChannel } from '../utils/components.js';

// The media always goes to this channel, no matter where the command is used.
const MEDIA_CHANNEL_ID = '1563766708185989130';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB keeps uploads safe on every server tier

export default {
  data: new SlashCommandBuilder()
    .setName('media')
    .setDescription('Post an image in the media channel.')
    .setContexts(InteractionContextType.Guild)
    .addAttachmentOption((o) => o.setName('file').setDescription('The image to post.').setRequired(true)),

  async execute(interaction) {
    const reply = (content) => interaction.editReply({ content });

    if (!/^\d{17,20}$/.test(MEDIA_CHANNEL_ID)) {
      return interaction.reply({
        content: '❌ The media channel has not been set up yet (MEDIA_CHANNEL_ID in commands/media.js).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const file = interaction.options.getAttachment('file', true);
    if (!file.contentType?.startsWith('image/')) {
      return interaction.reply({ content: '❌ That file is not an image.', flags: MessageFlags.Ephemeral });
    }
    if (file.size > MAX_BYTES) {
      return interaction.reply({ content: '❌ That image is too large (10 MB max).', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Re-upload the image so it stays available (Discord's own upload links expire).
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`could not download the image (HTTP ${response.status})`);
      const buffer = Buffer.from(await response.arrayBuffer());

      const extension = (file.name?.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const fileName = `media.${extension}`;

      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`📎 | <@${interaction.user.id}>`))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`)),
        );

      const channel = await fetchSendableChannel(interaction.client, MEDIA_CHANNEL_ID);
      await channel.send({
        components: [container],
        files: [new AttachmentBuilder(buffer, { name: fileName })],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[MEDIA] Failed to post media:', error);
      return reply(`❌ Couldn't post your image: ${error.message}`);
    }

    return reply(`✅ Your image was posted in <#${MEDIA_CHANNEL_ID}>.`);
  },
};