// /antinuke ... : instellingen van de anti-nuke. Alleen de server-eigenaar (of ID's in config.antinukeAdminIds).
const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { E, embed, dm } = require('../utils');
const { cfg, ACTIONS, PRESETS, PUNISHMENTS, dmAdmins } = require('../security');

const commands = [];
const actieChoices = Object.entries(ACTIONS).map(([value, a]) => ({ name: a.label, value }));
const straffChoices = Object.entries(PUNISHMENTS).map(([value, name]) => ({ name, value }));

const allowed = (i) => i.user.id === i.guild.ownerId || (config.antinukeAdminIds || []).includes(i.user.id);

function statusEmbed() {
  const c = cfg();
  const limits = Object.entries(ACTIONS).map(([k, a]) => `• ${a.label}: **${c.limits[k]}**`).join('\n');
  const wl = c.whitelist.length ? c.whitelist.map((id) => `<@${id}> (\`${id}\`)`).join('\n') : '*niemand*';
  const roleWl = (c.whitelistRoles || []).length ? c.whitelistRoles.map((id) => `<@&${id}> (\`${id}\`)`).join('\n') : '*geen rollen*';
  return embed('🛡️ Anti-Nuke', null, config.logColor).addFields(
    { name: 'Status', value: c.enabled ? '🟢 Aan' : '🔴 Uit', inline: true },
    { name: 'Straf', value: PUNISHMENTS[c.punishment], inline: true },
    { name: 'Tijdvenster', value: `${c.window} seconden`, inline: true },
    { name: 'Langzame aanval (slowburn)', value: `max **${c.slowburn}** destructieve acties per uur (bans, kicks, verwijderde kanalen/rollen, prunes)`, inline: true },
    { name: 'Uitnodiging voor slachtoffers', value: c.inviteUrl || config.inviteUrl || '*automatisch (de bot maakt zelf een link van 7 dagen)*' },
    { name: 'Limieten (max acties per tijdvenster)', value: limits },
    { name: 'Whitelist • Gebruikers', value: wl.slice(0,1024) },
    { name: 'Whitelist • Rollen', value: roleWl.slice(0,1024) },
    { name: 'Bekende nuke-bots', value: Object.keys(c.badBots).length ? Object.keys(c.badBots).map((id) => `\`${id}\``).join(', ').slice(0, 1024) : '*geen*', inline: true },
    { name: 'Afgepakte rollen onthouden', value: `${Object.keys(c.stripped).length} persoon/personen (zie /antinuke herstel-rollen)`, inline: true },
  );
}

