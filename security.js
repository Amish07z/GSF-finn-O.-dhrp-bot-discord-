// Anti-nuke (uitgebreide versie)
// - Alles komt binnen via de audit-log-event (geen polling): snel genoeg om een aanval midden in de burst te stoppen.
// - Per persoon wordt geteld hoeveel gevaarlijke acties er in een kort tijdvenster gebeuren (en, apart, per uur: "slowburn").
// - Over de limiet = de dader krijgt een straf en alles wat hij/zij deed wordt teruggedraaid:
//   kanalen/rollen terugzetten (met rechten, categorie en leden), bans opheffen, hernoemingen terugzetten, enz.
// - Slachtoffers (gebanned/gekickt/gepruned) krijgen een DM met de serverlink.
// Uitzonderingen: de server-eigenaar, de bot zelf en de whitelist (gebruikers en rollen).
const { Events, AuditLogEvent, PermissionFlagsBits, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { embed, sendToChannel, dm } = require('./utils');

// ---------- stijl van deze bot (teksten die slachtoffers en de leiding te zien krijgen) ----------
const STYLE = {
  dmTitle: '🛡️ GSF is weer veilig',
  dmIntro: `Iemand probeerde **${config.serverName}** te slopen. De aanval is gestopt en alles is teruggedraaid.`,
  dmReason: {
    ban: 'Je was tijdens de aanval gebanned. **Je ban is opgeheven.**',
    kick: 'Je bent tijdens de aanval uit de server gezet.',
    prune: 'Je bent tijdens de aanval uit de server verwijderd (prune).',
  },
  dmBack: 'Je bent weer welkom bij de GSF. Kom terug via de knop hieronder.',
  dmNoInvite: 'Vraag een GSF-lid om een nieuwe uitnodiging.',
  button: 'Terug naar de GSF',
  // DM + log als de anti-nuke rollen bij iemand weghaalt
  roleDmTitle: '🛡️ Anti-Nuke heeft rollen bij je weggehaald',
  roleDm: {
    strip: `De beveiliging van **${config.serverName}** (de Anti-Nuke) zag jouw acties als een aanval en heeft daarom **automatisch al je rollen weggehaald**. Dit is dus niet door een lid van de leiding gedaan.`,
    roleGrant: `Je kreeg een rol met gevaarlijke rechten (zoals beheerder of rollen beheren) tijdens een actie die de Anti-Nuke als aanval zag. De Anti-Nuke heeft die rol **automatisch weggehaald**. Dit is dus niet door een lid van de leiding gedaan.`,
  },
  roleDmHelp: 'Denk je dat dit onterecht is? Neem contact op met de server-eigenaar. Die kan je rollen terugzetten.',
  roleLogTitle: '🧹 Anti-Nuke: rollen weggehaald',
  alertTitle: '🛡️ Anti-Nuke: overtreding gestopt',
  victimsTitle: 'Slachtoffers',
};


// limit = hoeveel acties binnen het tijdvenster mogen. Daarboven = straf. 0 = meteen straf.
const ACTIONS = {
  channelDelete: { label: 'Kanalen verwijderen', limit: 1 },
  channelCreate: { label: 'Kanalen aanmaken', limit: 3 },
  channelRename: { label: 'Kanalen hernoemen', limit: 5 },
  roleDelete: { label: 'Rollen verwijderen', limit: 1 },
  roleCreate: { label: 'Rollen aanmaken', limit: 3 },
  roleRename: { label: 'Rollen hernoemen', limit: 5 },
  ban: { label: 'Leden bannen', limit: 2 },
  kick: { label: 'Leden kicken', limit: 2 },
  prune: { label: 'Leden pruneren', limit: 0 },
  webhook: { label: 'Webhooks aanmaken', limit: 1 },
  botAdd: { label: 'Bots toevoegen', limit: 0 },
  emojiDelete: { label: 'Emoji\'s verwijderen', limit: 3 },
  stickerDelete: { label: 'Stickers verwijderen', limit: 3 },
  permEdit: { label: 'Gevaarlijke rol-permissies geven', limit: 0 },
  roleGrant: { label: 'Gevaarlijke rol aan een lid geven', limit: 0 },
  automod: { label: 'AutoMod-regels aanpassen', limit: 0 },
};
// Deze acties tellen mee voor "slowburn": de langzame aanval die over een uur verspreid wordt
const SLOW = new Set(['ban', 'kick', 'channelDelete', 'roleDelete', 'prune']);
const labelOf = (a) => (a === 'slowburn' ? 'Langzame aanval (te veel acties per uur)' : ACTIONS[a].label);

// Presets voor /antinuke preset: strikt = standaard voor nieuwe installaties, normaal = ruimer
const PRESETS = {
  strikt: { window: 10, slowburn: 8, limits: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, a.limit])) },
  normaal: {
    window: 60, slowburn: 20,
    limits: { channelDelete: 2, channelCreate: 4, channelRename: 10, roleDelete: 2, roleCreate: 4, roleRename: 10, ban: 3, kick: 3, prune: 0, webhook: 2, botAdd: 0, emojiDelete: 5, stickerDelete: 5, permEdit: 2, roleGrant: 2, automod: 1 },
  },
};
const PUNISHMENTS = { ban: 'Bannen', kick: 'Kicken', strip: 'Alle rollen afpakken (wordt onthouden)', timeout: 'Timeout (28 dagen)' };
const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ModerateMembers,
];
const isDangerousPerms = (p) => !!p && DANGEROUS.some((x) => p.has(x, false));

