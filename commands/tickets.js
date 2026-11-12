const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, OverwriteType,
} = require('discord.js');
const config = require('../config');
const db = require('../db');
const { E, hasLevel, embed, dm, logAction, setGangNick, canManageRole, sendToChannel } = require('../utils');
const { collectMessages, summaryEmbed, postTranscript } = require('../transcript');
const { scheduleLedenlijst, gangCount } = require('../panels');

const commands = [];
const components = [];
const P = PermissionFlagsBits;
const G = config.logColor; // groene stijl van GSF Bot

const typeOf = (key) => config.ticketTypes.find((t) => t.key === key);
const notTicket = (i) => i.reply({ content: 'Dit commando werkt alleen in een ticketkanaal.', flags: E });

// Geeft de ticket van dit kanaal terug. Tickets die niet door deze bot zijn aangemaakt (bijv. door de oude bot)
// worden herkend aan de ticket-categorie of het kanaal-onderwerp en dan automatisch overgenomen.
function getTicket(ch) {
  if (db.data.tickets[ch.id]) return db.data.tickets[ch.id];
  if (ch.type !== ChannelType.GuildText) return null;
  const cats = [...config.ticketTypes.map((t) => t.categoryId), config.ticketCategoryId].filter(Boolean);
  const inCat = ch.parentId && cats.includes(ch.parentId);
  if (!inCat && !(ch.topic || '').startsWith('Ticket van')) return null;
  const owner = ch.permissionOverwrites.cache.find((o) => o.type === OverwriteType.Member && o.id !== ch.client.user.id);
  const type = config.ticketTypes.find((t) => ch.name.startsWith(t.key)) || config.ticketTypes.find((t) => t.categoryId && t.categoryId === ch.parentId);
  const t = { userId: owner?.id || null, type: type?.key || 'overig', claimedBy: null, createdAt: ch.createdTimestamp, answers: {}, submitted: true };
  db.setTicket(ch.id, t);
  return t;
}

// ================= TICKETPANEL =================
const panelPayload = () => {
  const menu = new StringSelectMenuBuilder().setCustomId('ticket_create').setPlaceholder('Kies een categorie...')
    .addOptions(config.ticketTypes.map((t) => ({ label: t.label, value: t.key, description: t.description, emoji: t.emoji })));
  const list = config.ticketTypes.map((t) => `> ${t.emoji} **${t.label}** — ${t.description}`).join('\n');
  return {
    embeds: [embed('🎫 Tickets', `Kies hieronder een categorie om een ticket te openen.\n\n${list}`, G)],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
};

commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('ticketpanel').setDescription('Plaats het ticketpanel')
    .addChannelOption((o) => o.setName('kanaal').setDescription('Kanaal waarin het panel geplaatst wordt').setRequired(true).addChannelTypes(ChannelType.GuildText)),
  async execute(i) {
    const target = i.options.getChannel('kanaal') || i.channel;
    await target.send(panelPayload());
    return i.reply({ content: `✅ Ticketpanel geplaatst in ${target}.`, flags: E });
  },
});

// ================= SOLLICITATIEFORMULIER (3 delen) =================
const PARTS = {
  1: { emoji: '👤', title: 'Wie ben je?', fields: [
    { id: 'naam', label: 'Naam', style: TextInputStyle.Short, max: 100 },
    { id: 'leeftijd', label: 'Leeftijd', style: TextInputStyle.Short, max: 10 },
    { id: 'discord', label: 'Discord', style: TextInputStyle.Short, max: 100 },
    { id: 'icnaam', label: 'IC Naam', style: TextInputStyle.Short, max: 100 },
  ] },
  2: { emoji: '🕶️', title: 'Ervaring', fields: [
    { id: 'ervaring', label: 'FiveM/Serious RP', style: TextInputStyle.Paragraph, max: 900, ph: 'Hoeveel ervaring heb je, op welke servers, welke rollen?' },
    { id: 'activiteit', label: 'Activiteit', style: TextInputStyle.Short, max: 100, ph: 'Hoeveel uur per dag/week ben je actief?' },
  ] },
  3: { emoji: '💼', title: 'Motivatie', fields: [
    { id: 'waarom', label: 'Waarom GSF', style: TextInputStyle.Paragraph, max: 700 },
    { id: 'toevoeging', label: 'Toevoeging', style: TextInputStyle.Paragraph, max: 900, ph: 'Wat kun jij toevoegen aan GSF?' },
    { id: 'regels', label: 'Bekend met regels', style: TextInputStyle.Short, max: 50, ph: 'Ja / Nee' },
  ] },
};
const FIELD_LABEL = { naam: 'Naam', leeftijd: 'Leeftijd', discord: 'Discord', icnaam: 'IC Naam', ervaring: 'FiveM/Serious RP', activiteit: 'Activiteit', waarom: 'Waarom GSF', toevoeging: 'Toevoeging', regels: 'Bekend met regels' };
const allFilled = (t) => [1, 2, 3].every((n) => t.answers?.[n]);

