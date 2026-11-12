const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { E, embed } = require('../utils');
const changelog = require('../changelog');

const commands = [];
const components = [];

// Wat je bij /changelog invult (titel/versie/samenvatting) wordt even onthouden tot het formulier met de lijsten wordt verstuurd.
const pending = new Map(); // nonce -> { user, titel, versie, samenvatting, exp }
const TTL = 15 * 60 * 1000;
const FIELDS = [ // key in changelog-entry, label in het formulier, placeholder
  ['added', '✨ Nieuw', 'Eén punt per regel. Bijv: **Tickets:** nieuw partner-ticket'],
  ['improved', '🔧 Verbeterd', 'Eén punt per regel'],
  ['fixed', '🐛 Opgelost', 'Eén punt per regel'],
  ['removed', '🗑️ Verwijderd', 'Eén punt per regel'],
  ['notes', '🔒 Alleen staff (niet publiek)', 'Beheer-acties/interne info. Komt NIET in de embed'],
];
const lines = (s) => (s || '').split('\n').map((l) => l.replace(/^\s*[-•*▸]\s+/, '').trim()).filter(Boolean);
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); // JJJJ-MM-DD

commands.push({
  level: 'admin', // alleen server-eigenaar / config.antinukeAdminIds; wil je meer mensen: zet 'management'
  data: new SlashCommandBuilder().setName('changelog').setDescription('Plaats zelf een changelog-embed (je krijgt daarna een formulier met de lijsten)')
    .addStringOption((o) => o.setName('titel').setDescription('Titel van de update').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('versie').setDescription('Versienummer, bijv. 1.4.0 (optioneel)').setMaxLength(20))
    .addStringOption((o) => o.setName('samenvatting').setDescription('Eén zin als samenvatting (optioneel)').setMaxLength(300)),
  async execute(i) {
    for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const versie = (i.options.getString('versie') || '').replace(/^v/i, '').trim();
    pending.set(nonce, { user: i.user.id, titel: i.options.getString('titel').trim(), versie, samenvatting: (i.options.getString('samenvatting') || '').trim(), exp: Date.now() + TTL });
    const modal = new ModalBuilder().setCustomId(`changelog_modal:${nonce}`).setTitle('Changelog: wat is er veranderd?');
    for (const [key, label, ph] of FIELDS) {
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(key).setLabel(label.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000).setPlaceholder(ph)));
    }
    return i.showModal(modal);
  },
});

components.push({
  match: (id) => id.startsWith('changelog_modal:'),
  async execute(i, client) {
    const p = pending.get(i.customId.split(':')[1]);
    if (!p || p.user !== i.user.id) return i.reply({ content: '⏱️ Dit formulier is verlopen (of de bot is herstart). Gebruik `/changelog` opnieuw.', flags: E });
    const entry = { id: `handmatig-${Date.now()}`, title: p.titel, date: today(), ...(p.versie ? { version: p.versie } : {}), ...(p.samenvatting ? { summary: p.samenvatting } : {}) };
    for (const [key] of FIELDS) { const l = lines(i.fields.getTextInputValue(key)); if (l.length) entry[key] = l; }
    if (!FIELDS.some(([k]) => entry[k])) return i.reply({ content: '⚠️ Je hebt niets ingevuld: vul minstens één lijst in. Gebruik `/changelog` opnieuw.', flags: E });
    await i.deferReply({ flags: E });
    try {
      const msg = await changelog.postEntry(client, entry);
      pending.delete(i.customId.split(':')[1]);
      return i.editReply({ embeds: [embed('✅ Changelog geplaatst', `Staat in <#${msg.channelId}>: [naar het bericht](${msg.url})${entry.notes?.length ? '\n🔒 Je staff-notities zijn niet publiek geplaatst (staff-kanaal of console).' : ''}`)] });
    } catch (err) {
      return i.editReply(`⚠️ Plaatsen mislukt: ${err.message}\nGebruik \`/changelog\` opnieuw als dit opgelost is.`);
    }
  },
});

module.exports = { commands, components };
