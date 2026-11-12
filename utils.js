const { EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('./config');

const E = MessageFlags.Ephemeral;

// level: 'everyone' | 'gang' | 'staff' | 'lead' | 'management' | 'admin'
// Toegang gaat puur via rollen uit config.js (geen Discord-beheerder nodig).
// management, lead en staff = GSF Lead-rol of hoger (Big Brother en Chief Enforcer tellen ook). Inwoners hebben hier geen toegang toe.
// admin = server-eigenaar of ID's in config.antinukeAdminIds.
const LEVEL_NAMES = { gang: 'GSF-lid (GSF-rol of hoger)', staff: 'Staff (GSF Lead of hoger)', lead: 'GSF Lead of hoger', management: 'Management (GSF Lead of hoger)', admin: 'Server-eigenaar' };
const levelName = (level) => LEVEL_NAMES[level] || level;

function hasLevel(member, level) {
  if (!level || level === 'everyone') return true;
  if (member.guild.ownerId === member.id) return true;
  if (level === 'admin') return (config.antinukeAdminIds || []).includes(member.id);
  if ((config.antinukeAdminIds || []).includes(member.id)) return true;
  const has = (ids) => ids.some((id) => id && member.roles.cache.has(id));
  const isLead = has(config.managementRoleIds) || has([config.leadRoleId]);
  if (level === 'management' || level === 'lead') return isLead;
  if (level === 'staff') return isLead || has(config.staffRoleIds);
  // gang = iedereen met de GSF-rol (of een rang / leiding / staff)
  if (level === 'gang') return isLead || has(config.staffRoleIds) || has([config.gangRoleId]) || has(config.ranks.map((r) => r.id));
  return false;
}

function embed(title, description, color = config.color) {
  const e = new EmbedBuilder().setColor(color).setTimestamp().setFooter({ text: config.footerText });
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

async function sendToChannel(client, key, payload) {
  const id = config.channels[key];
  if (!id) return null;
  const ch = client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null);
  if (!ch) return null;
  return ch.send(payload).catch(() => null);
}

// ---- Log in de stijl van GSF Bot: titel, omschrijving, avatar rechts, velden Gebruiker / Kanaal / Datum ----
const dateNL = (d = new Date()) => d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Amsterdam' });

function logEmbed(i, title, description) {
  const u = i.user;
  return new EmbedBuilder()
    .setColor(config.logColor)
    .setTitle(title)
    .setDescription(description)
    .setThumbnail(u.displayAvatarURL())
    .addFields(
      { name: 'Gebruiker', value: `${u} (\`${u.username}\`)`, inline: true },
      { name: 'Kanaal', value: `<#${i.channelId}>`, inline: true },
      { name: 'Datum', value: dateNL(), inline: true },
    )
    .setFooter({ text: config.footerText })
    .setTimestamp();
}
// i = de interaction van degene die de actie uitvoerde
const logAction = (client, i, title, description) => sendToChannel(client, 'logs', { embeds: [logEmbed(i, title, description)] });

// ---- Bijnaam met 𝕲𝕾𝕱 | ervoor ----
const prefixCore = () => config.namePrefix.trim(); // "𝕲𝕾𝕱 |"
const allPrefixes = () => [prefixCore(), ...(config.oldNamePrefixes || []).map((p) => p.trim())].filter(Boolean);
const hasPrefix = (name) => allPrefixes().some((p) => name.startsWith(p));
const stripPrefix = (name) => { const p = allPrefixes().find((x) => name.startsWith(x)); return p ? name.slice(p.length).trimStart() : name; };

// Past de bijnaam aan. Geeft true terug als gelukt (of niets te doen), false als de bot het niet mag.
async function setGangNick(member, on, reason) {
  try {
    if (!member.manageable) return false;
    if (on) {
      const base = stripPrefix(member.displayName);
      let nick = config.namePrefix;
      for (const ch of base) { if ((nick + ch).length > 32) break; nick += ch; } // max 32 tekens
      if (member.nickname === nick) return true;
      await member.setNickname(nick, reason);
    } else {
      if (!member.nickname || !hasPrefix(member.nickname)) return true;
      const rest = stripPrefix(member.nickname);
      const same = !rest || rest === member.user.globalName || rest === member.user.username;
      await member.setNickname(same ? null : rest, reason);
    }
    return true;
  } catch { return false; }
}

// Plaatst in het ingestelde kanaal, anders publiek in het huidige kanaal
async function announce(i, client, key, emb, content) {
  const id = config.channels[key];
  if (id) {
    const msg = await sendToChannel(client, key, { content, embeds: [emb] });
    if (msg) return i.reply({ content: `✅ Geplaatst in <#${id}>.`, flags: E });
  }
  return i.reply({ content, embeds: [emb] });
}

// Onthoudt wie net een moderatie-DM kreeg, zodat notify.js niet dubbel meldt
const dmTimes = new Map();
const markDm = (id) => { dmTimes.set(id, Date.now()); if (dmTimes.size > 500) for (const [k, t] of dmTimes) if (Date.now() - t > 60000) dmTimes.delete(k); };
const recentlyDmed = (id, ms = 20000) => Date.now() - (dmTimes.get(id) || 0) < ms;

// Regel voor in DM's/welkomst: nodig mensen uit voor de backup-server, zodat de bot ze ook na een ban/kick nog kan DM'en
const appealLine = () => (config.appealInviteUrl ? `\n\n📩 **Blijf bereikbaar:** join onze backup-server, dan kunnen we je ook later nog berichten sturen (bv. bij een unban): ${config.appealInviteUrl}` : '');

async function dm(user, emb) {
  markDm(user.id);
  return user.send({ embeds: [emb] }).then(() => true).catch(() => false);
}

// Mag de uitvoerder deze member beïnvloeden (rolhiërarchie)?
function outranks(i, member) {
  if (!member) return true;
  if (i.guild.ownerId === i.user.id) return true;
  return i.member.roles.highest.position > member.roles.highest.position;
}

function canManageRole(guild, role) {
  return !role.managed && role.id !== guild.id && role.position < guild.members.me.roles.highest.position;
}

// ---- Optie "zichtbaarheid" voor info-commando's ----
// Leeg laten = iedereen ziet het antwoord. "Alleen ik" = alleen jij ziet het.
// Gebruik: .addStringOption(addZicht) in de command-definitie en ...vis(i) in reply()/deferReply().
// Gevoelige commando's: .addStringOption(addZichtPrive) en ...vis(i, 'prive') -> leeg laten = alleen jij.
const ZICHT_CHOICES = [{ name: 'Iedereen', value: 'iedereen' }, { name: 'Alleen ik', value: 'prive' }];
const addZicht = (o) => o.setName('zichtbaarheid').setDescription('Wie ziet dit? (leeg laten = iedereen)').setRequired(false).addChoices(...ZICHT_CHOICES);
const addZichtPrive = (o) => o.setName('zichtbaarheid').setDescription('Wie ziet dit? (leeg laten = alleen jij)').setRequired(false).addChoices(...ZICHT_CHOICES);
const vis = (i, standaard = 'iedereen') => ((i.options.getString('zichtbaarheid') || standaard) === 'prive' ? { flags: E } : {});

// ---- Dropdown-hulpjes (autocomplete): wie is er nu gebanned / getimeout? ----
// Autocomplete moet binnen 3 seconden antwoorden, daarom worden bans en leden een tijdje onthouden.
const bansCache = new Map(); // guildId -> { at, list }
async function getBans(guild) {
  const c = bansCache.get(guild.id);
  if (c && Date.now() - c.at < 20000) return c.list;
  const col = await guild.bans.fetch({ limit: 1000, cache: false });
  const list = [...col.values()].map((b) => ({ userId: b.user.id, tag: b.user.tag, reason: b.reason || null }));
  bansCache.set(guild.id, { at: Date.now(), list });
  return list;
}
const invalidateBans = (guild) => bansCache.delete(guild.id);

let membersFetchedAt = 0;
async function getTimedOut(guild) {
  // Eén keer (en daarna elke 10 min) alle leden ophalen; daartussen houdt de GuildMembers-intent de cache bij.
  if (Date.now() - membersFetchedAt > 10 * 60 * 1000) {
    membersFetchedAt = Date.now();
    await guild.members.fetch().catch(() => {});
  }
  return [...guild.members.cache.values()]
    .filter((m) => m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > Date.now())
    .sort((a, b) => a.communicationDisabledUntilTimestamp - b.communicationDisabledUntilTimestamp);
}

// Korte tekst voor in een dropdown (max 100 tekens)
const fmtLeft = (ms) => {
  const m = Math.max(1, Math.ceil(ms / 60000));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} u ${m % 60} min`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} u`;
};
const idFromInput = (s) => { const id = String(s || '').trim().replace(/[<@!>]/g, ''); return /^\d{15,25}$/.test(id) ? id : null; };

module.exports = { getBans, invalidateBans, getTimedOut, fmtLeft, idFromInput, addZicht, addZichtPrive, vis, E, hasLevel, levelName, embed, sendToChannel, logAction, logEmbed, dateNL, setGangNick, stripPrefix, announce, appealLine, dm, markDm, recentlyDmed, outranks, canManageRole };