const introEmbed = (type, user) => embed(type.label, `${user} — beschrijf hieronder je vraag.`, G);
const formEmbed = () => embed('📝 Sollicitatie Formulier',
  'Welkom bij je sollicitatie voor **GSF**!\n\nVul de 3 delen in door op de knoppen hieronder te klikken.\n\n'
  + '👤 **Deel 1** — Wie ben je?\n🕶️ **Deel 2** — Ervaring\n💼 **Deel 3** — Motivatie\n\n'
  + 'Zodra je alle 3 de delen hebt ingevuld, wordt je sollicitatie automatisch naar de staff gestuurd!', G);

// Knoppen onder het formulier. form=true: met de 3 delen; anders alleen Sluiten.
function ticketButtons(t, form) {
  const rows = [];
  if (form) {
    rows.push(new ActionRowBuilder().addComponents(...[1, 2, 3].map((n) => new ButtonBuilder()
      .setCustomId(`sol_part_${n}`).setLabel(`Deel ${n}: ${PARTS[n].title}`).setEmoji('✅')
      .setStyle(t.answers?.[n] ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(!!t.submitted))));
  }
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Sluiten').setEmoji('🔒').setStyle(ButtonStyle.Danger)));
  return rows;
}

function solEmbed(t, userId) {
  const a = t.answers;
  const block = (n) => `${PARTS[n].emoji} **0${n} — ${PARTS[n].title}**\n` + PARTS[n].fields.map((f) => `**${FIELD_LABEL[f.id]}:** ${a[n]?.[f.id] ?? '—'}`).join('\n');
  return embed('📝 Sollicitatie Ingevuld', `<@${userId}> heeft de sollicitatie volledig ingevuld.\n\n${block(1)}\n\n${block(2)}\n\n${block(3)}`.slice(0, 4090), G);
}
const reviewButtons = (disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('sol_accept').setLabel('Aannemen').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId('sol_decline').setLabel('Afwijzen').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled),
);

