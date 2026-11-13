const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { E, embed, announce, dm, canManageRole, logAction, setGangNick, addZicht, addZichtPrive, vis } = require('../utils');
const { updatePortoPanel, refreshLedenlijst, scheduleLedenlijst, gangCount, updateAfwezigPanel } = require('../panels');

const commands = [];
const ranks = config.ranks; // laagste -> hoogste

// ---------- helpers ----------
const isAdmin = (i) => i.guild.ownerId === i.user.id || (config.antinukeAdminIds || []).includes(i.user.id);
const rankIdx = (m) => { let idx = -1; ranks.forEach((r, n) => { if (m.roles.cache.has(r.id)) idx = n; }); return idx; };
const myIdx = (i) => (isAdmin(i) ? 999 : rankIdx(i.member));
const rankRole = (i, n) => i.guild.roles.cache.get(ranks[n].id);

async function getMember(i, user) {
  const m = await i.guild.members.fetch(user.id).catch(() => null);
  if (!m) await i.reply({ content: 'Speler niet gevonden in de server.', flags: E });
  return m;
}
async function checkRoles(i, roles) {
  for (const r of roles.filter(Boolean)) {
    if (!canManageRole(i.guild, r)) {
      await i.reply({ content: `Ik kan de rol **${r.name}** niet beheren. Zet de bot-rol in Serverinstellingen > Rollen **boven** deze rol.`, flags: E });
      return false;
    }
  }
  return true;
}
// ----- GSF Lead (leiding-rol): automatisch vanaf een bepaalde rang -----
const leadFrom = ranks.findIndex((r) => r.name === config.leadFromRank);
const leadRole = (i) => (config.leadRoleId ? i.guild.roles.cache.get(config.leadRoleId) : null);
// Welke wijziging van de leiding-rol hoort bij deze (nieuwe) rang? null = niets te doen
function leadChange(i, m, newIdx) {
  const role = leadRole(i);
  if (!role || leadFrom === -1) return null;
  const want = newIdx >= leadFrom;
  const has = m.roles.cache.has(role.id);
  return want === has ? null : { role, add: want };
}
const leadText = (lc) => (lc ? `\n**Leiding-rol:** ${lc.add ? '➕' : '➖'} ${lc.role}` : '');

// Inwoner-rol: iedereen in de server hoort deze te hebben (ook na promo/demote/ontslag)
async function ensureInwoner(i, m, reason) {
  const role = config.inwonerRoleId ? i.guild.roles.cache.get(config.inwonerRoleId) : null;
  if (role && !m.roles.cache.has(role.id)) await m.roles.add(role, reason).catch(() => {});
}

async function setRank(i, m, newIdx, reason) {
  const newRole = rankRole(i, newIdx);
  for (const r of ranks) if (r.id !== newRole.id && m.roles.cache.has(r.id)) await m.roles.remove(r.id, reason);
  if (!m.roles.cache.has(newRole.id)) await m.roles.add(newRole, reason);
  await ensureInwoner(i, m, reason);
  const lc = leadChange(i, m, newIdx);
  if (lc) await (lc.add ? m.roles.add(lc.role, reason) : m.roles.remove(lc.role, reason));
}

// Dropdown (autocomplete): toont alleen rangen die JIJ mag geven (lager dan je eigen rang)
// mode: 'hire' = alles onder jouw rang | 'promo' = boven de rang van de gekozen speler | 'demote' = onder de rang van de gekozen speler
function rankAutocomplete(mode) {
  return async (i) => {
    const q = String(i.options.getFocused()).toLowerCase();
    let lo = -1;
    let hi = myIdx(i);
    if (mode !== 'hire') {
      const uid = i.options.get('user')?.value;
      const m = uid ? await i.guild.members.fetch(uid).catch(() => null) : null;
      if (m) {
        const cur = rankIdx(m);
        if (mode === 'promo') lo = cur; else hi = Math.min(hi, cur);
      }
    }
    const list = ranks
      .map((r, n) => ({ name: r.name, value: n }))
      .filter((r) => r.value > lo && r.value < hi && r.name.toLowerCase().includes(q))
      .reverse(); // hoogste rang bovenaan
    return i.respond(list.slice(0, 25));
  };
}
const deny = (i, msg) => i.reply({ content: `⛔ ${msg}`, flags: E });

