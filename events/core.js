const { Events, ActivityType } = require('discord.js');
const config = require('../config');
const { register } = require('../loader');
const { hasLevel, levelName, embed, E, sendToChannel, dm } = require('../utils');
const db = require('../db');
const { updateBlacklistPanel, buildWelkom, updateAfwezigPanel, scheduleLedenlijst, isLedenRole } = require('../panels');
const { handleMessage } = require('../prefix');

let listeners = [];
function on(client, event, fn) { (event === Events.ClientReady ? client.once(event, fn) : client.on(event, fn)); listeners.push([event, fn]); }
function init(client) {
on(client, Events.ClientReady, async (c) => {
  console.log(`✅ Ingelogd als ${c.user.tag}`);
  c.user.setActivity(config.serverName, { type: ActivityType.Watching });
  try {
    // Eenmalig automatisch resetten: wist oude rechten-instellingen (Serverinstellingen > Integraties) die commands voor Inwoners verbergen.
    const firstReset = !db.data.commandsVisibleReset;
    const n = await register(client.commands, { reset: !!config.resetCommands || firstReset });
    if (firstReset) { db.data.commandsVisibleReset = true; db.save(); console.log('✅ Commands eenmalig gereset: nu zichtbaar voor iedereen.'); }
    console.log(`✅ ${n} slash commands geregistreerd.`);
  } catch (e) {
    console.error('❌ Registreren van commands mislukt (klopt CLIENT_ID/GUILD_ID? Is de bot in de server?):', e.message);
  }

  // Afwezigheid-overzicht: plaatst/herstelt het bericht in het non-actief-kanaal (zonder commando)
  updateAfwezigPanel(c).catch((e) => console.error('Afwezig-overzicht plaatsen mislukt:', e.message));

  // Tijdelijke blacklists (/blacklist met duur) laten verlopen
  const expire = async () => {
    const expired = db.takeExpiredBlacklist();
    // Lijst bijwerken als er iets verliep, of als er tijdelijke blacklists staan (resterende tijd loopt af)
    if (expired.length) updateBlacklistPanel(c).catch(() => {});
    for (const id of expired) {
      if (config.blacklistRoleId) {
        const m = await c.guilds.cache.get(config.guildId)?.members.fetch(id).catch(() => null);
        if (m) await m.roles.remove(config.blacklistRoleId, 'Blacklist verlopen').catch(() => {});
      }
      const u = await c.users.fetch(id).catch(() => null);
      if (u && !u.bot) dm(u, embed('✅ Je blacklist is verlopen', `**Server:** ${config.serverName}\n\nJe staat niet meer op de blacklist. Je kunt weer tickets openen en solliciteren.`, 0x2ecc71));
      sendToChannel(c, 'logs', { embeds: [embed('✅ Blacklist verlopen', `<@${id}> staat niet meer op de blacklist.`, config.logColor)] });
    }
  };
  expire();
  setInterval(expire, 15 * 1000); // elke 15s: verloopt een blacklist, dan direct bijwerken
  setInterval(() => { if (db.getBlacklist().some((b) => b.until)) updateBlacklistPanel(c).catch(() => {}); }, 10 * 60 * 1000); // resterende tijd verversen

  // Ledenlijst/status meteen bijwerken bij opstarten (rollen kunnen veranderd zijn terwijl de bot uit stond) + vangnet elke 15 min
  const guild = c.guilds.cache.get(config.guildId);
  if (guild) {
    scheduleLedenlijst(c, guild, 5000);
    setInterval(() => scheduleLedenlijst(c, guild, 0), 15 * 60 * 1000);
  }
});

// Nieuwe member: welkom-embed (Inwoner-rol volgt na het accepteren van de regels)
on(client, Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== config.guildId) return;

  // Inwoner-rol wordt NIET meer automatisch gegeven: dat gebeurt pas na de knop in het regels-kanaal (verify.js)

  try {
    if (!config.channels.welkom) return;
    const ch = await client.channels.fetch(config.channels.welkom).catch(() => null);
    if (ch) await ch.send({ embeds: [buildWelkom(member)] });
  } catch (err) { console.error('Welkom-bericht mislukt:', err.message); }
});

// Lid verlaat de server: afwezigheid wissen zodat het overzicht klopt
on(client, Events.GuildMemberRemove, (member) => {
  if (member.guild.id !== config.guildId) return;
  if (db.removeAbsent(member.id)) updateAfwezigPanel(client).catch(() => {});
});

// ===== Realtime panelen: ledenlijst + sollicitatie-status werken zichzelf bij (geen /refresh nodig) =====
// Rol erbij/eraf (ook handmatig in Discord), lid vertrekt, of een rang-rol wordt hernoemd/verwijderd.
on(client, Events.GuildMemberUpdate, (oldM, newM) => {
  if (newM.guild.id !== config.guildId) return;
  if (oldM.partial) return scheduleLedenlijst(client, newM.guild); // oude rollen onbekend: voor de zekerheid bijwerken
  const a = [...oldM.roles.cache.keys()].filter(isLedenRole).sort().join();
  const b = [...newM.roles.cache.keys()].filter(isLedenRole).sort().join();
  if (a !== b) scheduleLedenlijst(client, newM.guild);
});
on(client, Events.GuildMemberRemove, (member) => {
  if (member.guild.id !== config.guildId) return;
  scheduleLedenlijst(client, member.guild);
});
on(client, Events.GuildRoleUpdate, (oldR, newR) => {
  if (newR.guild.id === config.guildId && isLedenRole(newR.id) && oldR.name !== newR.name) scheduleLedenlijst(client, newR.guild);
});
on(client, Events.GuildRoleDelete, (role) => {
  if (role.guild.id === config.guildId && isLedenRole(role.id)) scheduleLedenlijst(client, role.guild);
});

on(client, Events.MessageCreate, (message) => handleMessage(message, client));

on(client, Events.InteractionCreate, async (i) => {
  try {
    if (!i.inGuild()) return;
    if (i.isAutocomplete()) {
      const c = client.commands.get(i.commandName);
      if (c?.autocomplete) await c.autocomplete(i);
      return;
    }
    if (i.isChatInputCommand()) {
      const cmd = client.commands.get(i.commandName);
      if (!cmd) return;
      if (!hasLevel(i.member, cmd.level)) {
        return i.reply({ embeds: [embed('⛔ Geen toegang', `Je hebt geen permissie om \`/${i.commandName}\` te gebruiken.\nVereist: **${levelName(cmd.level)}**.`)], flags: E });
      }
      return await cmd.execute(i, client);
    }
    if (i.isButton() || i.isStringSelectMenu() || i.isModalSubmit()) {
      const h = client.components.find((c) => c.match(i.customId));
      if (h) return await h.execute(i, client);
    }
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ Er ging iets mis bij het uitvoeren hiervan. Check de console.', flags: E };
    if (i.replied || i.deferred) i.followUp(msg).catch(() => {});
    else i.reply(msg).catch(() => {});
  }
});

}
function destroy(client) { for (const [event, fn] of listeners) client.removeListener(event, fn); listeners = []; }
module.exports = { init, destroy };