commands.push({
  level: 'admin',
  data: new SlashCommandBuilder().setName('antinuke').setDescription('Anti-nuke beveiliging instellen (alleen server-eigenaar)')
    .addSubcommand((s) => s.setName('status').setDescription('Toon alle anti-nuke instellingen'))
    .addSubcommand((s) => s.setName('aan').setDescription('Zet de anti-nuke aan'))
    .addSubcommand((s) => s.setName('uit').setDescription('Zet de anti-nuke uit'))
    .addSubcommand((s) => s.setName('setlimit').setDescription('Stel in hoeveel acties iemand binnen het tijdvenster mag doen')
      .addStringOption((o) => o.setName('actie').setDescription('Welke actie').setRequired(true).addChoices(...actieChoices))
      .addIntegerOption((o) => o.setName('aantal').setDescription('Max aantal (0 = meteen straf)').setRequired(true).setMinValue(0).setMaxValue(50)))
    .addSubcommand((s) => s.setName('punishment').setDescription('Kies de straf bij een overtreding')
      .addStringOption((o) => o.setName('straf').setDescription('Straf').setRequired(true).addChoices(...straffChoices)))
    .addSubcommand((s) => s.setName('window').setDescription('Tijdvenster waarin de acties geteld worden')
      .addIntegerOption((o) => o.setName('seconden').setDescription('Seconden (5 t/m 600)').setRequired(true).setMinValue(5).setMaxValue(600)))
    .addSubcommand((s) => s.setName('preset').setDescription('Zet alle limieten, tijdvenster en slowburn in één keer')
      .addStringOption((o) => o.setName('niveau').setDescription('strikt = standaard voor nieuwe installaties, normaal = ruimer').setRequired(true).addChoices(...Object.keys(PRESETS).map((k) => ({ name: k, value: k })))))
    .addSubcommand((s) => s.setName('slowburn').setDescription('Max destructieve acties per uur (vangt aanvallen die over een uur verspreid worden)')
      .addIntegerOption((o) => o.setName('aantal').setDescription('Aantal per uur (3 t/m 500)').setRequired(true).setMinValue(3).setMaxValue(500)))
    .addSubcommand((s) => s.setName('herstel-rollen').setDescription('Geef afgepakte rollen terug aan iemand die onterecht gestraft is (straf: strip)')
      .addUserOption((o) => o.setName('user').setDescription('Gebruiker').setRequired(true)))
    .addSubcommand((s) => s.setName('bot-vrijgeven').setDescription('Haal een bot van de lijst met bekende nuke-bots af en unban hem')
      .addStringOption((o) => o.setName('bot_id').setDescription('ID van de bot').setRequired(true)))
    .addSubcommand((s) => s.setName('invite').setDescription('Vaste serverlink die slachtoffers van een nuke per DM krijgen (leeg = automatisch)')
      .addStringOption((o) => o.setName('link').setDescription('Bijv. https://discord.gg/jouwlink — leeg laten om terug te gaan naar automatisch')))
    .addSubcommand((s) => s.setName('whitelist-add').setDescription('Geef iemand vrijstelling van de anti-nuke (ook voor andere bots)')
      .addUserOption((o) => o.setName('user').setDescription('Gebruiker of bot').setRequired(true)))
    .addSubcommand((s) => s.setName('whitelist-remove').setDescription('Haal iemand van de whitelist')
      .addUserOption((o) => o.setName('user').setDescription('Gebruiker of bot').setRequired(true))),
  async execute(i) {
    if (!allowed(i)) return i.reply({ content: '⛔ Alleen de server-eigenaar kan de anti-nuke aanpassen.', flags: E });
    const c = cfg();
    const sub = i.options.getSubcommand();
    // Elke wijziging via /antinuke gaat ook als DM naar config.antinukeAdminIds
    const done = (msg) => {
      db.save();
      dmAdmins(i.client, i.guild, { embeds: [embed('🛡️ Anti-Nuke: instelling gewijzigd', `${i.user} (\`${i.user.username}\`) gebruikte \`/antinuke ${sub}\`\n\n${msg}`, config.logColor)] });
      return i.reply({ content: msg, embeds: [statusEmbed()], flags: E });
    };

    if (sub === 'status') return i.reply({ embeds: [statusEmbed()], flags: E });
    if (sub === 'aan') { c.enabled = true; return done('✅ Anti-nuke staat **aan**.'); }
    if (sub === 'uit') { c.enabled = false; return done('⚠️ Anti-nuke staat **uit**.'); }
    if (sub === 'setlimit') {
      const k = i.options.getString('actie'); const n = i.options.getInteger('aantal');
      c.limits[k] = n; return done(`✅ Limiet voor **${ACTIONS[k].label}** is nu **${n}**.`);
    }
    if (sub === 'punishment') { c.punishment = i.options.getString('straf'); return done(`✅ Straf is nu **${PUNISHMENTS[c.punishment]}**.`); }
    if (sub === 'window') { c.window = i.options.getInteger('seconden'); return done(`✅ Tijdvenster is nu **${c.window} seconden**.`); }
    if (sub === 'preset') {
      const p = PRESETS[i.options.getString('niveau')];
      c.window = p.window; c.slowburn = p.slowburn; Object.assign(c.limits, p.limits);
      return done(`✅ Preset **${i.options.getString('niveau')}** toegepast (tijdvenster ${p.window}s, slowburn ${p.slowburn}/uur).`);
    }
    if (sub === 'slowburn') { c.slowburn = i.options.getInteger('aantal'); return done(`✅ Slowburn staat op **${c.slowburn}** destructieve acties per uur.`); }
    if (sub === 'herstel-rollen') {
      const u = i.options.getUser('user');
      const ids = c.stripped[u.id];
      if (!ids?.length) return i.reply({ content: `Er zijn geen afgepakte rollen onthouden voor ${u}.`, flags: E });
      const m = await i.guild.members.fetch(u.id).catch(() => null);
      if (!m) return i.reply({ content: `${u} zit niet in de server.`, flags: E });
      const top = i.guild.members.me.roles.highest.position;
      const back = ids.filter((id) => { const r = i.guild.roles.cache.get(id); return r && !r.managed && r.position < top; });
      await m.roles.add(back, `Anti-nuke: rollen teruggegeven door ${i.user.tag}`);
      delete c.stripped[u.id];
      const names = back.map((id) => `\`${i.guild.roles.cache.get(id)?.name || id}\``).join(', ').slice(0, 900);
      const dmOk = await dm(u, embed('🛡️ Je rollen zijn teruggegeven', `De Anti-Nuke had je rollen weggehaald, maar die zijn nu **teruggegeven** door ${i.user.tag}.\n\n**Teruggegeven (${back.length}):** ${names || '*geen*'}`, config.logColor));
      return done(`✅ ${back.length} rol(len) teruggegeven aan ${u}${back.length < ids.length ? ` (${ids.length - back.length} bestaan niet meer of staan boven de bot)` : ''}. ${dmOk ? '📩 DM verstuurd.' : '⚠️ DM niet gelukt (DM\'s staan dicht).'}`);
    }
    if (sub === 'bot-vrijgeven') {
      const id = i.options.getString('bot_id').trim();
      if (!/^\d{15,25}$/.test(id)) return i.reply({ content: '⛔ Dat is geen geldig ID.', flags: E });
      const was = !!c.badBots[id]; delete c.badBots[id];
      const unbanned = await i.guild.members.unban(id, `Anti-nuke: vrijgegeven door ${i.user.tag}`).then(() => true).catch(() => false);
      return done(`✅ \`${id}\` ${was ? 'staat niet meer op de lijst met nuke-bots' : 'stond niet op de lijst'}${unbanned ? ' en is geunbanned' : ''}.`);
    }
    if (sub === 'invite') {
      const link = (i.options.getString('link') || '').trim();
      if (!link) { c.inviteUrl = null; return done('✅ Uitnodiging staat op **automatisch**.'); }
      if (!/^https?:\/\/(www\.)?(discord\.gg|discord(app)?\.com\/invite)\/[\w-]+\/?$/i.test(link)) return i.reply({ content: '⛔ Dat is geen geldige Discord-uitnodiging (bijv. `https://discord.gg/jouwlink`).', flags: E });
      c.inviteUrl = link; return done('✅ Uitnodiging voor slachtoffers is ingesteld.');
    }
    if (sub === 'whitelist-add') {
      const u = i.options.getUser('user');
      if (!c.whitelist.includes(u.id)) c.whitelist.push(u.id);
      return done(`✅ ${u} staat op de whitelist.`);
    }
    if (sub === 'whitelist-remove') {
      const u = i.options.getUser('user');
      c.whitelist = c.whitelist.filter((id) => id !== u.id);
      return done(`✅ ${u} staat niet meer op de whitelist.`);
    }
  },
});

module.exports = { commands };