// Instellingen (staan in data.json), ontbrekende waarden worden aangevuld
function cfg() {
  const c = (db.data.antinuke ||= {});
  c.enabled ??= false;
  c.punishment ??= 'ban';
  c.window ??= PRESETS.strikt.window; // seconden
  c.slowburn ??= PRESETS.strikt.slowburn; // destructieve acties per uur
  c.inviteUrl ??= null; // vaste uitnodiging voor slachtoffers (leeg = de bot maakt zelf een link)
  c.limits ||= {};
  for (const k of Object.keys(ACTIONS)) c.limits[k] ??= ACTIONS[k].limit;
  c.whitelist ||= [];
  c.whitelistRoles ||= [...(config.antinukeWhitelistRoleIds || [])];
  for (const id of (config.antinukeWhitelistRoleIds || [])) if (!c.whitelistRoles.includes(id)) c.whitelistRoles.push(id);
  c.stripped ||= {};  // userId -> [rol-ID's] die bij de straf "strip" zijn afgepakt (terug te geven met /antinuke herstel-rollen)
  c.botAdders ||= {}; // botId -> userId die de bot toevoegde
  c.badBots ||= {};   // botId -> { t, why }: bots die genuked hebben, worden bij terugkomst direct gebanned
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = new Map();   // `${userId}:${actie}` -> [{ t, action, undo }]
const slow = new Map();  // userId -> [{ t, action, undo }] (laatste uur, voor slowburn)
const hot = new Map();   // userId -> tot wanneer elke actie meteen als overtreding telt

// Wie telt als vertrouwd? Eigenaar, de bot zelf, de whitelist en whitelist-rollen.
async function trusted(client, guild, userId) {
  const c = cfg();
  if (userId === client.user.id || userId === guild.ownerId || c.whitelist.includes(userId)) return true;
  if (!c.whitelistRoles.length) return false;
  const m = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  return !!m && c.whitelistRoles.some((id) => m.roles.cache.has(id));
}

// Snapshots van verwijderde kanalen/rollen: de delete-event en de audit-entry komen los van elkaar binnen
const snaps = new Map(); // 'ch:ID' | 'role:ID' -> { snap, t }
function putSnap(key, snap) {
  snaps.set(key, { snap, t: Date.now() });
  for (const [k, v] of snaps) if (Date.now() - v.t > 5 * 60 * 1000) snaps.delete(k);
}
async function takeSnap(key) {
  for (let n = 0; n < 30; n++) { // max 3 seconden wachten
    const s = snaps.get(key);
    if (s) { snaps.delete(key); return s.snap; }
    await sleep(100);
  }
  return null;
}
const bits = (v) => { try { return new PermissionsBitField(BigInt(v)); } catch { return null; } };

// Wie is er de laatste tijd uit de server gegaan? Nodig om bij een prune te weten wie er geraakt zijn
// (Discord geeft bij een prune alleen een aantal, geen namen).
const removals = []; // [{ id, t }]
function noteRemoval(id) {
  removals.push({ id, t: Date.now() });
  const cutoff = Date.now() - 5 * 60 * 1000;
  while (removals.length > 5000 || (removals.length && removals[0].t < cutoff)) removals.shift();
}
async function collectPruned(u) {
  const want = u.removed || 0;
  if (!want) return [];
  const since = u.t - 60 * 1000;
  const pick = () => removals.filter((r) => r.t >= since).slice(-want).map((r) => r.id);
  for (let n = 0; n < 10; n++) { // de remove-events kunnen even achterlopen op de audit log
    const got = pick();
    if (got.length >= want) return got;
    await sleep(3000);
  }
  return pick();
}

// Uitnodiging voor de slachtoffers: vaste link uit /antinuke invite, anders maakt de bot er zelf één (7 dagen, onbeperkt gebruik)
let inviteCache = null; // { url, at }
async function getInvite(client, guild) {
  const fixed = cfg().inviteUrl || config.inviteUrl;
  if (fixed) return fixed;
  if (inviteCache && Date.now() - inviteCache.at < 30 * 60 * 1000) return inviteCache.url;
  const me = guild.members.me;
  const candidates = [];
  for (const id of [config.verify?.channelId, config.channels?.welkom, config.channels?.regels]) {
    const ch = id && (guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null));
    if (ch) candidates.push(ch);
  }
  for (const ch of guild.channels.cache.values()) if (ch.isTextBased?.() && !ch.isThread?.() && !candidates.includes(ch)) candidates.push(ch);
  for (const ch of candidates) {
    if (!ch.createInvite || !ch.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite)) continue;
    try {
      const inv = await ch.createInvite({ maxAge: 7 * 24 * 3600, maxUses: 0, unique: true, reason: 'Anti-nuke: uitnodiging voor slachtoffers' });
      inviteCache = { url: inv.url, at: Date.now() };
      return inv.url;
    } catch { /* volgend kanaal proberen */ }
  }
  return null;
}