// ================= TICKET AANMAKEN =================
components.push({
  match: (id) => id === 'ticket_create',
  async execute(i, client) {
    const type = typeOf(i.values[0]);
    if (!type) return i.reply({ content: 'Onbekende categorie.', flags: E });
    if (db.isBlacklisted(i.user.id)) return i.reply({ content: '⛔ Je staat op de blacklist en kunt geen tickets openen.', flags: E });

    const existing = Object.entries(db.data.tickets).find(([, t]) => t.userId === i.user.id);
    if (existing) {
      if (i.guild.channels.cache.has(existing[0])) return i.reply({ content: `Je hebt al een open ticket: <#${existing[0]}>`, flags: E });
      db.deleteTicket(existing[0]);
    }
    await i.deferReply({ flags: E });

    const allow = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
    const staffIds = [...config.staffRoleIds, ...config.managementRoleIds, config.leadRoleId].filter((id) => id && i.guild.roles.cache.has(id));
    const overwrites = [
      { id: i.guild.id, deny: [P.ViewChannel] },
      { id: i.user.id, allow },
      { id: client.user.id, allow: [...allow, P.ManageChannels] },
      ...staffIds.map((id) => ({ id, allow })),
    ];
    const name = `${type.key}-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
    const parent = type.categoryId || config.ticketCategoryId || null;
    const ch = await i.guild.channels.create({
      name, type: ChannelType.GuildText, parent: parent && i.guild.channels.cache.has(parent) ? parent : null,
      permissionOverwrites: overwrites, topic: `Ticket van ${i.user.username} — ${type.label}`,
    });
    const t = { userId: i.user.id, type: type.key, claimedBy: null, createdAt: Date.now(), answers: {}, submitted: false };
    db.setTicket(ch.id, t);

    const lead = config.leadRoleId ? `<@&${config.leadRoleId}>` : '';
    const embeds = [introEmbed(type, i.user)];
    if (type.form) embeds.push(formEmbed());
    await ch.send({
      content: `${i.user} ${lead}`.trim(), embeds, components: ticketButtons(t, !!type.form),
      allowedMentions: { parse: ['users', 'roles'] },
    });
    logAction(client, i, '🎫 Ticket geopend', `${i.user} opende ticket ${ch} (${type.label}).`);
    return i.editReply(`✅ Ticket aangemaakt: ${ch}`);
  },
});

// ================= FORMULIER: delen invullen =================
components.push({
  match: (id) => id.startsWith('sol_part_'),
  async execute(i) {
    const t = getTicket(i.channel);
    if (!t) return notTicket(i);
    if (i.user.id !== t.userId) return i.reply({ content: 'Alleen de sollicitant kan dit formulier invullen.', flags: E });
    if (t.submitted) return i.reply({ content: 'Je sollicitatie is al verstuurd.', flags: E });
    const n = Number(i.customId.split('_')[2]);
    const part = PARTS[n];
    const modal = new ModalBuilder().setCustomId(`sol_modal_${n}`).setTitle(`Deel ${n}: ${part.title}`).addComponents(
      ...part.fields.map((f) => {
        const inp = new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style).setRequired(true).setMaxLength(f.max);
        if (f.ph) inp.setPlaceholder(f.ph);
        const old = t.answers?.[n]?.[f.id];
        if (old) inp.setValue(old);
        return new ActionRowBuilder().addComponents(inp);
      }),
    );
    return i.showModal(modal);
  },
});

components.push({
  match: (id) => id.startsWith('sol_modal_'),
  async execute(i, client) {
    const t = getTicket(i.channel);
    if (!t) return notTicket(i);
    if (i.user.id !== t.userId || t.submitted) return i.reply({ content: 'Dit formulier kan niet meer worden aangepast.', flags: E });
    const n = Number(i.customId.split('_')[2]);
    t.answers = t.answers || {};
    t.answers[n] = Object.fromEntries(PARTS[n].fields.map((f) => [f.id, i.fields.getTextInputValue(f.id).trim()]));
    const done = allFilled(t);
    if (done) t.submitted = true;
    db.setTicket(i.channel.id, t);

    const type = typeOf(t.type);
    await i.update({ components: ticketButtons(t, true) });
    if (!done) return i.followUp({ content: `✅ Deel ${n} opgeslagen. Vul de andere delen ook in.`, flags: E });

    const lead = config.leadRoleId ? `<@&${config.leadRoleId}> ` : '';
    await i.channel.send({
      content: `${lead}📢 **Een nieuwe sollicitatie is volledig ingevuld!**`,
      embeds: [solEmbed(t, t.userId)], components: [reviewButtons()],
      allowedMentions: { parse: ['roles'] },
    });
    logAction(client, i, '📝 Sollicitatie ingevuld', `${i.user} vulde de sollicitatie volledig in (${i.channel}).`);
    return i.followUp({ content: '✅ Je sollicitatie is volledig ingevuld en naar de staff gestuurd!', flags: E });
  },
});

// Formulier opnieuw sturen (bijv. als het bericht is verwijderd)
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('sollicitatieformulier').setDescription('Stuur het sollicitatieformulier opnieuw in deze ticket'),
  async execute(i) {
    const t = getTicket(i.channel);
    if (!t) return notTicket(i);
    await i.channel.send({ embeds: [formEmbed()], components: ticketButtons(t, true) });
    return i.reply({ content: '✅ Formulier opnieuw geplaatst.', flags: E });
  },
});

// ================= AANNEMEN / AFWIJZEN =================
function reviewedEmbed(msg, color, status) {
  const e = embed(null, null, color);
  const o = msg.embeds[0];
  e.data.title = o.title; e.data.description = o.description;
  return e.addFields({ name: 'Status', value: status });
}

components.push({
  match: (id) => id === 'sol_accept',
  async execute(i, client) {
    if (!hasLevel(i.member, 'staff')) return i.reply({ content: '⛔ Alleen staff kan sollicitaties beoordelen.', flags: E });
    const t = getTicket(i.channel);
    if (!t?.userId) return notTicket(i);
    await i.deferUpdate();
    const warn = (msg) => i.followUp({ content: msg, flags: E }).catch(() => {});

    const m = await i.guild.members.fetch(t.userId).catch(() => null);
    if (!m) return warn('⚠️ De sollicitant zit niet meer in de server.');
    const start = config.ranks[0]; // nieuwe leden starten op de laagste rang
    const rank = i.guild.roles.cache.get(start.id);
    const gang = i.guild.roles.cache.get(config.gangRoleId);
    if (!rank || !gang) return warn('⚠️ Een rol uit config.js bestaat niet in deze server.');
    for (const r of [rank, gang]) if (!canManageRole(i.guild, r)) return warn(`⚠️ Ik kan de rol **${r.name}** niet beheren. Zet de bot-rol boven deze rol.`);
    if (config.ranks.some((r) => m.roles.cache.has(r.id))) return warn(`⚠️ ${m} heeft al een gang-rang.`);
    if (db.data.maxMembers > 0) {
      const count = await gangCount(i.guild);
      if (count >= db.data.maxMembers) return warn(`⚠️ De gang is vol (**${count}/${db.data.maxMembers}**).`);
    }

    await m.roles.add([gang, rank], `Sollicitatie aangenomen door ${i.user.tag}`);
    db.setHired(m.id, { date: Date.now(), by: i.user.id, rank: start.name });
    const nickOk = await setGangNick(m, true, `Aangenomen door ${i.user.tag}`);
    await i.message.edit({ embeds: [reviewedEmbed(i.message, 0x2ecc71, `✅ Aangenomen door ${i.user}`)], components: [reviewButtons(true)] });

    const e = embed('✅ Welkom bij de GSF!', `Gefeliciteerd ${m}, je bent aangenomen!\n\n**Rang:** ${rank}\n**Aangenomen door:** ${i.user}`, 0x2ecc71);
    await dm(m.user, e);
    await i.channel.send({ content: `${m}`, embeds: [e] });
    await sendToChannel(client, 'aangenomen', { content: `${m}`, embeds: [e] });
    if (!nickOk) warn(`⚠️ De bijnaam van ${m} kon niet worden aangepast. Zet hem handmatig op \`${config.namePrefix}naam\`.`);
    logAction(client, i, '✅ Aangenomen', `${m} aangenomen via sollicitatie als **${start.name}**.`);
    scheduleLedenlijst(client, i.guild);
  },
});

