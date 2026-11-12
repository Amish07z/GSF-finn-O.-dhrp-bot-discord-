// Prefix-commando's (! en ?): ban, unban, kick, timeout/mute, untimeout/unmute, purge, slowmode
const { PermissionFlagsBits } = require('discord.js');
const config = require('./config');
const { hasLevel, levelName, embed, invalidateBans, markDm } = require('./utils');

const PREFIXES = ['!', '?'];
const NO_REASON = 'Geen reden opgegeven';
const MAX_TIMEOUT_MIN = 40320; // Discord-limiet: 28 dagen

// Aliassen -> hoofdcommando
const ALIAS = { mute: 'timeout', unmute: 'untimeout', 'un-timeout': 'untimeout' };
const COMMANDS = ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'purge', 'slowmode'];
const LEVEL = { ban: 'management', unban: 'management' }; // rest = staff
const USAGE = {
  ban: '@user reden',
  unban: '<id of @user> reden',
  kick: '@user reden',
  timeout: '@user <minuten> reden   (ook 30m / 2u / 1d)',
  untimeout: '@user reden',
  purge: '<1-100> of all',
  slowmode: '<0-21600>',
};

const ID_RE = /^\d{15,22}$/;
const idFrom = (s) => (s ? s.match(/^<@!?(\d{15,22})>$/)?.[1] || (ID_RE.test(s) ? s : null) : null);

// "30" / "30m" / "2u" / "2h" / "1d" -> minuten (of null)
function parseMinutes(s) {
  const m = /^(\d+)\s*(m|min|u|h|uur|d|dag)?$/i.exec(s || '');
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  return unit.startsWith('m') ? n : unit === 'd' || unit === 'dag' ? n * 1440 : n * 60;
}

// Eerst de cache (direct), pas daarna Discord (alleen als het lid niet in de cache staat)
const getMember = (guild, id) => guild.members.cache.get(id) || guild.members.fetch(id).catch(() => null);

// DM mag de actie nooit langer dan 1,5s ophouden
const dmQuick = (user, emb) => (markDm(user.id), Promise.race([
  user.send({ embeds: [emb] }).catch(() => {}),
  new Promise((r) => setTimeout(r, 1500)),
]));

const sendLog = (client, title, text) => {
  const id = config.channels?.logs;
  const ch = id && (client.channels.cache.get(id) || null);
  (ch ? Promise.resolve(ch) : id ? client.channels.fetch(id).catch(() => null) : Promise.resolve(null))
    .then((c) => c?.send({ embeds: [embed(title, text)] }))
    .catch(() => {});
};