async function dmVictim(client, userId, kind, invite) {
  try {
    const user = await client.users.fetch(userId);
    const e = embed(STYLE.dmTitle, `${STYLE.dmIntro}\n\n${STYLE.dmReason[kind] || STYLE.dmReason.kick}\n\n${invite ? STYLE.dmBack : STYLE.dmNoInvite}${invite ? `\n${invite}` : ''}`, config.logColor);
    const payload = { embeds: [e] };
    if (invite) payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(STYLE.button).setStyle(ButtonStyle.Link).setURL(invite))];
    await user.send(payload);
    return true;
  } catch { return false; }
}

// Stuurt alle slachtoffers (gebande / gekickte / geprunede leden) een DM met de serverlink
async function notifyVictims(client, guild, victims) {
  const res = { total: victims.size, sent: 0, failed: 0, invite: null };
  if (!victims.size) return res;
  res.invite = await getInvite(client, guild);
  const list = [...victims].filter(([id]) => !guild.members.cache.has(id)); // wie al terug is hoeft geen DM
  for (let n = 0; n < list.length; n += 5) {
    const ok = await Promise.all(list.slice(n, n + 5).map(([id, kind]) => dmVictim(client, id, kind, res.invite)));
    for (const r of ok) r ? res.sent++ : res.failed++;
    await sleep(400);
  }
  return res;
}

// Stuurt een DM naar iedereen in config.antinukeDmIds (valt terug op antinukeAdminIds als die lijst ontbreekt), bij elke anti-nuke-actie.
// withOwner = ook de server-eigenaar (alleen voor de grote overtreding-melding, zoals het al was).
async function dmAdmins(client, guild, payload, withOwner = false) {
  const ids = new Set(config.antinukeDmIds || config.antinukeAdminIds || []);
  if (withOwner && guild?.ownerId) ids.add(guild.ownerId);
  await Promise.all([...ids].map((id) => client.users.fetch(id).then((u) => u.send(payload)).catch(() => {})));
}