// ---------- /aangenomen ----------
commands.push({
  level: 'lead',
  autocomplete: rankAutocomplete('hire'),
  data: new SlashCommandBuilder().setName('aangenomen').setDescription('Neem een sollicitant aan in de GSF')
    .addUserOption((o) => o.setName('user').setDescription('Aangenomen speler').setRequired(true))
    .addIntegerOption((o) => o.setName('rang').setDescription('Kies de rang waarmee de speler start').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('reden').setDescription('Reden / opmerking').setRequired(true)),
  async execute(i, client) {
    const user = i.options.getUser('user');
    const idx = i.options.getInteger('rang');
    if (!ranks[idx]) return deny(i, 'Kies een rang uit de dropdown.');
    const opm = i.options.getString('reden');
    const m = await getMember(i, user); if (!m) return;
    if (user.bot) return deny(i, 'Je kunt geen bots aannemen.');
    if (rankIdx(m) !== -1) return deny(i, `${user} heeft al een rang (**${ranks[rankIdx(m)].name}**). Gebruik /promo of /demote.`);
    if (!(myIdx(i) > idx)) return deny(i, 'Je kunt alleen rangen geven die lager zijn dan je eigen rang.');

    const rank = rankRole(i, idx);
    const gang = i.guild.roles.cache.get(config.gangRoleId);
    if (!rank || !gang) return deny(i, 'Een rol uit config.js bestaat niet in deze server. Check de ID\'s.');
    const lc = leadChange(i, m, idx);
    const toAdd = [gang, rank, ...(lc?.add ? [lc.role] : [])];
    if (!(await checkRoles(i, toAdd))) return;

    // Max gangleden (alleen actief als ingesteld met /editmax)
    const max = db.data.maxMembers;
    if (max > 0) {
      const count = await gangCount(i.guild);
      if (count >= max) return deny(i, `De gang is vol (**${count}/${max}**). Verhoog het maximum met /editmax of ontsla eerst iemand.`);
    }

    await m.roles.add(toAdd, `Aangenomen door ${i.user.tag}`);
    db.setHired(user.id, { date: Date.now(), by: i.user.id, rank: rank.name });
    const nickOk = await setGangNick(m, true, `Aangenomen door ${i.user.tag}`);
    const e = embed('✅ Welkom bij de GSF!', `Gefeliciteerd ${user}, je bent aangenomen!\n\n**Rang:** ${rank}${leadText(lc)}\n**Aangenomen door:** ${i.user}\n**Reden:** ${opm}`, 0x2ecc71);
    await dm(user, e);
    await announce(i, client, 'aangenomen', e, `${user}`);
    if (!nickOk) i.followUp({ content: `⚠️ De bijnaam van ${user} kon niet worden aangepast (bot-rol te laag, of de bot mist de permissie *Bijnamen beheren*). Pas hem handmatig aan naar \`${config.namePrefix}naam\`.`, flags: E }).catch(() => {});
    logAction(client, i, '✅ Aangenomen', `${user} aangenomen als **${rank.name}**.\nReden: ${opm}`);
    scheduleLedenlijst(client, i.guild);
  },
});

