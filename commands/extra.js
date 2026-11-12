const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { sendUnbanDm } = require('../notify');
const { appealLine, E, embed, logAction, dm, outranks, addZicht, addZichtPrive, vis, getBans, invalidateBans, idFromInput } = require('../utils');
const { refreshLedenlijst, postOverzicht, postRegels, postGangregels, updateStatusPanel } = require('../panels');

const commands = [];

// ---------- /refresh (ledenlijst bijwerken) ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('refresh').setDescription('Refresh de gang ledenlijst'),
  async execute(i, client) {
    await i.deferReply({ flags: E });
    try {
      const res = await refreshLedenlijst(client, i.guild, i.channel);
      if (!res) return i.editReply('⚠️ Geen kanaal gevonden voor de ledenlijst. Zet `channels.ledenlijst` in config.js.');
      return i.editReply(res.created ? `✅ Ledenlijst geplaatst in <#${res.msg.channelId}>.` : '✅ Ledenlijst bijgewerkt.');
    } catch (err) {
      return i.editReply(`⚠️ Ledenlijst bijwerken mislukt: ${err.message}`);
    }
  },
});

// ---------- /commands (commands-overzicht plaatsen of bijwerken) ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('commands').setDescription('Plaats of werk het commands-overzicht bij'),
  async execute(i, client) {
    await i.deferReply({ flags: E });
    try {
      const res = await postOverzicht(client);
      return i.editReply(res.created ? `✅ Overzicht geplaatst in <#${res.msg.channelId}>.` : '✅ Overzicht bijgewerkt.');
    } catch (err) {
      return i.editReply(`⚠️ Mislukt: ${err.message}`);
    }
  },
});

// ---------- /regels (GSF regels plaatsen of bijwerken) ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('regels').setDescription('Plaats of werk de GSF regels bij in het regels-kanaal'),
  async execute(i, client) {
    await i.deferReply({ flags: E });
    try {
      const res = await postRegels(client);
      return i.editReply(res.created ? `✅ Regels geplaatst in <#${res.msg.channelId}>.` : '✅ Regels bijgewerkt.');
    } catch (err) {
      return i.editReply(`⚠️ Mislukt: ${err.message}`);
    }
  },
});

// ---------- /gangregels (rijden / rippen / ruzies) ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('gangregels').setDescription('Plaats of werk de gang-regels bij (rijden, rippen, ruzies)'),
  async execute(i, client) {
    await i.deferReply({ flags: E });
    try {
      const res = await postGangregels(client);
      return i.editReply(res.created ? `✅ Gang-regels geplaatst in <#${res.msg.channelId}>.` : '✅ Gang-regels bijgewerkt.');
    } catch (err) {
      return i.editReply(`⚠️ Mislukt: ${err.message}`);
    }
  },
});

// ---------- /status (sollicitatie-status) ----------
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('status').setDescription('Plaats of werk de sollicitatie-status bij')
    .addStringOption((o) => o.setName('status').setDescription('Leeg = automatisch op basis van het aantal gangleden').addChoices(
      { name: '🤖 Automatisch (op basis van gangleden / max)', value: 'auto' },
      { name: '🟢 Open', value: 'open' },
      { name: '🟠 Bijna vol', value: 'bijna' },
      { name: '🔴 Vol', value: 'vol' })),
  async execute(i, client) {
    await i.deferReply({ flags: E });
    const keuze = i.options.getString('status');
    if (keuze) db.setStatusMode(keuze);
    try {
      const res = await updateStatusPanel(client, i.guild, i.channel);
      if (!res) return i.editReply('⚠️ Geen kanaal gevonden voor de status.');
      const modus = db.data.statusMode === 'auto' ? 'automatisch' : `handmatig op **${db.data.statusMode}**`;
      if (keuze) logAction(client, i, '📝 Sollicitatie-status', `Status staat nu ${modus}.`);
      return i.editReply(`${res.created ? `✅ Status geplaatst in <#${res.msg.channelId}>.` : '✅ Status bijgewerkt.'} (Modus: ${modus})`);
    } catch (err) {
      return i.editReply(`⚠️ Mislukt: ${err.message}`);
    }
  },
});

// ---------- /kick ----------
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('kick').setDescription('Kick een speler')
    .addUserOption((o) => o.setName('user').setDescription('Speler').setRequired(true))
    .addStringOption((o) => o.setName('reden').setDescription('Reden').setRequired(true)),
  async execute(i, client) {
    const user = i.options.getUser('user'); const reden = i.options.getString('reden');
    const m = await i.guild.members.fetch(user.id).catch(() => null);
    if (!m) return i.reply({ content: 'Speler niet gevonden.', flags: E });
    if (!outranks(i, m) || !m.kickable) return i.reply({ content: 'Je of ik kan deze speler niet kicken (rolhiërarchie).', flags: E });
    await dm(user, embed('👢 Je bent gekickt', `**Server:** ${config.serverName}\n**Reden:** ${reden}${appealLine()}`));
    await m.kick(`${i.user.tag}: ${reden}`);
    const e = embed('👢 Speler gekickt', `**Speler:** ${user.tag}\n**Door:** ${i.user}\n**Reden:** ${reden}`);
    await i.reply({ embeds: [e] });
    logAction(client, i, '👢 Kick', `${user} gekickt.\nReden: ${reden}`);
  },
});