// ---------- melding als de anti-nuke rollen bij iemand weghaalt ----------
// Stuurt de persoon een DM met de reden en de weggehaalde rollen, en zet een regel in het anti-nuke-logkanaal
// (config.channels.antinuke, anders het gewone logkanaal). Geeft een korte status terug, bijv. "📩 DM verstuurd".
// Wordt ALLEEN aangeroepen vanuit de anti-nuke zelf (straf "strip" en het terugdraaien van een gevaarlijke rol).
async function notifyRoleRemoval(client, guild, userId, roles, { kind, reason, by }) {
  try {
    if (!roles.length) return null;
    const why = String(reason || '').replace(/^Anti-nuke:\s*/i, '') || 'Onbekend';
    const shown = roles.map((r) => `\`${r.name}\``).join(', ').slice(0, 900); // in een DM werken rol-mentions niet, daarom namen

    const user = await client.users.fetch(userId).catch(() => null);
    const text = `${STYLE.roleDm[kind] || STYLE.roleDm.strip}\n\n**Reden:** ${why}\n**Weggehaald (${roles.length}):** ${shown}\n\n${STYLE.roleDmHelp}`;
    const dmOk = user ? await dm(user, embed(STYLE.roleDmTitle, text, config.logColor)) : false;
    const dmText = dmOk ? '📩 DM verstuurd' : '⚠️ DM niet gelukt (DM\'s staan dicht)';

    const e = embed(STYLE.roleLogTitle, `<@${userId}> (\`${user?.username || userId}\`) is een deel van zijn/haar rollen kwijt door de **Anti-Nuke** (niet door een mod).`, config.color)
      .addFields(
        { name: 'Persoon', value: `<@${userId}>`, inline: true },
        { name: 'Soort', value: kind === 'strip' ? 'Straf: alle rollen afgepakt' : 'Gevaarlijke rol teruggedraaid', inline: true },
        { name: 'DM', value: dmText, inline: true },
        { name: 'Reden', value: why.slice(0, 1000) },
        { name: `Weggehaalde rollen (${roles.length})`, value: roles.map((r) => `<@&${r.id}>`).join(' ').slice(0, 1000) },
      );
    if (by) e.addFields({ name: 'Rol gegeven door', value: `<@${by}>`, inline: true });
    if (kind === 'strip') e.addFields({ name: 'Terugzetten', value: '`/antinuke herstel-rollen` (alleen server-eigenaar)', inline: false });
    await sendToChannel(client, config.channels.antinuke ? 'antinuke' : 'logs', { embeds: [e] });
    await dmAdmins(client, guild, { embeds: [e] });
    return dmText;
  } catch (err) {
    console.error('Anti-nuke rol-melding mislukt:', err.message);
    return null;
  }
}

// ---------- straffen ----------
async function punish(guild, userId, type, reason) {
  try {
    if (type === 'ban') { await guild.members.ban(userId, { reason, deleteMessageSeconds: 0 }); return '🔨 Gebanned'; }
    const m = await guild.members.fetch(userId).catch(() => null);
    if (!m) return '⚠️ Persoon zit niet (meer) in de server';
    if (type === 'kick') { await m.kick(reason); return '👢 Gekickt'; }
    if (type === 'timeout') { await m.timeout(28 * 24 * 3600 * 1000, reason); return '🔇 Timeout 28 dagen'; }
    const me = guild.members.me;
    const roles = m.roles.cache.filter((r) => r.id !== guild.id && !r.managed && r.position < me.roles.highest.position);
    if (roles.size) { cfg().stripped[userId] = roles.map((r) => r.id); db.save(); } // onthouden, zodat een onterechte straf terug te draaien is
    await m.roles.remove(roles, reason);
    const note = await notifyRoleRemoval(guild.client, guild, userId, [...roles.values()], { kind: 'strip', reason });
    return `🧹 ${roles.size} rol(len) afgepakt (terug te geven met /antinuke herstel-rollen)${note ? `\n${note}` : ''}`;
  } catch (err) {
    return `❌ Straf mislukt: ${err.message} (zet de bot-rol **bovenaan** in Serverinstellingen > Rollen)`;
  }
}

