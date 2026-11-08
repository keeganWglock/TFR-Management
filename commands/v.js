import { SlashCommandBuilder, ButtonStyle, MessageFlags } from 'discord.js';


const T = {
    ACTION_ROW: 1,
    BUTTON: 2,
    STRING_SELECT: 3,
    SECTION: 9,
    TEXT_DISPLAY: 10,
    THUMBNAIL: 11,
    MEDIA_GALLERY: 12,
    FILE: 13,
    SEPARATOR: 14,
    CONTAINER: 17
};

const normalizeButtonStyle = (style) => {
    if (typeof style === 'number') return style;

    switch (String(style).toLowerCase()) {
        case 'primary':
        case '1':
            return ButtonStyle.Primary;
        case 'secondary':
        case '2':
            return ButtonStyle.Secondary;
        case 'success':
        case '3':
            return ButtonStyle.Success;
        case 'danger':
        case '4':
            return ButtonStyle.Danger;
        case 'link':
        case '5':
            return ButtonStyle.Link;
        default:
            return ButtonStyle.Primary;
    }
};

const normalizeColor = (color) => {
    if (color === null || color === undefined || color === '') return undefined;
    if (typeof color === 'number') return color;
    const cleaned = String(color).trim().replace(/^#|^0x/i, '');
    const parsed = parseInt(cleaned, 16);
    return Number.isNaN(parsed) ? undefined : parsed;
};

const normalizeEmoji = (emoji) => {
    if (!emoji) return undefined;
    if (typeof emoji === 'object') return emoji;

    const custom = String(emoji).match(/^<(a?):(\w+):(\d+)>$/);
    if (custom) {
        return { animated: custom[1] === 'a', name: custom[2], id: custom[3] };
    }
    return { name: String(emoji) };
};

const normalizeMedia = (media) => (typeof media === 'string' ? { url: media } : media);

const rid = () => Math.floor(Math.random() * 100000);

const normalizeComponent = (comp) => {
    if (!comp || typeof comp !== 'object') return comp;
    const out = { ...comp };

    switch (out.type) {
        case T.ACTION_ROW:
            out.components = (Array.isArray(out.components) ? out.components : []).map(normalizeComponent);
            break;

        case T.BUTTON:
            out.style = normalizeButtonStyle(out.style);
            if (out.emoji) out.emoji = normalizeEmoji(out.emoji);
            if (out.style === ButtonStyle.Link || out.url) {
                out.style = ButtonStyle.Link;
                delete out.custom_id;
            } else if (!out.custom_id) {
                out.custom_id = `v2_btn_${rid()}`;
            }
            if (!out.label && !out.emoji) out.label = 'Button';
            break;

        case T.STRING_SELECT:
            if (!out.custom_id) out.custom_id = `v2_menu_${rid()}`;
            out.options = (Array.isArray(out.options) ? out.options : []).map((opt) => ({
                ...opt,
                label: String(opt.label || 'Option'),
                value: String(opt.value || `option_${rid()}`),
                emoji: normalizeEmoji(opt.emoji)
            }));
            break;

        case T.SECTION:
            out.components = (Array.isArray(out.components) ? out.components : []).map(normalizeComponent);
            if (out.accessory) out.accessory = normalizeComponent(out.accessory);
            break;

        case T.THUMBNAIL:
            out.media = normalizeMedia(out.media);
            break;

        case T.MEDIA_GALLERY:
            out.items = (Array.isArray(out.items) ? out.items : []).map((item) => ({
                ...item,
                media: normalizeMedia(item.media)
            }));
            break;

        case T.FILE:
            out.file = normalizeMedia(out.file);
            break;

        case T.CONTAINER: {
            const color = normalizeColor(out.accent_color ?? out.accentColor ?? out.color);
            delete out.accentColor;
            delete out.color;
            if (color !== undefined) out.accent_color = color;
            out.components = (Array.isArray(out.components) ? out.components : []).map(normalizeComponent);
            break;
        }

        default:
            
            break;
    }

    return out;
};

export default {
    name: 'v',
    description: 'JSON to Component v2 embed.',
    data: new SlashCommandBuilder()
        .setName('v')
        .setDescription('JSON to Component v2 embed')
        .addStringOption(option =>
            option.setName('json')
                .setDescription('paste JSON')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const jsonString = interaction.options.getString('json');

        try {
            const data = JSON.parse(jsonString);

            let rawComponents;
            if (Array.isArray(data)) rawComponents = data;
            else rawComponents = data.components || (data.messages && data.messages[0]?.components) || [];

            if (!Array.isArray(rawComponents) || rawComponents.length === 0) {
                return interaction.editReply({ content: '❌ Invalid Components V2 JSON' });
            }

            const components = rawComponents.map(normalizeComponent);

            
            await interaction.channel.send({
                components,
                flags: MessageFlags.IsComponentsV2
            });

            return interaction.editReply({ content: '**Successfully Sent!**' });
        } catch (error) {
            console.error('Components V2 JSON execution failure:', error);
            return interaction.editReply({ content: `Failed to send! \`${error.message}\`` });
        }
    }
};