// ---------- /ontslagen ----------
commands.push({
  level: 'lead',
  data: new SlashCommandBuilder().setName('ontslagen').setDescription('Zet een lid uit de GSF (verwijdert alle rang-rollen)')
    .addUserOption((o) => o.setName('user').setDescription('Speler').setRequired(true))
    .addStringOption((o) => o.setName('reden').setDescription('Reden').setRequired(true)),
  async execute(i, client) {
    const user = i.options.getUser('user');
    const reden = i.options.getString('reden');
    const m = await getMember(i, user); if (!m) return;
    const cur = rankIdx(m);
    if (user.id === i.user.id) return deny(i, 'Je kunt jezelf niet ontslaan.');
    if (cur !== -1 && !(myIdx(i) > cur)) return deny(i, 'Je kunt alleen leden met een lagere rang dan jij ontslaan.');

    const roles = config.dienstRoleIds.map((id) => i.guild.roles.cache.get(id)).filter((r) => r && m.roles.cache.has(r.id));
    if (!roles.length) return deny(i, `${user} heeft geen GSF-rollen.`);
    if (!(await checkRoles(i, roles))) return;

    await m.roles.remove(roles, `Ontslagen door ${i.user.tag}: ${reden}`);
    await ensureInwoner(i, m, 'Ontslagen: terug naar Inwoner');
    const nickOk = await setGangNick(m, false, `Ontslagen door ${i.user.tag}`);
    const e = embed('📤 Ontslagen', `**Speler:** ${user}\n**Vorige rang:** ${cur !== -1 ? ranks[cur].name : 'geen'}\n**Door:** ${i.user}\n**Reden:** ${reden}\n**Verwijderde rollen:** ${roles.map((r) => r.name).join(', ')}`);
    await dm(user, e);
    await announce(i, client, 'ontslagen', e);
    if (!nickOk) i.followUp({ content: `⚠️ De bijnaam van ${user} kon niet worden aangepast (bot-rol te laag, of de bot mist de permissie *Bijnamen beheren*). Haal \`${config.namePrefix.trim()}\` handmatig weg.`, flags: E }).catch(() => {});
    logAction(client, i, '❌ Ontslagen', `${user} ontslagen.\nReden: ${reden}`);
    if (db.removeAbsent(user.id)) updateAfwezigPanel(client).catch(() => {});
    scheduleLedenlijst(client, i.guild);
  },
});

// ---------- /promo & /demote (stappen = aantal rangen omhoog/omlaag) ----------
function stepCommand(kind) {
  const up = kind === 'promo';
  return {
    level: 'lead',
    data: new SlashCommandBuilder().setName(kind).setDescription(up ? 'Promoot een lid een aantal rangen omhoog' : 'Degradeer een lid een aantal rangen omlaag')
      .addIntegerOption((o) => o.setName('stappen').setDescription(up ? 'Aantal rangen omhoog' : 'Aantal rangen omlaag').setRequired(true).setMinValue(1).setMaxValue(ranks.length - 1))
      .addUserOption((o) => o.setName('user').setDescription('Speler').setRequired(true))
      .addStringOption((o) => o.setName('reden').setDescription(up ? 'Reden / felicitatie' : 'Reden').setRequired(true)),
    async execute(i, client) {
      const user = i.options.getUser('user');
      const reden = i.options.getString('reden');
      const stappen = i.options.getInteger('stappen');
      const m = await getMember(i, user); if (!m) return;
      const cur = rankIdx(m);
      if (cur === -1) return deny(i, `${user} heeft nog geen rang.${up ? ' Gebruik eerst /aangenomen.' : ''}`);
      if (!(myIdx(i) > cur)) return deny(i, `Je kunt alleen leden met een lagere rang dan jij ${up ? 'promoten' : 'degraderen'}.`);
      const idx = up ? cur + stappen : cur - stappen;
      if (up) {
        if (idx > ranks.length - 1) return deny(i, `${user} kan maximaal **${ranks.length - 1 - cur}** stap(pen) omhoog (hoogste rang: **${ranks[ranks.length - 1].name}**).`);
        if (!(myIdx(i) > idx)) return deny(i, 'Je kunt niemand promoten naar je eigen rang of hoger.');
      } else if (idx < 0) {
        return deny(i, `${user} kan maximaal **${cur}** stap(pen) omlaag (laagste rang: **${ranks[0].name}**). Gebruik /ontslagen als je diegene eruit wilt zetten.`);
      }

      const newRole = rankRole(i, idx);
      const lc = leadChange(i, m, idx);
      if (!(await checkRoles(i, [newRole, rankRole(i, cur), lc?.role]))) return;
      await setRank(i, m, idx, `${up ? 'Promo' : 'Demote'} door ${i.user.tag}: ${reden}`);

      const e = up
        ? embed('📈 Promotie', `${user} is gepromoveerd!\n\n**${ranks[cur].name}** ➜ ${newRole}${leadText(lc)}\n**Door:** ${i.user}\n**Reden:** ${reden}`, 0x2ecc71)
        : embed('📉 Degradatie', `${user} is gedegradeerd.\n\n**${ranks[cur].name}** ➜ ${newRole}${leadText(lc)}\n**Door:** ${i.user}\n**Reden:** ${reden}`, 0xe67e22);
      await dm(user, e);
      await announce(i, client, up || !config.channels.demoties ? 'promoties' : 'demoties', e, `${user}`);
      logAction(client, i, up ? '📈 Promotie' : '📉 Degradatie', `${user} ${up ? 'gepromoveerd' : 'gedegradeerd'} van **${ranks[cur].name}** naar **${ranks[idx].name}**.\nReden: ${reden}`);
      scheduleLedenlijst(client, i.guild);
    },
  };
}
commands.push(stepCommand('promo'), stepCommand('demote'));