// ---------- terugdraaien ----------
async function runUndo(guild, client, u, ctx) {
  switch (u.type) {
    case 'channelDelete': {
      const s = u.data;
      const parent = s.parentId ? (ctx.chMap.get(s.parentId) || (guild.channels.cache.has(s.parentId) ? s.parentId : undefined)) : undefined;
      // rechten die naar een verwijderde rol wijzen: naar de herstelde rol omzetten, of weglaten als die niet meer bestaat
      const overwrites = s.overwrites
        .map((o) => ({ ...o, id: o.type === 0 ? (ctx.roleMap.get(o.id) || o.id) : o.id }))
        .filter((o) => o.type === 1 || o.id === guild.id || guild.roles.cache.has(o.id) || [...ctx.roleMap.values()].includes(o.id));
      const nc = await guild.channels.create({
        name: s.name, type: s.type, topic: s.topic ?? undefined, nsfw: s.nsfw ?? undefined, bitrate: s.bitrate ?? undefined,
        userLimit: s.userLimit ?? undefined, rateLimitPerUser: s.rateLimitPerUser ?? undefined,
        parent, permissionOverwrites: overwrites, position: s.position, reason: 'Anti-nuke: kanaal hersteld',
      });
      if (s.id) ctx.chMap.set(s.id, nc.id);
      return;
    }
    case 'channelCreate': await guild.channels.cache.get(u.id)?.delete('Anti-nuke: aangemaakt kanaal verwijderd'); return;
    case 'channelRename': await guild.channels.cache.get(u.id)?.setName(u.name, 'Anti-nuke: kanaalnaam hersteld'); return;
    case 'roleDelete': {
      const s = u.data;
      const nr = await guild.roles.create({ name: s.name, color: s.color, hoist: s.hoist, mentionable: s.mentionable, permissions: s.permissions, position: s.position, reason: 'Anti-nuke: rol hersteld' });
      if (s.id) ctx.roleMap.set(s.id, nr.id);
      // Leden die de rol hadden krijgen hem terug (op de achtergrond: Discord begrenst dit per seconde)
      const holders = (s.members || []).filter((id) => guild.members.cache.has(id));
      ctx.holders += holders.length;
      (async () => { for (const id of holders) { await guild.members.cache.get(id)?.roles.add(nr, 'Anti-nuke: rol teruggegeven').catch(() => {}); } })();
      return;
    }
    case 'roleCreate': await guild.roles.cache.get(u.id)?.delete('Anti-nuke: aangemaakte rol verwijderd'); return;
    case 'roleRename': await guild.roles.cache.get(u.id)?.setName(u.name, 'Anti-nuke: rolnaam hersteld'); return;
    case 'roleGrant': {
      const m = await guild.members.fetch(u.member).catch(() => null);
      if (!m) return;
      const roles = u.roles.map((id) => m.roles.cache.get(id)).filter(Boolean);
      if (!roles.length) return;
      await m.roles.remove(roles, 'Anti-nuke: gevaarlijke rol weggehaald');
      await notifyRoleRemoval(client, guild, m.id, roles, { kind: 'roleGrant', reason: ACTIONS.roleGrant.label, by: u.by });
      return;
    }
    case 'ban': await guild.members.unban(u.id, 'Anti-nuke: ban teruggedraaid'); ctx.victims.set(u.id, 'ban'); ctx.unbanned++; return;
    case 'kick': ctx.victims.set(u.id, 'kick'); return; // een kick zelf kan niet terug, maar het slachtoffer krijgt een uitnodiging
    case 'prune': for (const id of await collectPruned(u)) ctx.victims.set(id, 'prune'); return;
    case 'webhook': { const w = await client.fetchWebhook(u.id).catch(() => null); await w?.delete('Anti-nuke: webhook verwijderd'); return; }
    case 'permEdit': await guild.roles.cache.get(u.id)?.setPermissions(u.perms, 'Anti-nuke: permissies teruggezet'); return;
    case 'botAdd': await guild.members.kick(u.id, 'Anti-nuke: niet-gewhiteliste bot verwijderd'); return;
    case 'automod':
      if (u.mode === 'create') await guild.autoModerationRules.delete(u.id, 'Anti-nuke: AutoMod-regel verwijderd');
      else if (u.mode === 'update') await guild.autoModerationRules.edit(u.id, { enabled: false, reason: 'Anti-nuke: aangepaste AutoMod-regel uitgezet' });
      return;
    default: return;
  }
}
// Volgorde: eerst rollen, dan categorieën, dan de rest, zodat rechten en categorieën van kanalen weer kloppen
const undoRank = (e) => {
  const t = e.undo?.type;
  if (t === 'roleDelete') return 0;
  if (t === 'channelDelete') return e.undo.data.type === ChannelType.GuildCategory ? 1 : 2;
  return 3;
};
async function undoAll(guild, client, entries, ctx) {
  ctx.roleMap ||= new Map(); ctx.chMap ||= new Map(); ctx.holders ||= 0;
  let ok = 0; let fail = 0;
  for (const e of [...entries].sort((a, b) => undoRank(a) - undoRank(b) || a.t - b.t)) {
    if (!e.undo) continue;
    try { await runUndo(guild, client, e.undo, ctx); ok++; } catch (err) { fail++; console.error('Anti-nuke herstel mislukt:', err.message); }
  }
  return { ok, fail };
}

