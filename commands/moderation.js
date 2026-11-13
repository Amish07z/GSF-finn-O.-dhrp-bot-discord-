const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { sendToChannel, E, embed, logAction, dm, outranks, canManageRole, addZicht, addZichtPrive, vis, getTimedOut, fmtLeft, idFromInput } = require('../utils');
const { updateBlacklistPanel } = require('../panels');

const commands = [];
const ts = (d) => `<t:${Math.floor(d / 1000)}:d>`;

// ---------- /warn <nummer> <user> <reden> ----------
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('warn').setDescription('Geef een speler een waarschuwing')
    .addIntegerOption((o) => o.setName('nummer').setDescription(`Welke waarschuwing is dit? (1 t/m ${config.maxWarns})`).setRequired(true).setMinValue(1).setMaxValue(config.maxWarns))
    .addUserOption((o) => o.setName('user').setDescription('Wie krijgt de warn?').setRequired(true))
    .addStringOption((o) => o.setName('reden').setDescription('Reden van de warn').setRequired(true)),
  async execute(i, client) {
    const nummer = i.options.getInteger('nummer');
    const user = i.options.getUser('user');
    const reden = i.options.getString('reden');
    if (user.bot) return i.reply({ content: 'Je kunt geen bots warnen.', flags: E });
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    if (!outranks(i, member)) return i.reply({ content: 'Je kunt iemand met een gelijke of hogere rol niet warnen.', flags: E });
    if (db.getWarn(user.id, nummer)) return i.reply({ content: `${user} heeft al **warn ${nummer}**. Gebruik /warns om ze te bekijken of /removewarn om er een in te trekken.`, flags: E });

    const w = db.addWarn({ userId: user.id, modId: i.user.id, reason: reden, nummer, tag: user.username });
    const total = db.getWarns(user.id).length;
    const dmOk = await dm(user, embed('⚠️ Je hebt een waarschuwing ontvangen', `**Server:** ${config.serverName}\n**Reden:** ${reden}\n**Warn ${w.nummer}** • Totaal: **${total}**`));

    const e = embed('⚠️ Waarschuwing gegeven', `**Speler:** ${user} (${user.tag})\n**Door:** ${i.user}\n**Reden:** ${reden}\n**Warn:** ${w.nummer}\n**Totaal warns:** ${total}${dmOk ? '' : '\n*(DM kon niet worden verstuurd)*'}`);
    await i.reply({ embeds: [e] });
    sendToChannel(client, 'warns', { embeds: [e] }); // optioneel warn-kanaal (config.channels.warns)
    logAction(client, i, '⚠️ Waarschuwing', `${user} kreeg **warn ${w.nummer}**.\nReden: ${reden}`);
  },
});

// ---------- /warns ----------
commands.push({
  level: 'everyone',
  data: new SlashCommandBuilder().setName('warns').setDescription('Bekijk de warns van een speler')
    .addUserOption((o) => o.setName('user').setDescription('Speler (leeg = jezelf)'))
    .addStringOption(addZicht),
  async execute(i) {
    const user = i.options.getUser('user') || i.user;
    const list = db.getWarns(user.id);
    const text = list.length
      ? list.map((w) => `**Warn ${w.nummer}** • ${ts(w.date)} • <@${w.modId}>\n${w.reason}`).join('\n\n')
      : 'Deze speler heeft geen warns. 🎉';
    return i.reply({ embeds: [embed(`Warns van ${user.tag} (${list.length})`, text)], ...vis(i) });
  },
});