components.push({
  match: (id) => id === 'sol_decline',
  async execute(i) {
    if (!hasLevel(i.member, 'staff')) return i.reply({ content: '⛔ Alleen staff kan sollicitaties beoordelen.', flags: E });
    const modal = new ModalBuilder().setCustomId('sol_decline_modal').setTitle('Sollicitatie afwijzen').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reden').setLabel('Reden').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
    return i.showModal(modal);
  },
});

components.push({
  match: (id) => id === 'sol_decline_modal',
  async execute(i, client) {
    if (!hasLevel(i.member, 'staff')) return i.reply({ content: '⛔ Alleen staff kan sollicitaties beoordelen.', flags: E });
    const t = getTicket(i.channel);
    if (!t?.userId) return notTicket(i);
    const reden = i.fields.getTextInputValue('reden');
    await i.update({ embeds: [reviewedEmbed(i.message, 0xe74c3c, `❌ Afgewezen door ${i.user}\n**Reden:** ${reden}`)], components: [reviewButtons(true)] });
    const e = embed('❌ Sollicitatie afgewezen', `Helaas is je sollicitatie bij **${config.serverName}** afgewezen.\n\n**Reden:** ${reden}\n\nJe kunt later opnieuw solliciteren.`, 0xe74c3c);
    const user = await client.users.fetch(t.userId).catch(() => null);
    if (user) await dm(user, e);
    await i.channel.send({ content: `<@${t.userId}>`, embeds: [e] });
    logAction(client, i, '❌ Sollicitatie afgewezen', `<@${t.userId}> afgewezen.\nReden: ${reden}`);
  },
});

// ================= CLAIM =================
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('claim').setDescription('Claim deze ticket'),
  async execute(i) {
    const t = getTicket(i.channel);
    if (!t) return notTicket(i);
    if (t.claimedBy) return i.reply({ content: `Deze ticket is al geclaimd door <@${t.claimedBy}>.`, flags: E });
    t.claimedBy = i.user.id; db.setTicket(i.channel.id, t);
    return i.reply({ embeds: [embed('🙋 Ticket geclaimd', `${i.user} behandelt deze ticket.`, G)] });
  },
});