// ---------- /ban ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('ban').setDescription('Ban een speler')
    .addUserOption((o) => o.setName('user').setDescription('Speler').setRequired(true))
    .addStringOption((o) => o.setName('reden').setDescription('Reden').setRequired(true))
    .addIntegerOption((o) => o.setName('verwijder_dagen').setDescription('Berichten van de speler verwijderen?').setRequired(true).addChoices({ name: 'Niet verwijderen', value: 0 }, { name: 'Laatste 24 uur', value: 1 }, { name: 'Laatste 7 dagen', value: 7 })),
  async execute(i, client) {
    const user = i.options.getUser('user'); const reden = i.options.getString('reden');
    const m = await i.guild.members.fetch(user.id).catch(() => null);
    if (m && (!outranks(i, m) || !m.bannable)) return i.reply({ content: 'Je of ik kan deze speler niet bannen (rolhiërarchie).', flags: E });
    await dm(user, embed('🔨 Je bent gebanned', `**Server:** ${config.serverName}\n**Reden:** ${reden}${appealLine()}`));
    await i.guild.members.ban(user.id, { reason: `${i.user.tag}: ${reden}`, deleteMessageSeconds: (i.options.getInteger('verwijder_dagen') || 0) * 86400 });
    invalidateBans(i.guild);
    const e = embed('🔨 Speler gebanned', `**Speler:** ${user.tag} (${user.id})\n**Door:** ${i.user}\n**Reden:** ${reden}`);
    await i.reply({ embeds: [e] });
    logAction(client, i, '🔨 Ban', `${user} gebanned.\nReden: ${reden}`);
  },
});

// ---------- /unban <speler> <reden> (dropdown met wie er nu gebanned is) ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('unban').setDescription('Unban een speler (kies uit de lijst met gebande spelers)')
    .addStringOption((o) => o.setName('speler').setDescription('Kies een gebande speler').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('reden').setDescription('Reden').setRequired(true)),
  async autocomplete(i) {
    const q = String(i.options.getFocused()).toLowerCase();
    let list = [];
    try {
      list = (await getBans(i.guild))
        .filter((b) => `${b.tag} ${b.userId} ${b.reason || ''}`.toLowerCase().includes(q))
        .slice(0, 25)
        .map((b) => ({ name: `${b.tag} • ${b.reason || 'geen reden'}`.slice(0, 100), value: b.userId }));
      // Geplakt ID dat niet in de lijst staat: toch aanbieden
      const typed = idFromInput(q);
      if (typed && !list.some((c) => c.value === typed)) list.unshift({ name: `ID ${typed}`, value: typed });
    } catch { /* te traag of geen rechten: lege lijst */ }
    return i.respond(list).catch(() => {});
  },
  async execute(i, client) {
    const id = idFromInput(i.options.getString('speler'));
    const reden = i.options.getString('reden') || 'Geen reden opgegeven';
    if (!id) return i.reply({ content: 'Kies een speler uit de lijst (of plak een geldig gebruikers-ID).', flags: E });
    const known = (await getBans(i.guild).catch(() => [])).find((b) => b.userId === id);
    try { await i.guild.members.unban(id, `${i.user.tag}: ${reden}`); }
    catch { return i.reply({ content: 'Deze gebruiker is niet gebanned of het ID klopt niet.', flags: E }); }
    invalidateBans(i.guild);
    await i.deferReply();
    const wie = known ? `${known.tag} (${id})` : id;
    // DM met serverlink rechtstreeks vanuit het commando (niet afhankelijk van het audit log)
    const target = await client.users.fetch(id).catch(() => null);
    if (target && !target.bot) await sendUnbanDm(client, i.guild, target, reden, i.user.id);
    const e = embed('✅ Speler geunbanned', `**Speler:** ${wie}\n**Door:** ${i.user}\n**Reden:** ${reden}${known?.reason ? `\n**Originele ban-reden:** ${known.reason}` : ''}`, 0x2ecc71);
    await i.editReply({ embeds: [e] });
    logAction(client, i, '✅ Unban', `<@${id}> (\`${id}\`) geunbanned.\nReden: ${reden}`);
  },
});

// ---------- /lock & /unlock ----------
for (const [name, lock] of [['lock', true], ['unlock', false]]) {
  commands.push({
    level: 'staff',
    data: new SlashCommandBuilder().setName(name).setDescription(lock ? 'Vergrendel dit kanaal' : 'Ontgrendel dit kanaal'),
    async execute(i) {
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: lock ? false : null });
      return i.reply({ embeds: [embed(lock ? '🔒 Kanaal vergrendeld' : '🔓 Kanaal ontgrendeld', `Door ${i.user}.`)] });
    },
  });
}

// ---------- /serverstatus ----------
commands.push({
  level: 'everyone',
  data: new SlashCommandBuilder().setName('serverstatus').setDescription('Toon de status van de FiveM server').addStringOption(addZicht),
  async execute(i) {
    if (!config.fivemUrl) return i.reply({ content: 'De FiveM server-URL is nog niet ingesteld in config.js (fivemUrl).', flags: E });
    await i.deferReply({ ...vis(i) });
    try {
      const get = (p) => fetch(`${config.fivemUrl}${p}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
      const [info, players] = await Promise.all([get('/info.json'), get('/players.json')]);
      const max = info.vars?.sv_maxClients ?? '?';
      return i.editReply({ embeds: [embed('🟢 Server online', `**${config.serverName}**\n\n👥 Spelers: **${players.length}/${max}**`, 0x2ecc71)] });
    } catch {
      return i.editReply({ embeds: [embed('🔴 Server offline', 'De server reageert niet (of is niet bereikbaar).', 0xe74c3c)] });
    }
  },
});

module.exports = { commands };