// ---------- /removewarn <speler> <nummer> <reden> (dropdowns: spelers met warns, daarna hun warns) ----------
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('removewarn').setDescription('Trek een waarschuwing in (kies uit de lijst)')
    .addStringOption((o) => o.setName('speler').setDescription('Kies een speler met warns').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('nummer').setDescription('Welke warn? (verschijnt na het kiezen van een speler)').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('reden').setDescription('Reden van intrekken').setRequired(true)),
  async autocomplete(i) {
    const focused = i.options.getFocused(true);
    const q = String(focused.value).toLowerCase();
    if (focused.name === 'speler') {
      const list = db.getWarnedUsers()
        .map((w) => {
          const tag = i.client.users.cache.get(w.userId)?.tag || w.tag || w.userId;
          return { name: `${tag} • ${w.count} warn${w.count === 1 ? '' : 's'}`.slice(0, 100), value: w.userId, search: `${tag} ${w.userId}`.toLowerCase() };
        })
        .filter((c) => c.search.includes(q))
        .slice(0, 25)
        .map(({ name, value }) => ({ name, value }));
      return i.respond(list).catch(() => {});
    }
    // nummer: alleen de warns van de gekozen speler
    const id = idFromInput(i.options.getString('speler'));
    const list = id
      ? db.getWarns(id)
        .filter((w) => String(w.nummer).includes(q))
        .slice(0, 25)
        .map((w) => ({ name: `Warn ${w.nummer} • ${w.reason}`.slice(0, 100), value: w.nummer }))
      : [];
    return i.respond(list).catch(() => {});
  },
  async execute(i, client) {
    const id = idFromInput(i.options.getString('speler'));
    const nummer = i.options.getInteger('nummer');
    const reden = i.options.getString('reden');
    if (!id) return i.reply({ content: 'Kies een speler uit de lijst.', flags: E });
    const w = db.removeWarn(id, nummer);
    if (!w) return i.reply({ content: `<@${id}> heeft geen **warn ${nummer}**.`, flags: E });
    const e = embed('🗑️ Warn ingetrokken', `**Warn ${w.nummer}** van <@${id}> is ingetrokken door ${i.user}.\n**Originele reden:** ${w.reason}\n**Reden intrekken:** ${reden}`);
    await i.reply({ embeds: [e] });
    logAction(client, i, '🗑️ Waarschuwing ingetrokken', `**Warn ${w.nummer}** van <@${id}> ingetrokken.\nReden: ${reden}`);
  },
});

// ---------- /mute <user> <minuten> [reden] ----------
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('mute').setDescription('Mute (timeout) een speler')
    .addUserOption((o) => o.setName('user').setDescription('Speler').setRequired(true))
    .addIntegerOption((o) => o.setName('minuten').setDescription('Hoeveel minuten? (max 40320 = 28 dagen)').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((o) => o.setName('reden').setDescription('Reden')),
  async execute(i, client) {
    const user = i.options.getUser('user');
    const minutes = i.options.getInteger('minuten');
    const reden = i.options.getString('reden') || 'Geen reden opgegeven';
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    if (!member) return i.reply({ content: 'Speler niet gevonden in de server.', flags: E });
    if (!outranks(i, member) || !member.moderatable) return i.reply({ content: 'Ik of jij kan deze speler niet muten (rolhiërarchie).', flags: E });
    await member.timeout(minutes * 60 * 1000, `${i.user.tag}: ${reden}`);
    await dm(user, embed('🔇 Je bent gemuted', `**Server:** ${config.serverName}\n**Duur:** ${minutes} min\n**Reden:** ${reden}`));
    const e = embed('🔇 Speler gemuted', `**Speler:** ${user}\n**Door:** ${i.user}\n**Duur:** ${minutes} minuten\n**Reden:** ${reden}`);
    await i.reply({ embeds: [e] });
    logAction(client, i, '🔇 Mute', `${user} gemuted voor **${minutes} min**.\nReden: ${reden}`);
  },
});

// ---------- /untimeout & /unmute <speler> [reden] (dropdown met wie er nu getimeout/gemuted is) ----------
const timeoutAutocomplete = async (i) => {
  const q = String(i.options.getFocused()).toLowerCase();
  let list = [];
  try {
    list = (await getTimedOut(i.guild))
      .filter((m) => `${m.user.tag} ${m.displayName} ${m.id}`.toLowerCase().includes(q))
      .slice(0, 25)
      .map((m) => ({ name: `${m.user.tag} • nog ${fmtLeft(m.communicationDisabledUntilTimestamp - Date.now())}`.slice(0, 100), value: m.id }));
  } catch { /* lege lijst */ }
  return i.respond(list).catch(() => {});
};