// ---------- /ranglijst ----------
commands.push({
  level: 'everyone',
  data: new SlashCommandBuilder().setName('ranglijst').setDescription('Toon alle GSF-leden per rang').addStringOption(addZicht),
  async execute(i) {
    await i.deferReply({ ...vis(i) });
    await i.guild.members.fetch();
    const lines = [...ranks].reverse().map((r) => {
      const role = i.guild.roles.cache.get(r.id);
      const list = role ? [...role.members.values()].map((x) => x.toString()) : [];
      return `**${r.name}** (${list.length})\n${list.join(' ') || '—'}`;
    });
    const lead = leadRole(i);
    if (lead) lines.unshift(`**${lead.name} (leiding)** (${lead.members.size})\n${[...lead.members.values()].map((x) => x.toString()).join(' ') || '—'}`);
    return i.editReply({ embeds: [embed('📋 GSF Ranglijst', lines.join('\n\n').slice(0, 4000))] });
  },
});

// Wisselt Actief <-> Non-actief. on = true: Actief erbij, Non-actief eraf (/aanwezig). on = false: andersom (/afwezig).
// true = gelukt of niets te doen.
async function setActief(i, on, reason) {
  const get = (id) => (id ? i.guild.roles.cache.get(id) : null);
  const actief = get(config.actiefRoleId);
  const nonActief = get(config.nonActiefRoleId);
  const give = on ? actief : nonActief;
  const take = on ? nonActief : actief;
  let ok = true;
  try { if (give && !i.member.roles.cache.has(give.id)) await i.member.roles.add(give, reason); } catch { ok = false; }
  try { if (take && i.member.roles.cache.has(take.id)) await i.member.roles.remove(take, reason); } catch { ok = false; }
  return ok;
}