async function handleMessage(message, client) {
  const content = message.content;
  if (!message.guild || message.author.bot || !content || !PREFIXES.includes(content[0])) return;

  const prefix = content[0];
  const [rawName, ...args] = content.slice(1).trim().split(/\s+/);
  const name = (rawName || '').toLowerCase();
  const cmd = ALIAS[name] || name;
  if (!COMMANDS.includes(cmd)) return;

  const reply = (t) => message.reply({ content: t, allowedMentions: { repliedUser: false } }).catch(() => {});
  const fail = (t) => reply(`❌ ${t}`);
  const usage = () => fail(`Gebruik: \`${prefix}${name} ${USAGE[cmd]}\``);

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;
  const level = LEVEL[cmd] || 'staff';
  if (!hasLevel(member, level)) return reply(`⛔ Geen toegang. Vereist: **${levelName(level)}**.`);

  try {
    // ---------- unban ----------
    if (cmd === 'unban') {
      const id = idFrom(args[0]);
      if (!id) return usage();
      const why = args.slice(1).join(' ') || NO_REASON;
      await message.guild.members.unban(id, `${message.author.tag}: ${why}`).catch((e) => { throw new Error(e.code === 10026 ? 'Deze gebruiker is niet gebanned.' : e.message); });
      invalidateBans(message.guild);
      message.reply({ embeds: [embed('✅ Unban', `<@${id}> (\`${id}\`) is geunbanned.\n**Reden:** ${why}`, 0x2ecc71)], allowedMentions: { repliedUser: false } }).catch(() => {});
      sendLog(client, 'Prefix unban', `**Uitvoerder:** ${message.author}\n**Lid:** <@${id}>\n**Reden:** ${why}`);
      return;
    }

    // ---------- ban / kick / timeout / untimeout ----------
    if (['ban', 'kick', 'timeout', 'untimeout'].includes(cmd)) {
      const id = idFrom(args[0]);
      if (!id) return usage();
      const target = await getMember(message.guild, id);
      if (!target) return fail('Lid niet gevonden.');
      if (message.guild.ownerId !== message.author.id && member.roles.highest.position <= target.roles.highest.position) {
        return fail('Je kunt dit lid niet modereren vanwege de rolhiërarchie.');
      }

      let mins = null;
      if (cmd === 'timeout') {
        mins = parseMinutes(args[1]);
        if (!mins || mins < 1 || mins > MAX_TIMEOUT_MIN) return usage();
      }
      const why = (cmd === 'timeout' ? args.slice(2) : args.slice(1)).join(' ') || NO_REASON;
      const auditReason = `${message.author.tag}: ${why}`;
      let title; let text; let color;

      if (cmd === 'ban') {
        if (!target.bannable) return fail('De bot kan dit lid niet bannen. Controleer de botrol en permissies.');
        await dmQuick(target.user, embed('🔨 Je bent gebanned', `**Server:** ${config.serverName}\n**Reden:** ${why}`));
        await target.ban({ reason: auditReason });
        title = '🔨 Ban'; text = `${target.user.tag} gebanned. Reden: ${why}`;
      } else if (cmd === 'kick') {
        if (!target.kickable) return fail('De bot kan dit lid niet kicken.');
        await dmQuick(target.user, embed('👢 Je bent gekickt', `**Server:** ${config.serverName}\n**Reden:** ${why}`));
        await target.kick(auditReason);
        title = '👢 Kick'; text = `${target.user.tag} gekickt. Reden: ${why}`;
      } else if (cmd === 'timeout') {
        if (!target.moderatable) return fail('De bot kan dit lid geen timeout geven.');
        await target.timeout(mins * 60000, auditReason);
        title = '🔇 Timeout'; text = `${target.user.tag} timeout: ${mins} minuten. Reden: ${why}`;
      } else {
        if (!target.isCommunicationDisabled()) return fail('Dit lid heeft geen timeout.');
        if (!target.moderatable) return fail('De bot kan de timeout van dit lid niet weghalen.');
        await target.timeout(null, auditReason);
        title = '🔊 Timeout opgeheven'; text = `${target.user.tag} heeft weer toegang.${why !== NO_REASON ? ` Reden: ${why}` : ''}`; color = 0x2ecc71;
      }

      message.reply({ embeds: [embed(title, text, color)], allowedMentions: { repliedUser: false } }).catch(() => {});
      sendLog(client, `Prefix ${cmd}`, `**Uitvoerder:** ${message.author}\n**Lid:** ${target.user.tag}\n**Reden:** ${why}`);
      return;
    }

    // ---------- purge ----------
    if (cmd === 'purge') {
      if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return fail('Je mist Manage Messages.');
      const all = ['all', 'wipe'].includes(args[0]?.toLowerCase());
      const n = Number(args[0]);
      if (!all && (!Number.isInteger(n) || n < 1 || n > 100)) return usage();

      message.delete().catch(() => {});
      const isFresh = (m) => Date.now() - m.createdTimestamp < 1209600000; // bulkDelete kan alleen < 14 dagen
      let removed = 0;
      if (!all) {
        const batch = await message.channel.messages.fetch({ limit: n });
        const fresh = batch.filter(isFresh);
        if (fresh.size) removed = (await message.channel.bulkDelete(fresh, true)).size;
      } else {
        let before;
        for (let p = 0; p < 1000; p++) {
          const batch = await message.channel.messages.fetch({ limit: 100, before });
          if (!batch.size) break;
          before = batch.last().id;
          const fresh = batch.filter(isFresh);
          if (fresh.size) removed += (await message.channel.bulkDelete(fresh, true).catch(() => new Map())).size;
          for (const m of batch.filter((x) => !isFresh(x)).values()) if (await m.delete().then(() => true).catch(() => false)) removed++;
          if (batch.size < 100) break;
        }
      }
      const sent = await message.channel.send({ embeds: [embed('🧹 Purge', `${removed} berichten verwijderd.`)] });
      setTimeout(() => sent.delete().catch(() => {}), 5000);
      return;
    }

    // ---------- slowmode ----------
    if (cmd === 'slowmode') {
      if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return fail('Je mist Manage Channels.');
      const secs = Number(args[0]);
      if (!Number.isInteger(secs) || secs < 0 || secs > 21600) return usage();
      await message.channel.setRateLimitPerUser(secs, `Door ${message.author.tag}`);
      return message.reply({ embeds: [embed('🐌 Slowmode', secs ? `Slowmode staat op **${secs}s**.` : 'Slowmode is uitgeschakeld.')], allowedMentions: { repliedUser: false } });
    }
  } catch (e) {
    console.error('Prefix command error:', e);
    return fail(`Uitvoering mislukt: ${e.message}`);
  }
}

module.exports = { handleMessage };