function untimeoutCommand(name, description, titel) {
  return {
    level: 'staff',
    data: new SlashCommandBuilder().setName(name).setDescription(description)
      .addStringOption((o) => o.setName('speler').setDescription('Kies een speler die nu getimeout is').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('reden').setDescription('Reden')),
    autocomplete: timeoutAutocomplete,
    async execute(i, client) {
      const id = idFromInput(i.options.getString('speler'));
      const reden = i.options.getString('reden') || 'Geen reden opgegeven';
      if (!id) return i.reply({ content: 'Kies een speler uit de lijst.', flags: E });
      const member = await i.guild.members.fetch({ user: id, force: true }).catch(() => null);
      if (!member) return i.reply({ content: 'Speler niet gevonden in de server.', flags: E });
      if (!member.isCommunicationDisabled()) return i.reply({ content: 'Deze speler heeft geen timeout.', flags: E });
      if (!member.moderatable) return i.reply({ content: 'Ik kan de timeout van deze speler niet weghalen (rolhiërarchie).', flags: E });
      await member.timeout(null, `${titel} door ${i.user.tag}: ${reden}`);
      const e = embed('🔊 Timeout opgeheven', `**Speler:** ${member.user}\n**Door:** ${i.user}\n**Reden:** ${reden}`, 0x2ecc71);
      await i.reply({ embeds: [e] });
      logAction(client, i, '🔊 Timeout opgeheven', `${member.user}: timeout opgeheven.\nReden: ${reden}`);
    },
  };
}
commands.push(untimeoutCommand('untimeout', 'Haal een timeout weg (kies uit de lijst)', 'Untimeout'));
commands.push(untimeoutCommand('unmute', 'Haal een mute weg (kies uit de lijst)', 'Unmute'));

// ---------- /clear ----------
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('clear').setDescription('Verwijder berichten in dit kanaal')
    .addIntegerOption((o) => o.setName('aantal').setDescription('Aantal berichten (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
  async execute(i, client) {
    const n = i.options.getInteger('aantal');
    const user = i.options.getUser('user');
    await i.deferReply({ flags: E });
    let deleted;
    if (user) {
      const fetched = await i.channel.messages.fetch({ limit: 100 });
      const filtered = [...fetched.filter((m) => m.author.id === user.id).values()].slice(0, n);
      deleted = await i.channel.bulkDelete(filtered, true);
    } else {
      deleted = await i.channel.bulkDelete(n, true);
    }
    await i.editReply(`🧹 ${deleted.size} bericht(en) verwijderd. (Berichten ouder dan 14 dagen kunnen niet bulk-verwijderd worden.)`);
    logAction(client, i, '🧹 Clear', `**${deleted.size}** berichten verwijderd in ${i.channel}${user ? ` van ${user}` : ''}.`);
  },
});

// ---------- /clearuser (zelfde als /clear, maar alleen berichten van één speler) ----------
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('clearuser').setDescription('Verwijder berichten van één speler in dit kanaal')
    .addUserOption((o) => o.setName('user').setDescription('Van wie?').setRequired(true))
    .addIntegerOption((o) => o.setName('aantal').setDescription('Aantal berichten (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
  execute: commands.find((c) => c.data.name === 'clear').execute,
});

// ---------- /blacklist <user> <reden> [duur] ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('blacklist').setDescription('Zet een speler op de blacklist (geen tickets/sollicitaties)')
    .addUserOption((o) => o.setName('user').setDescription('Speler').setRequired(true))
    .addStringOption((o) => o.setName('reden').setDescription('Reden').setRequired(true))
    .addIntegerOption((o) => o.setName('duur').setDescription('Aantal dagen (leeg = permanent)').setMinValue(1).setMaxValue(365)),
  async execute(i, client) {
    const user = i.options.getUser('user');
    const reden = i.options.getString('reden');
    const dagen = i.options.getInteger('duur');
    if (db.isBlacklisted(user.id)) return i.reply({ content: 'Deze speler staat al op de blacklist.', flags: E });
    const until = dagen ? Date.now() + dagen * 86400000 : null;
    await i.deferReply({ flags: E });
    db.addBlacklist(user.id, reden, i.user.id, until, user.username);
    const duurTxt = dagen ? `**${dagen} dag(en)** (tot <t:${Math.floor(until / 1000)}:d>)` : '**permanent**';
    let roleNote = '';
    if (config.blacklistRoleId) {
      const m = await i.guild.members.fetch(user.id).catch(() => null);
      const role = i.guild.roles.cache.get(config.blacklistRoleId);
      if (m && role && canManageRole(i.guild, role)) await m.roles.add(role, `Blacklist: ${reden}`);
      else roleNote = '\n*(Blacklist-rol kon niet gegeven worden)*';
    }
    const dmOk = await dm(user, embed('⛔ Je staat op de blacklist', `**Server:** ${config.serverName}\n**Duur:** ${dagen ? `${dagen} dag(en)` : 'permanent'}\n**Reden:** ${reden}`));
    // Geen losse embed per blacklist: de lijst in het blacklist-kanaal (1 embed) wordt bijgewerkt
    let panelNote = '';
    try {
      const res = await updateBlacklistPanel(client, i.channel);
      if (!res) panelNote = '\n⚠️ Geen blacklist-kanaal gevonden (zet `channels.blacklist` in config.js).';
      else if (res.created) panelNote = `\nLijst geplaatst in <#${res.msg.channelId}>.`;
    } catch (err) { panelNote = `\n⚠️ Blacklist-lijst bijwerken mislukt: ${err.message}`; }
    await i.editReply(`⛔ ${user} staat nu op de blacklist (${duurTxt}).${roleNote}${panelNote}${dmOk ? '' : '\n*(DM kon niet worden verstuurd)*'}`);
    logAction(client, i, '⛔ Blacklist', `${user} op de blacklist gezet (${duurTxt}).\nReden: ${reden}`);
  },
});