// ---------- melding ----------
function buildAlert({ userId, user, action, count, limit, winText, punishText, undone, entries, ctx, dm, isBot, adderText }) {
  const e = embed(STYLE.alertTitle, `<@${userId}> ging over de limiet voor **${labelOf(action)}**.`, config.color)
    .addFields(
      { name: isBot ? 'Dader (bot)' : 'Dader', value: `<@${userId}> (\`${user?.username || userId}\`)`, inline: true },
      { name: 'Acties', value: `${count} / max ${limit} (${winText})`, inline: true },
      { name: 'Straf', value: punishText, inline: true },
      { name: 'Teruggedraaid', value: `${undone.ok} gelukt${undone.fail ? `, ${undone.fail} mislukt` : ''} (van ${entries.length} acties)${ctx.holders ? `\n${ctx.holders} leden krijgen hun herstelde rol terug` : ''}` },
    );
  if (adderText) e.addFields({ name: 'Bot toegevoegd door', value: adderText });
  if (ctx.victims.size) {
    const dmText = !dm ? '⏳ DM\'s met de serverlink worden verstuurd...'
      : `${dm.sent} DM's verstuurd${dm.failed ? `, ${dm.failed} mislukt (DM's dicht)` : ''}${dm.invite ? '' : '\n⚠️ Geen uitnodiging kunnen maken: zet er één met `/antinuke invite`'}`;
    e.addFields({ name: STYLE.victimsTitle, value: `${ctx.victims.size} geraakt${ctx.unbanned ? ` • ${ctx.unbanned} geunbanned` : ''}\n${dmText}` });
  }
  return e;
}

async function alert(client, guild, info) {
  const user = await client.users.fetch(info.userId).catch(() => null);
  const opts = { ...info, user };
  const target = config.channels.antinuke ? 'antinuke' : 'logs';
  const msg = await sendToChannel(client, target, { embeds: [buildAlert(opts)] });
  await dmAdmins(client, guild, { embeds: [buildAlert(opts)] }, true); // eigenaar + antinukeDmIds
  return { msg, opts };
}

// ---------- kern: elke gevaarlijke actie komt hier langs ----------
const newCtx = () => ({ victims: new Map(), unbanned: 0, roleMap: new Map(), chMap: new Map(), holders: 0 });

async function handle(client, guild, action, executorId, undo) {
  const c = cfg();
  if (!c.enabled || !executorId) return;
  if (await trusted(client, guild, executorId)) return;
  const now = Date.now();
  const entry = { t: now, action, undo };

  // Is deze persoon al gestraft? Dan alles wat daarna nog gebeurt meteen terugdraaien.
  if ((hot.get(executorId) || 0) > now) {
    const ctx0 = newCtx();
    await undoAll(guild, client, [entry], ctx0);
    await notifyVictims(client, guild, ctx0.victims);
    await dmAdmins(client, guild, { embeds: [embed('🛡️ Anti-Nuke: extra actie teruggedraaid', `<@${executorId}> deed na de straf nog **${labelOf(action)}**. Dit is meteen teruggedraaid.`, config.color)] });
    return;
  }

  const key = `${executorId}:${action}`;
  const arr = (log.get(key) || []).filter((x) => now - x.t < c.window * 1000);
  arr.push(entry);
  log.set(key, arr);
  let slowList = null;
  if (SLOW.has(action)) {
    slowList = (slow.get(executorId) || []).filter((x) => now - x.t < 3600 * 1000);
    slowList.push(entry);
    slow.set(executorId, slowList);
  }
  const fast = arr.length > c.limits[action];
  const slowHit = !!slowList && slowList.length > c.slowburn;
  if (!fast && !slowHit) return;

  const trigger = fast ? action : 'slowburn';
  const count = fast ? arr.length : slowList.length;
  const limit = fast ? c.limits[action] : c.slowburn;
  const winText = fast ? `${c.window}s` : '1 uur';

  // Over de limiet: meteen blokkeren zodat parallelle acties niet dubbel afgehandeld worden
  hot.set(executorId, now + 5 * 60 * 1000);
  const set = new Set();
  for (const [k, v] of log) if (k.startsWith(`${executorId}:`)) { v.filter((x) => now - x.t < c.window * 1000).forEach((x) => set.add(x)); log.delete(k); }
  for (const x of slow.get(executorId) || []) set.add(x);
  slow.delete(executorId);
  const all = [...set].sort((a, b) => a.t - b.t);

  const execUser = await client.users.fetch(executorId).catch(() => null);
  const isBot = !!execUser?.bot;
  const reason = `Anti-nuke: ${count}x ${labelOf(trigger)} in ${winText} (limiet ${limit})`;
  // Een bot houd je niet tegen met kick/strip/timeout: die wordt altijd gebanned
  const punishText = await punish(guild, executorId, isBot ? 'ban' : c.punishment, reason);

  // Bot als dader: onthoud hem (direct bannen bij terugkomst) en straf degene die hem toevoegde
  let adderText = null;
  if (isBot) {
    c.badBots[executorId] = { t: now, why: reason };
    const adder = c.botAdders[executorId];
    if (adder && !(await trusted(client, guild, adder))) adderText = `<@${adder}>: ${await punish(guild, adder, c.punishment, 'Anti-nuke: voegde een bot toe die de server nukete')}`;
    else if (adder) adderText = `<@${adder}> (vrijgesteld, geen straf)`;
    db.save();
  }

  const ctx = newCtx();
  const undone = await undoAll(guild, client, all, ctx);
  // Eerst de melding (zodat de leiding meteen weet wat er aan de hand is), daarna de DM's aan de slachtoffers
  const sent = await alert(client, guild, { userId: executorId, action: trigger, count, limit, winText, punishText, undone, entries: all, ctx, isBot, adderText });
  if (ctx.victims.size) {
    const dm = await notifyVictims(client, guild, ctx.victims);
    await sent.msg?.edit({ embeds: [buildAlert({ ...sent.opts, dm })] }).catch(() => {});
  }
}

// ---------- events koppelen ----------
function init(client) {
  const inGuild = (g) => g && g.id === config.guildId;
  const safe = (fn) => async (...a) => { try { await fn(...a); } catch (err) { console.error('Anti-nuke fout:', err); } };

  // Snapshots van kanalen en rollen op het moment van verwijderen (de audit-entry komt los daarvan binnen)
  client.on(Events.ChannelDelete, safe(async (ch) => {
    if (!inGuild(ch.guild) || !cfg().enabled) return;
    putSnap(`ch:${ch.id}`, {
      id: ch.id, name: ch.name, type: ch.type, topic: ch.topic, nsfw: ch.nsfw, bitrate: ch.bitrate, userLimit: ch.userLimit,
      rateLimitPerUser: ch.rateLimitPerUser, parentId: ch.parentId, position: ch.rawPosition,
      overwrites: ch.permissionOverwrites?.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })) || [],
    });
  }));
  client.on(Events.GuildRoleDelete, safe(async (r) => {
    if (!inGuild(r.guild) || !cfg().enabled) return;
    putSnap(`role:${r.id}`, {
      id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions, position: r.position,
      members: r.members.map((m) => m.id).slice(0, 500),
    });
  }));

  // Wie er uit de server gaat onthouden we kort: bij een prune is dat de lijst met slachtoffers
  client.on(Events.GuildMemberRemove, (m) => { if (inGuild(m.guild) && !m.user?.bot) noteRemoval(m.id); });

  // Alle gevaarlijke acties komen direct binnen via de audit log
  client.on(Events.GuildAuditLogEntryCreate, safe(async (entry, guild) => {
    if (!inGuild(guild)) return;
    const c = cfg();
    const by = entry.executorId;
    const target = entry.targetId;
    const change = (k) => entry.changes.find((x) => x.key === k);

    if (entry.action === AuditLogEvent.BotAdd) { // altijd onthouden wie welke bot toevoegde (ook als de anti-nuke uit staat)
      if (by && target) {
        c.botAdders[target] = by;
        for (const k of Object.keys(c.botAdders).slice(0, Math.max(0, Object.keys(c.botAdders).length - 300))) delete c.botAdders[k];
        db.save();
      }
      if (!c.enabled || c.whitelist.includes(target)) return; // een bot op de whitelist mag toegevoegd worden
      return handle(client, guild, 'botAdd', by, { type: 'botAdd', id: target });
    }
    if (!c.enabled || !by) return;

    switch (entry.action) {
      case AuditLogEvent.ChannelDelete: {
        if (await trusted(client, guild, by)) return;
        const snap = await takeSnap(`ch:${target}`);
        return handle(client, guild, 'channelDelete', by, snap && { type: 'channelDelete', data: snap });
      }
      case AuditLogEvent.ChannelCreate: return handle(client, guild, 'channelCreate', by, { type: 'channelCreate', id: target });
      case AuditLogEvent.ChannelUpdate: {
        const n = change('name');
        if (n && typeof n.old === 'string' && n.old !== n.new) return handle(client, guild, 'channelRename', by, { type: 'channelRename', id: target, name: n.old });
        return;
      }
      case AuditLogEvent.RoleDelete: {
        if (await trusted(client, guild, by)) return;
        const snap = await takeSnap(`role:${target}`);
        return handle(client, guild, 'roleDelete', by, snap && { type: 'roleDelete', data: snap });
      }
      case AuditLogEvent.RoleCreate: return handle(client, guild, 'roleCreate', by, { type: 'roleCreate', id: target });
      case AuditLogEvent.RoleUpdate: {
        const p = change('permissions');
        if (p) {
          const o = bits(p.old); const nw = bits(p.new);
          if (o && nw && DANGEROUS.some((x) => nw.has(x, false) && !o.has(x, false))) await handle(client, guild, 'permEdit', by, { type: 'permEdit', id: target, perms: o });
        }
        const n = change('name');
        if (n && typeof n.old === 'string' && n.old !== n.new) await handle(client, guild, 'roleRename', by, { type: 'roleRename', id: target, name: n.old });
        return;
      }
      case AuditLogEvent.MemberRoleUpdate: {
        const add = change('$add')?.new;
        if (!Array.isArray(add)) return;
        const danger = add.map((r) => r.id).filter((id) => isDangerousPerms(guild.roles.cache.get(id)?.permissions));
        if (danger.length) return handle(client, guild, 'roleGrant', by, { type: 'roleGrant', member: target, roles: danger, by });
        return;
      }
      case AuditLogEvent.MemberBanAdd: return handle(client, guild, 'ban', by, { type: 'ban', id: target });
      case AuditLogEvent.MemberKick: if (target) return handle(client, guild, 'kick', by, { type: 'kick', id: target }); return;
      case AuditLogEvent.MemberPrune: return handle(client, guild, 'prune', by, { type: 'prune', t: entry.createdTimestamp, removed: Number(entry.extra?.removed) || 0 });
      case AuditLogEvent.WebhookCreate: return handle(client, guild, 'webhook', by, { type: 'webhook', id: target });
      case AuditLogEvent.EmojiDelete: return handle(client, guild, 'emojiDelete', by, null);
      case AuditLogEvent.StickerDelete: return handle(client, guild, 'stickerDelete', by, null);
      case AuditLogEvent.AutoModerationRuleCreate: return handle(client, guild, 'automod', by, { type: 'automod', id: target, mode: 'create' });
      case AuditLogEvent.AutoModerationRuleUpdate: return handle(client, guild, 'automod', by, { type: 'automod', id: target, mode: 'update' });
      case AuditLogEvent.AutoModerationRuleDelete: return handle(client, guild, 'automod', by, null);
      default: return;
    }
  }));

  // Een bot die eerder genuked heeft wordt bij terugkomst meteen gebanned
  client.on(Events.GuildMemberAdd, safe(async (m) => {
    if (!inGuild(m.guild) || !m.user.bot || !cfg().enabled) return;
    const c = cfg();
    if (!c.badBots[m.id] || c.whitelist.includes(m.id)) return;
    await m.ban({ reason: 'Anti-nuke: bekende nuke-bot', deleteMessageSeconds: 0 });
    const known = embed(STYLE.alertTitle, `Bekende nuke-bot <@${m.id}> (\`${m.id}\`) is direct gebanned.`, config.color);
    await sendToChannel(client, config.channels.antinuke ? 'antinuke' : 'logs', { embeds: [known] });
    await dmAdmins(client, m.guild, { embeds: [known] });
  }));
}

module.exports = { init, cfg, ACTIONS, PRESETS, PUNISHMENTS, DANGEROUS, getInvite, dmAdmins, _handle: handle };