// ================= CLOSE (+ transcript) =================
async function closeTicket(i, client, reason = 'Geen reden opgegeven') {
  const t = getTicket(i.channel);
  if (!t) return notTicket(i);
  if (i.user.id !== t.userId && !hasLevel(i.member, 'staff')) return i.reply({ content: 'Alleen staff of de ticketeigenaar kan dit sluiten.', flags: E });
  if (!config.channels.ticketLogs) return i.reply({ content: '⚠️ Er is geen transcript-kanaal ingesteld (`channels.ticketLogs` in config.js). De ticket blijft open zodat er niets verloren gaat.', flags: E });

  await i.reply({ embeds: [embed('🔒 Ticket wordt gesloten', `Gesloten door ${i.user}.\n**Reden:** ${reason}\n\nHet transcript wordt opgeslagen en dit kanaal wordt zo verwijderd.`, G)] });

  const msgs = await collectMessages(i.channel);
  const type = typeOf(t.type);
  const summary = summaryEmbed({
    channelName: i.channel.name, ownerId: t.userId || i.user.id, closedBy: i.user,
    categorie: type?.label || t.type, count: msgs.length, reden: reason,
  });
  let sent = null;
  try { sent = await postTranscript(client, summary, msgs, i.channel.name, { categorie: type?.label || t.type, closedByName: i.member?.displayName || i.user.username }); }
  catch (err) { console.error('Transcript mislukt:', err); }
  if (!sent) {
    return i.followUp({ content: '⚠️ Het transcript kon niet worden geplaatst (check `channels.ticketLogs` en de permissies van de bot). De ticket blijft open.', flags: E });
  }
  logAction(client, i, '🔒 Ticket gesloten', `${i.user} sloot ticket **#${i.channel.name}** van <@${t.userId}>.\nReden: ${reason}`);
  if (t.userId) { const owner = await client.users.fetch(t.userId).catch(() => null); if (owner) dm(owner, summary); }

  db.deleteTicket(i.channel.id);
  setTimeout(() => i.channel.delete().catch(() => {}), 4000);
}
components.push({ match: (id) => id === 'ticket_close', execute: (i, c) => closeTicket(i, c) });
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('close').setDescription('Sluit deze ticket')
    .addStringOption((o) => o.setName('reden').setDescription('Reden van sluiten').setRequired(true)),
  execute: (i, c) => closeTicket(i, c, i.options.getString('reden') || undefined),
});

// ================= ADD / REMOVE / RENAME =================
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('add').setDescription('Voeg een gebruiker toe aan deze ticket')
    .addUserOption((o) => o.setName('user').setDescription('Wie toevoegen?').setRequired(true)),
  async execute(i) {
    if (!getTicket(i.channel)) return notTicket(i);
    const user = i.options.getUser('user');
    await i.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
    return i.reply({ embeds: [embed('➕ Toegevoegd', `${user} is toegevoegd aan de ticket door ${i.user}.`, G)] });
  },
});

commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('remove').setDescription('Verwijder een gebruiker uit deze ticket')
    .addUserOption((o) => o.setName('user').setDescription('Wie verwijderen?').setRequired(true)),
  async execute(i) {
    const t = getTicket(i.channel);
    if (!t) return notTicket(i);
    const user = i.options.getUser('user');
    if (user.id === t.userId) return i.reply({ content: 'Je kunt de eigenaar van de ticket niet verwijderen. Gebruik /close.', flags: E });
    await i.channel.permissionOverwrites.delete(user.id);
    return i.reply({ embeds: [embed('➖ Verwijderd', `${user} is verwijderd uit de ticket door ${i.user}.`, G)] });
  },
});

commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('rename').setDescription('Hernoem deze ticket')
    .addStringOption((o) => o.setName('naam').setDescription('Nieuwe naam').setRequired(true).setMaxLength(90)),
  async execute(i) {
    if (!getTicket(i.channel)) return notTicket(i);
    const naam = i.options.getString('naam').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
    await i.reply({ content: `✏️ Hernoemen naar **${naam}**... (Discord limiet: 2x per 10 min)`, flags: E });
    await i.channel.setName(naam);
  },
});

module.exports = { commands, components };