// ---------- /unblacklist <speler> (dropdown met wie er nu op de blacklist staat) ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('unblacklist').setDescription('Haal een speler van de blacklist (kies uit de lijst)')
    .addStringOption((o) => o.setName('speler').setDescription('Kies een geblackliste speler').setRequired(true).setAutocomplete(true)),
  // Dropdown: alle spelers die op dit moment op de blacklist staan (max 25, filtert op wat je typt)
  async autocomplete(i) {
    const q = String(i.options.getFocused()).toLowerCase();
    const list = db.getBlacklist()
      .map((b) => {
        const wie = b.tag || b.userId;
        const wanneer = b.until ? `tot ${new Date(b.until).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Amsterdam' })}` : 'permanent';
        return { name: `${wie} • ${wanneer} • ${b.reason || 'geen reden'}`.slice(0, 100), value: b.userId, search: `${wie} ${b.userId} ${b.reason || ''}`.toLowerCase() };
      })
      .filter((c) => c.search.includes(q))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value }));
    return i.respond(list);
  },
  async execute(i, client) {
    const id = i.options.getString('speler').trim().replace(/[<@!>]/g, ''); // werkt ook met een geplakt ID of @mention
    if (!db.removeBlacklist(id)) return i.reply({ content: 'Deze speler staat niet op de blacklist.', flags: E });
    const user = await client.users.fetch(id).catch(() => null);
    const wie = user ? `${user}` : `<@${id}>`;
    if (config.blacklistRoleId) {
      const m = await i.guild.members.fetch(id).catch(() => null);
      if (m) await m.roles.remove(config.blacklistRoleId).catch(() => {});
    }
    await i.deferReply({ flags: E });
    const dmOk = user ? await dm(user, embed('✅ Je staat niet meer op de blacklist', `**Server:** ${config.serverName}\n\nJe blacklist is opgeheven. Je kunt weer tickets openen en solliciteren.`, 0x2ecc71)) : false;
    const res = await updateBlacklistPanel(client, i.channel).catch(() => null);
    await i.editReply(`✅ ${wie} is van de blacklist gehaald${res ? ' en de lijst is bijgewerkt' : ''}.${dmOk ? '' : '\n*(DM kon niet worden verstuurd)*'}`);
    logAction(client, i, '✅ Unblacklist', `${wie} van de blacklist gehaald.`);
  },
});

// ---------- /blacklistlijst (lijst plaatsen of bijwerken) ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('blacklistlijst').setDescription('Plaats of werk de blacklist-lijst bij'),
  async execute(i, client) {
    await i.deferReply({ flags: E });
    try {
      const res = await updateBlacklistPanel(client, i.channel);
      if (!res) return i.editReply('⚠️ Geen blacklist-kanaal gevonden (zet `channels.blacklist` in config.js).');
      return i.editReply(res.created ? `✅ Blacklist-lijst geplaatst in <#${res.msg.channelId}>.` : '✅ Blacklist-lijst bijgewerkt.');
    } catch (err) { return i.editReply(`⚠️ Mislukt: ${err.message}`); }
  },
});

module.exports = { commands };
