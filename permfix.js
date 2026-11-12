// Zorgt dat iedereen in alle kanalen/categorieën waar de Inwoner-rol kan typen ook bot-commands mag gebruiken
// ("Gebruik applicatiecommando's"). Verwijdert ❌-overschrijvingen (op rollen én losse leden) en zet zo nodig ✅ op Inwoner.
// Kanalen waar Inwoners niets zien of niet kunnen typen (tickets, staff, ...) worden NIET aangepast.
// De bot heeft hiervoor "Kanalen beheren" (en "Rollen beheren" voor de server-brede rol-permissie) nodig.
const { Events, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('./config');

const FLAG = P.UseApplicationCommands;
const TYPES = [
  ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice,
  ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildCategory,
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = new Set();

const inwonerRole = (guild) => (config.inwonerRoleId
  ? guild.roles.cache.get(config.inwonerRoleId)
  : guild.roles.cache.find((r) => r.name.toLowerCase() === 'inwoner')) || guild.roles.everyone;

// Server-brede rol-permissie: minstens @everyone of Inwoner moet "Gebruik applicatiecommando's" hebben
async function fixGuildPerm(guild) {
  const role = inwonerRole(guild);
  if (guild.roles.everyone.permissions.has(FLAG) || role.permissions.has(FLAG)) return false;
  await role.setPermissions(role.permissions.add(FLAG), 'Commands voor iedereen');
  return true;
}

// Rollen waarvoor "Gebruik applicatiecommando's" overal aan moet staan: Inwoner en @everyone
const targetRoles = (guild) => [...new Set([inwonerRole(guild), guild.roles.everyone])];

// Geeft aantal wijzigingen in dit kanaal terug
async function fixChannel(ch) {
  if (!TYPES.includes(ch.type) || busy.has(ch.id)) return 0;
  const roles = targetRoles(ch.guild);
  // Alleen kanalen die Inwoners/everyone kunnen zien (privé staff-kanalen blijven dicht). Typen is niet nodig om een commando te gebruiken.
  if (!roles.some((r) => ch.permissionsFor(r)?.has(P.ViewChannel))) return 0;

  busy.add(ch.id);
  let changes = 0;
  try {
    // ❌ op commands weghalen (rollen én losse leden)
    for (const ow of [...ch.permissionOverwrites.cache.values()]) {
      if (!ow.deny.has(FLAG)) continue;
      await ch.permissionOverwrites.edit(ow.id, { UseApplicationCommands: null }, { type: ow.type, reason: 'Commands voor iedereen' });
      changes++; await sleep(400);
    }
    // ✅ zetten voor elke rol die dit kanaal ziet
    for (const role of roles) {
      if (!ch.permissionsFor(role)?.has(P.ViewChannel)) continue;
      if (!ch.permissionsFor(role).has(FLAG)) {
        await ch.permissionOverwrites.edit(role.id, { UseApplicationCommands: true }, { reason: 'Commands voor iedereen' });
        changes++; await sleep(400);
      }
    }
  } catch (err) {
    console.error(`Permissies fixen mislukt in #${ch.name} (mist de bot "Kanalen beheren" of staat zijn rol te laag?):`, err.message);
  } finally {
    // pas vrijgeven na de gateway-events van onze eigen wijziging, anders loopt ChannelUpdate in een lus
    setTimeout(() => busy.delete(ch.id), 3000);
  }
  return changes;
}

async function fixAll(guild) {
  let total = 0;
  try { if (await fixGuildPerm(guild)) total++; } catch (err) { console.error('Server-brede commands-permissie zetten mislukt:', err.message); }
  const chans = await guild.channels.fetch();
  for (const ch of chans.values()) { if (ch) total += await fixChannel(ch); }
  return total;
}

function init(client) {
  client.once(Events.ClientReady, async (c) => {
    const guild = await c.guilds.fetch(config.guildId).catch(() => null);
    if (!guild) return;
    await guild.roles.fetch().catch(() => {});
    const n = await fixAll(guild);
    console.log(n ? `✅ Commands-permissie aangepast op ${n} plek(ken).` : '✅ Commands-permissie overal al in orde.');
  });
  // Nieuwe/aangepaste kanalen en rollen meteen goedzetten
  client.on(Events.ChannelCreate, (ch) => { if (ch.guildId === config.guildId) setTimeout(() => fixChannel(ch).catch(() => {}), 1500); });
  client.on(Events.ChannelUpdate, (_o, ch) => { if (ch.guildId === config.guildId) fixChannel(ch).catch(() => {}); });
  client.on(Events.GuildRoleUpdate, (_o, r) => { if (r.guild.id === config.guildId && r.id === inwonerRole(r.guild).id) fixGuildPerm(r.guild).catch(() => {}); });
}

module.exports = { init, fixAll };