// ---------- /afwezig ----------
commands.push({
  level: 'gang',
  data: new SlashCommandBuilder().setName('afwezig').setDescription('Meld je afwezig')
    .addStringOption((o) => o.setName('reden').setDescription('Reden van afwezigheid').setRequired(true))
    .addStringOption((o) => o.setName('van').setDescription('Vanaf wanneer? (bijv. 12-11-2026)').setRequired(true))
    .addStringOption((o) => o.setName('tot').setDescription('Tot wanneer? (bijv. 15-11-2026)').setRequired(true)),
  async execute(i, client) {
    const reden = i.options.getString('reden');
    const van = i.options.getString('van');
    const tot = i.options.getString('tot');
    db.data.absences.push({ userId: i.user.id, reden, van, tot, date: Date.now() });
    db.setAbsent(i.user.id, { reden, van, tot, date: Date.now(), tag: i.user.username });
    // Geen los embed meer in het kanaal: alleen het ene overzicht-embed wordt bijgewerkt
    await i.deferReply({ flags: E });
    const panelOk = await updateAfwezigPanel(client).then(() => true).catch((err) => { console.error('Afwezig-overzicht bijwerken mislukt:', err.message); return false; });
    await i.editReply({ content: `🏖️ Je bent afwezig gemeld (**${van}** t/m **${tot}**).${panelOk && config.channels.afwezigOverzicht ? ` Het overzicht in <#${config.channels.afwezigOverzicht}> is bijgewerkt.` : ''}` });
    const roleOk = await setActief(i, false, 'Afwezig gemeld');
    if (!roleOk) i.followUp({ content: '⚠️ Je Actief/Non-actief-rol kon niet worden gewisseld (bot-rol staat niet boven die rollen, of de bot mist *Rollen beheren*). Laat dit door een beheerder regelen.', flags: E }).catch(() => {});
    logAction(client, i, '🏖️ Afwezig gemeld', `${i.user} meldt zich afwezig van **${van}** tot **${tot}**.\nReden: ${reden}`);
  },
});

// ---------- /aanwezig (weer aanwezig melden) ----------
commands.push({
  level: 'gang',
  data: new SlashCommandBuilder().setName('aanwezig').setDescription('Meld je weer aanwezig (Actief-rol terug, Non-actief weg)'),
  async execute(i, client) {
    if (!db.removeAbsent(i.user.id)) return deny(i, 'Je staat niet als afwezig gemeld.');
    // Geen los embed meer in het kanaal: alleen het ene overzicht-embed wordt bijgewerkt
    await i.deferReply({ flags: E });
    const panelOk = await updateAfwezigPanel(client).then(() => true).catch((err) => { console.error('Afwezig-overzicht bijwerken mislukt:', err.message); return false; });
    await i.editReply({ content: `✅ Je bent weer aanwezig.${panelOk && config.channels.afwezigOverzicht ? ` Het overzicht in <#${config.channels.afwezigOverzicht}> is bijgewerkt.` : ''}` });
    const roleOk = await setActief(i, true, 'Weer aanwezig gemeld');
    if (!roleOk) i.followUp({ content: '⚠️ Je Actief/Non-actief-rol kon niet worden gewisseld (bot-rol staat niet boven die rollen, of de bot mist *Rollen beheren*). Laat dit door een beheerder regelen.', flags: E }).catch(() => {});
    logAction(client, i, '✅ Weer aanwezig', `${i.user} is weer aanwezig.`);
  },
});

// ---------- /portochange (past ook het porto-bericht in het porto-kanaal aan) ----------
commands.push({
  level: 'staff',
  data: new SlashCommandBuilder().setName('portochange').setDescription('Wijzig de gang porto (past het porto-kanaal aan)')
    .addStringOption((o) => o.setName('frequentie').setDescription('Nieuwe frequentie, bijv. 642').setRequired(true).setMaxLength(20)),
  async execute(i, client) {
    const freq = i.options.getString('frequentie').trim();
    if (!/^[0-9A-Za-z][0-9A-Za-z .,:-]{0,19}$/.test(freq)) return deny(i, 'Ongeldige frequentie. Gebruik alleen cijfers/letters, bijv. `642`.');
    const huidig = db.data.porto?.frequentie;
    if (huidig === freq && db.data.panels.porto) return deny(i, `De porto staat al op **${freq}**.`);

    await i.deferReply({ flags: E });
    const old = db.setPorto(freq);
    try {
      const res = await updatePortoPanel(client);
      if (!res) throw new Error('Geen porto-kanaal ingesteld (channels.porto in config.js).');
    } catch (err) {
      return i.editReply(`⚠️ Frequentie opgeslagen (**${freq}**), maar het porto-bericht kon niet worden bijgewerkt: ${err.message}`);
    }
    await i.editReply(`✅ Porto gewijzigd naar **${freq}** en het porto-kanaal is bijgewerkt.`);
    logAction(client, i, '📻 Porto gewijzigd', `Van **${old ?? 'onbekend'}** naar **${freq}**.`);
  },
});

// ---------- /editmax (max gangleden) ----------
commands.push({
  level: 'management',
  data: new SlashCommandBuilder().setName('editmax').setDescription('Wijzig het maximum aantal gangleden')
    .addIntegerOption((o) => o.setName('aantal').setDescription('Nieuw maximum (0 = onbeperkt)').setRequired(true).setMinValue(0).setMaxValue(999)),
  async execute(i, client) {
    const n = i.options.getInteger('aantal');
    const old = db.setMax(n);
    const fmt = (x) => (x > 0 ? `**${x}**` : '**onbeperkt**');
    await i.reply({ embeds: [embed('👥 Max gangleden', `Van ${fmt(old)} naar ${fmt(n)}.`)] });
    logAction(client, i, '👥 Max gangleden gewijzigd', `Van ${fmt(old)} naar ${fmt(n)}.`);
    scheduleLedenlijst(client, i.guild);
  },
});

module.exports = { commands };
