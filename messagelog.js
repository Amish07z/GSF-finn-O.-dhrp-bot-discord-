// Super uitgebreide logs in het message-logs kanaal (config.channels.messageLogs):
// verwijderde / bewerkte / vastgepinde berichten, bulk-deletes (met transcript), reacties, voice, leden, bans.
//
// Hoe verwijderde berichten toch te zien zijn: de bot bewaart elk bericht in een cache (ook op schijf, dus het
// overleeft herstarts/deploys). Bij verwijderen wordt de inhoud uit de cache gehaald, de audit log geraadpleegd
// (wie verwijderde het?) en worden bijlagen opnieuw geüpload zodat plaatjes niet verdwijnen.
const fs = require('fs');
const path = require('path');
const {
  Events, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AuditLogEvent, PermissionFlagsBits,
} = require('discord.js');
const config = require('./config');

// ---------- instellingen (config.messageLog, alles optioneel) ----------
const DEFAULTS = {
  enabled: true,
  ignoreBots: false,        // andere bots negeren (de bot zelf wordt altijd genegeerd)
  ignoredChannels: [],      // kanaal-ID's die niet gelogd worden
  ignoredCategories: [],    // categorie-ID's
  ignoredUsers: [],         // user-ID's
  saveAttachments: true,    // bijlagen van verwijderde berichten opnieuw uploaden
  cacheSize: 5000,          // aantal berichten in de cache
  events: {
    create: false,          // ELK nieuw bericht loggen (erg druk, standaard uit)
    delete: true, bulkDelete: true, edit: true, pin: true,
    reactions: true, voice: true, members: true, bans: true,
  },
};
const opts = () => {
  const c = config.messageLog || {};
  return { ...DEFAULTS, ...c, events: { ...DEFAULTS.events, ...(c.events || {}) } };
};

const COLORS = {
  delete: 0xef4444, bulk: 0x991b1b, edit: 0xf59e0b, create: 0x22c55e, pin: 0x3b82f6,
  reactAdd: 0x8b5cf6, reactRemove: 0x6b7280, voice: 0x06b6d4, join: 0x22c55e, leave: 0xf97316, ban: 0xdc2626, member: 0x64748b,
};

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const sec = (ms) => Math.floor(ms / 1000);
const ts = (ms, f = 'F') => `<t:${sec(ms)}:${f}>`;
const fullTs = (ms) => `${ts(ms, 'F')} (${ts(ms, 'R')})`;
const snowflakeTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const userLine = (u) => (u ? `<@${u.id}> (\`${u.tag || u.username || u.id}\`)\nID: \`${u.id}\`` : 'Onbekend');
const jump = (guildId, channelId, messageId) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

function fitEmbed(e) {
  // Discord: totaal max 6000 tekens per embed. Beschrijving inkorten als het te veel wordt.
  const d = e.data;
  const other = (d.title?.length || 0) + (d.author?.name?.length || 0) + (d.footer?.text?.length || 0)
    + (d.fields || []).reduce((a, f) => a + f.name.length + f.value.length, 0);
  if (d.description && other + d.description.length > 5900) e.setDescription(cut(d.description, Math.max(200, 5900 - other)));
  return e;
}

function linkRow(url, label = 'Ga naar bericht') {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url));
}

// Woord-voor-woord verschil: ~~weg~~ **erbij**
function diffWords(a, b) {
  const A = a.split(/\s+/).filter(Boolean);
  const B = b.split(/\s+/).filter(Boolean);
  if (!A.length || !B.length || A.length > 500 || B.length > 500) return null;
  const n = A.length, m = B.length, w = m + 1;
  const L = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(A[i]); i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) out.push(`~~${A[i++]}~~`);
    else out.push(`**${B[j++]}**`);
  }
  while (i < n) out.push(`~~${A[i++]}~~`);
  while (j < m) out.push(`**${B[j++]}**`);
  return out.join(' ');
}

// ---------- bericht-cache (blijft bewaard op schijf) ----------
const DIR = process.env.DATA_DIR || __dirname;
const CACHE_FILE = path.join(DIR, 'msgcache.json');
const MAX_AGE = 7 * 24 * 3600 * 1000;
const cache = new Map(); // messageId -> snapshot
let dirty = false;
let listeners = [];
let flushTimer = null;
function on(client, event, fn) { client.on(event, fn); listeners.push([client, event, fn]); }

try {
  const arr = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  for (const s of arr) if (s?.id && Date.now() - s.t < MAX_AGE) cache.set(s.id, s);
} catch { /* geen cache-bestand (nog) */ }

function flush() {
  if (!dirty) return;
  try {
    for (const [id, s] of cache) if (Date.now() - s.t > MAX_AGE) cache.delete(id);
    fs.writeFileSync(`${CACHE_FILE}.tmp`, JSON.stringify([...cache.values()]));
    fs.renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE);
    dirty = false;
  } catch (e) { console.error('Bericht-cache opslaan mislukt:', e.message); }
}

function remember(s) {
  cache.delete(s.id); // opnieuw achteraan zetten
  cache.set(s.id, s);
  const max = opts().cacheSize;
  while (cache.size > max) cache.delete(cache.keys().next().value);
  dirty = true;
}

function snap(m, prev) {
  const a = m.author;
  const mem = m.member;
  return {
    id: m.id, c: m.channelId, t: m.createdTimestamp || snowflakeTime(m.id),
    au: a ? { id: a.id, tag: a.username, name: mem?.displayName || a.globalName || a.username, av: a.displayAvatarURL?.({ size: 256 }) || null, bot: !!a.bot, wh: !!m.webhookId } : prev?.au || null,
    content: m.content ?? prev?.content ?? '',
    att: m.attachments ? [...m.attachments.values()].map((x) => ({ id: x.id, n: x.name, u: x.url, s: x.size, ct: x.contentType || null })) : prev?.att || [],
    st: m.stickers ? [...m.stickers.values()].map((x) => x.name) : prev?.st || [],
    emb: m.embeds ? m.embeds.map((e) => cut(e.title || e.url || e.description || e.data?.type || 'embed', 80)) : prev?.emb || [],
    ref: m.reference?.messageId || prev?.ref || null,
    pin: typeof m.pinned === 'boolean' ? m.pinned : prev?.pin ?? false,
    mn: m.mentions ? {
      u: [...m.mentions.users.keys()].slice(0, 20), r: [...m.mentions.roles.keys()].slice(0, 20),
      e: !!m.mentions.everyone,
    } : prev?.mn || { u: [], r: [], e: false },
    h: prev?.h || [], // bewerkingsgeschiedenis [{ c: oude inhoud, t: tijdstip }]
  };
}

// ---------- versturen ----------
let logCh = null;
async function send(client, payload) {
  const id = config.channels.messageLogs;
  if (!id) return null;
  try {
    if (!logCh || logCh.id !== id) logCh = await client.channels.fetch(id);
    return await logCh.send({ allowedMentions: { parse: [] }, ...payload });
  } catch (e) {
    console.error('Message-log versturen mislukt (bestaat het kanaal en mag de bot er schrijven?):', e.message);
    return null;
  }
}

function skip(client, channel, channelId, user) {
  const o = opts();
  if (channelId === config.channels.messageLogs) return true;
  if (user) {
    if (user.id === client.user.id) return true;
    if (o.ignoreBots && user.bot) return true;
    if (o.ignoredUsers.includes(user.id)) return true;
  }
  if (o.ignoredChannels.includes(channelId)) return true;
  const parent = channel?.parentId || client.channels.cache.get(channelId)?.parentId;
  if (parent && o.ignoredCategories.includes(parent)) return true;
  return false;
}

// ---------- audit log ----------
const seenEntries = new Set();
const delCounts = new Map(); // audit-entry-ID -> aantal verwerkte verwijderingen (Discord telt door in dezelfde entry)
const canAudit = (guild) => !!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog);

async function findAudit(guild, type, match, maxAge = 15000) {
  if (!canAudit(guild)) return null;
  for (let n = 0; n < 3; n++) {
    await sleep(n === 0 ? 700 : 900);
    try {
      const logs = await guild.fetchAuditLogs({ type, limit: 10 });
      const e = logs.entries.find((x) => !seenEntries.has(x.id) && Date.now() - x.createdTimestamp < maxAge && match(x));
      if (e) {
        seenEntries.add(e.id);
        if (seenEntries.size > 500) seenEntries.delete(seenEntries.values().next().value);
        return e;
      }
    } catch { return null; }
  }
  return null;
}

// Wie verwijderde dit bericht? (Discord logt alleen verwijderingen door ANDEREN dan de auteur.)
async function findDeleter(guild, authorId, channelId) {
  if (!canAudit(guild)) return { executor: null, noAudit: true };
  for (let n = 0; n < 3; n++) {
    await sleep(n === 0 ? 900 : 900);
    try {
      const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 });
      for (const e of logs.entries.values()) {
        if (e.extra?.channel?.id !== channelId) continue;
        if (authorId && e.targetId !== authorId) continue;
        const prev = delCounts.get(e.id);
        const fresh = prev === undefined ? Date.now() - e.createdTimestamp < 10000 : e.extra.count > prev;
        if (!fresh) continue;
        delCounts.set(e.id, e.extra.count);
        if (delCounts.size > 200) delCounts.delete(delCounts.keys().next().value);
        return { executor: e.executor, noAudit: false };
      }
    } catch { return { executor: null, noAudit: true }; }
  }
  return { executor: null, noAudit: false };
}

// ---------- bijlagen opnieuw uploaden ----------
const isImage = (a) => (a.ct || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.n || '');
async function rescue(attachments) {
  const files = [];
  let total = 0;
  for (const a of attachments.slice(0, 5)) {
    if (!a.u || a.s > 8 * 1048576 || total + a.s > 8 * 1048576) continue;
    try {
      const res = await fetch(a.u, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      total += buf.length;
      const name = (a.n || 'bijlage').replace(/[^\w.\-]/g, '_');
      files.push({ name, att: new AttachmentBuilder(buf, { name }), image: isImage(a) });
    } catch { /* link is al weg */ }
  }
  return files;
}

const attList = (att, saved = new Set()) => cut(att.map((a) => `${saved.has(a.n) ? '💾' : '📎'} [${cut(a.n, 40)}](${a.u}) · ${fmtSize(a.s)}${a.ct ? ` · \`${a.ct}\`` : ''}`).join('\n'), 1000);
const LINK_RE = /https?:\/\/[^\s<>)]+/gi;

// ---------- embeds ----------
function authorBlock(e, s, fallbackName = 'Onbekende auteur') {
  return e.setAuthor({ name: s?.au ? `${s.au.name}${s.au.bot ? ' [BOT]' : ''}` : fallbackName, iconURL: s?.au?.av || undefined });
}

function extraFields(guildId, s) {
  const f = [];
  if (s.ref) f.push({ name: '↩️ Reply op', value: `[Bericht](${jump(guildId, s.c, s.ref)})`, inline: true });
  if (s.st?.length) f.push({ name: '🏷️ Stickers', value: cut(s.st.join(', '), 200), inline: true });
  if (s.emb?.length) f.push({ name: '🧩 Embeds', value: cut(s.emb.map((x) => `• ${x}`).join('\n'), 400), inline: true });
  const pings = [];
  if (s.mn?.e) pings.push('**@everyone/@here**');
  if (s.mn?.u?.length) pings.push(s.mn.u.map((id) => `<@${id}>`).join(' '));
  if (s.mn?.r?.length) pings.push(s.mn.r.map((id) => `<@&${id}>`).join(' '));
  if (pings.length) f.push({ name: '🔔 Pings', value: cut(pings.join('\n'), 500), inline: false });
  const links = [...new Set((s.content || '').match(LINK_RE) || [])];
  if (links.length) f.push({ name: '🔗 Links', value: cut(links.slice(0, 6).join('\n'), 600), inline: false });
  return f;
}

// ---------- events ----------
function init(client) {
  if (!opts().enabled) return;
  const guildOk = (g) => (g?.id ?? g) === config.guildId;
  const safe = (name, fn) => async (...a) => { try { await fn(...a); } catch (e) { console.error(`Message-log (${name}) fout:`, e); } };

  if (!flushTimer) { flushTimer = setInterval(flush, 60 * 1000); flushTimer.unref(); }

  // ----- nieuw bericht: in cache bewaren (+ optioneel loggen) -----
  on(client, Events.MessageCreate, safe('create', async (m) => {
    if (!m.guildId || !guildOk(m.guildId) || m.system) return;
    if (m.author?.id === client.user.id) return; // eigen berichten (panelen) hoeven niet bewaard
    remember(snap(m));
    const o = opts();
    if (!o.events.create || skip(client, m.channel, m.channelId, m.author)) return;
    const s = cache.get(m.id);
    const e = authorBlock(new EmbedBuilder(), s)
      .setColor(COLORS.create).setTitle('💬 Nieuw bericht')
      .setDescription(cut(s.content || '*(geen tekst)*', 3500))
      .addFields(
        { name: 'Auteur', value: userLine(m.author), inline: true },
        { name: 'Kanaal', value: `<#${m.channelId}>`, inline: true },
        ...(s.att.length ? [{ name: `📎 Bijlagen (${s.att.length})`, value: attList(s.att), inline: false }] : []),
        ...extraFields(m.guildId, s),
      )
      .setThumbnail(s.au?.av).setFooter({ text: `Bericht-ID: ${m.id} • ${config.footerText}` }).setTimestamp(m.createdTimestamp);
    await send(client, { embeds: [fitEmbed(e)], components: [linkRow(m.url)] });
  }));

  // ----- bericht verwijderd -----
  on(client, Events.MessageDelete, safe('delete', async (m) => {
    if (!m.guildId || !guildOk(m.guildId)) return;
    const s = cache.get(m.id) || (!m.partial && m.author ? snap(m) : null);
    cache.delete(m.id); dirty = true;
    if (!opts().events.delete) return;
    const channelId = m.channelId;
    if (skip(client, m.channel, channelId, s?.au)) return;
    const guild = m.guild || client.guilds.cache.get(config.guildId);
    const created = s?.t || snowflakeTime(m.id);

    const [{ executor, noAudit }, saved] = await Promise.all([
      guild ? findDeleter(guild, s?.au?.id, channelId) : { executor: null, noAudit: true },
      s?.att?.length && opts().saveAttachments ? rescue(s.att) : [],
    ]);

    const e = authorBlock(new EmbedBuilder(), s, 'Onbekende auteur (bericht stond niet in de cache)')
      .setColor(COLORS.delete).setTitle('🗑️ Bericht verwijderd')
      .setDescription(s ? cut(s.content || '*(geen tekst)*', 3500) : '*Inhoud onbekend: het bericht is van vóór de bot de cache vulde of ouder dan 7 dagen.*')
      .addFields(
        { name: 'Auteur', value: s?.au ? userLine(s.au) : 'Onbekend', inline: true },
        { name: 'Kanaal', value: `<#${channelId}>`, inline: true },
        {
          name: 'Verwijderd door',
          value: executor ? `${userLine(executor)}${executor.id === s?.au?.id ? ' (zelf)' : ''}` : noAudit ? 'Onbekend (bot mist **Audit log bekijken**)' : 'Waarschijnlijk de auteur zelf',
          inline: true,
        },
        { name: '🕒 Verstuurd', value: fullTs(created), inline: true },
        { name: '🗑️ Verwijderd', value: fullTs(Date.now()), inline: true },
        { name: '⏱️ Bestond', value: cut(duration(Date.now() - created), 100), inline: true },
      );
    if (s) {
      if (s.att.length) e.addFields({ name: `📎 Bijlagen (${s.att.length})`, value: attList(s.att, new Set(saved.map((x) => x.name))), inline: false });
      e.addFields(...extraFields(guild?.id || config.guildId, s));
      if (s.h?.length) {
        e.addFields({
          name: `✏️ Bewerkt (${s.h.length}x) – eerdere versies`,
          value: cut(s.h.slice(-3).map((h, i) => `**${ts(h.t, 'T')}** ${cut(h.c || '*(leeg)*', 250)}`).join('\n'), 1000),
          inline: false,
        });
      }
      if (s.pin) e.addFields({ name: '📌', value: 'Dit bericht was vastgepind', inline: true });
    }
    const firstImg = saved.find((x) => x.image);
    if (firstImg) e.setImage(`attachment://${firstImg.name}`);
    if (s?.au?.av) e.setThumbnail(s.au.av);
    e.setFooter({ text: `Bericht-ID: ${m.id}${s?.au ? ` • User-ID: ${s.au.id}` : ''} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [fitEmbed(e)], files: saved.map((x) => x.att) });
  }));

  // ----- veel berichten tegelijk verwijderd (purge / /clear) -----
  on(client, Events.MessageBulkDelete, safe('bulk', async (messages, channel) => {
    if (!guildOk(channel.guildId)) return;
    const ids = [...messages.keys()];
    const list = ids.map((id) => cache.get(id) || (messages.get(id) && !messages.get(id).partial && messages.get(id).author ? snap(messages.get(id)) : { id, c: channel.id, t: snowflakeTime(id), au: null, content: '', att: [] }));
    ids.forEach((id) => cache.delete(id)); dirty = true;
    if (!opts().events.bulkDelete || skip(client, channel, channel.id, null)) return;

    const entry = await findAudit(channel.guild, AuditLogEvent.MessageBulkDelete, (x) => x.target?.id === channel.id || x.extra?.channel?.id === channel.id || !x.target);
    list.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const known = list.filter((s) => s.au);
    const perUser = new Map();
    for (const s of known) perUser.set(s.au.id, (perUser.get(s.au.id) || 0) + 1);
    const top = [...perUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => `<@${id}> – **${n}**`).join('\n');
    const withAtt = list.reduce((a, s) => a + (s.att?.length || 0), 0);

    const lines = list.map((s) => {
      const when = new Date(s.t).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' });
      const who = s.au ? `${s.au.name} (${s.au.tag}, ${s.au.id})` : 'ONBEKEND (niet in cache)';
      const att = s.att?.length ? `\n    Bijlagen: ${s.att.map((x) => x.u).join(' ')}` : '';
      return `[${when}] ${who} #${s.id}:\n  ${(s.content || '(geen tekst)').replace(/\n/g, '\n  ')}${att}`;
    });
    const header = `Bulk-delete in #${channel.name} (${channel.id})\nAantal: ${list.length}\nTijdstip: ${new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}\n${'='.repeat(60)}\n\n`;
    const file = new AttachmentBuilder(Buffer.from(header + lines.join('\n\n'), 'utf8'), { name: `bulk-delete-${channel.name}-${Date.now()}.txt` });

    const e = new EmbedBuilder().setColor(COLORS.bulk).setTitle('🧹 Bulk-delete')
      .setDescription(`**${list.length}** berichten verwijderd in <#${channel.id}>.\nHet volledige transcript staat in het bijgevoegde bestand.`)
      .addFields(
        { name: 'Uitgevoerd door', value: entry?.executor ? userLine(entry.executor) : 'Onbekend / niet te achterhalen', inline: true },
        { name: 'Kanaal', value: `<#${channel.id}>`, inline: true },
        { name: 'In cache', value: `${known.length} van ${list.length}${withAtt ? ` · ${withAtt} bijlage(n)` : ''}`, inline: true },
        ...(top ? [{ name: '👥 Berichten per persoon', value: cut(top, 1000), inline: false }] : []),
        ...(list.length ? [{ name: '🕒 Oudste → nieuwste', value: `${ts(list[0].t, 'f')} → ${ts(list[list.length - 1].t, 'f')}`, inline: false }] : []),
      ).setFooter({ text: config.footerText }).setTimestamp();
    await send(client, { embeds: [fitEmbed(e)], files: [file] });
  }));

  // ----- bericht bewerkt / vastgepind -----
  on(client, Events.MessageUpdate, safe('update', async (old, neu) => {
    if (!neu.guildId || !guildOk(neu.guildId)) return;
    let m = neu;
    if (m.partial) m = await m.fetch().catch(() => null);
    if (!m || !m.author) return;
    if (m.author.id === client.user.id) return;

    const prev = cache.get(m.id) || (old && !old.partial && old.author ? snap(old) : null);
    const next = snap(m, prev);
    const o = opts();

    const recentEdit = m.editedTimestamp && Date.now() - m.editedTimestamp < 15000;
    const contentChanged = prev ? prev.content !== m.content : !!recentEdit;
    const removedAtt = prev ? prev.att.filter((a) => !next.att.some((b) => b.id === a.id)) : [];
    const pinChanged = prev && typeof m.pinned === 'boolean' && prev.pin !== m.pinned;
    if (contentChanged && prev) next.h = [...prev.h, { c: cut(prev.content, 1500), t: m.editedTimestamp || Date.now() }].slice(-5);
    remember(next);
    if (skip(client, m.channel, m.channelId, m.author)) return;

    // Vastgepind / losgemaakt
    if (pinChanged && o.events.pin) {
      const e = authorBlock(new EmbedBuilder(), next).setColor(COLORS.pin)
        .setTitle(m.pinned ? '📌 Bericht vastgepind' : '📍 Bericht losgemaakt')
        .setDescription(cut(m.content || '*(geen tekst)*', 1500))
        .addFields(
          { name: 'Auteur', value: userLine(m.author), inline: true },
          { name: 'Kanaal', value: `<#${m.channelId}>`, inline: true },
          { name: '🕒 Verstuurd', value: fullTs(m.createdTimestamp), inline: true },
        ).setThumbnail(next.au?.av).setFooter({ text: `Bericht-ID: ${m.id} • ${config.footerText}` }).setTimestamp();
      await send(client, { embeds: [fitEmbed(e)], components: [linkRow(m.url)] });
    }

    if (!o.events.edit || (!contentChanged && !removedAtt.length)) return;

    const before = prev ? prev.content : null;
    const after = m.content || '';
    const long = (before?.length || 0) > 1000 || after.length > 1000;
    const d = before !== null && contentChanged ? diffWords(before, after) : null;
    const e = authorBlock(new EmbedBuilder(), next).setColor(COLORS.edit).setTitle('✏️ Bericht bewerkt')
      .addFields(
        { name: 'Auteur', value: userLine(m.author), inline: true },
        { name: 'Kanaal', value: `<#${m.channelId}>`, inline: true },
        { name: '🕒 Verstuurd', value: fullTs(m.createdTimestamp), inline: true },
      );
    if (contentChanged) {
      e.addFields(
        { name: '⬅️ Voor', value: before === null ? '*Oude inhoud onbekend (niet in cache)*' : cut(before || '*(leeg)*', 1000), inline: false },
        { name: '➡️ Na', value: cut(after || '*(leeg)*', 1000), inline: false },
      );
      if (d && d.length <= 1000 && d !== after) e.addFields({ name: '🔍 Verschil (~~weg~~ / **erbij**)', value: d, inline: false });
      if (next.h.length > 1) e.addFields({ name: '🔢 Aantal bewerkingen (sinds cache)', value: String(next.h.length), inline: true });
    }
    if (removedAtt.length) e.addFields({ name: `🗑️ Bijlage(n) verwijderd (${removedAtt.length})`, value: attList(removedAtt), inline: false });
    const newLinks = [...new Set(after.match(LINK_RE) || [])].filter((l) => !(before || '').includes(l));
    if (newLinks.length) e.addFields({ name: '🔗 Nieuwe links', value: cut(newLinks.join('\n'), 600), inline: false });
    if (next.mn?.e && !prev?.mn?.e) e.addFields({ name: '🔔', value: '**@everyone/@here** toegevoegd', inline: true });
    e.setThumbnail(next.au?.av).setFooter({ text: `Bericht-ID: ${m.id} • User-ID: ${m.author.id} • ${config.footerText}` }).setTimestamp();

    const files = [];
    if (long) files.push(new AttachmentBuilder(Buffer.from(`VOOR:\n${before ?? '(onbekend)'}\n\n${'-'.repeat(40)}\nNA:\n${after}`, 'utf8'), { name: `bewerking-${m.id}.txt` }));
    await send(client, { embeds: [fitEmbed(e)], components: [linkRow(m.url)], files });
  }));

  // ----- reacties -----
  const reactionLog = (kind) => safe(`reaction-${kind}`, async (reaction, user) => {
    if (!opts().events.reactions) return;
    if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
    if (user.partial) user = await user.fetch().catch(() => user);
    const msg = reaction.message;
    if (!msg.guildId || !guildOk(msg.guildId) || user.bot && opts().ignoreBots) return;
    if (skip(client, msg.channel, msg.channelId, user)) return;
    const s = cache.get(msg.id);
    const em = reaction.emoji;
    const add = kind === 'add';
    const e = new EmbedBuilder().setColor(add ? COLORS.reactAdd : COLORS.reactRemove)
      .setTitle(add ? '➕ Reactie toegevoegd' : '➖ Reactie verwijderd')
      .setDescription(`${em.toString()} ${em.id ? `\`:${em.name}:\`` : ''}`)
      .addFields(
        { name: 'Door', value: userLine(user), inline: true },
        { name: 'Kanaal', value: `<#${msg.channelId}>`, inline: true },
        { name: 'Auteur van bericht', value: s?.au ? `<@${s.au.id}>` : msg.author ? `<@${msg.author.id}>` : 'Onbekend', inline: true },
        { name: 'Totaal van dit emoji', value: String(reaction.count ?? '?'), inline: true },
        ...(s?.content || msg.content ? [{ name: 'Bericht', value: cut(s?.content || msg.content, 300), inline: false }] : []),
      ).setThumbnail(em.id ? em.imageURL() : user.displayAvatarURL?.() || null)
      .setFooter({ text: `Bericht-ID: ${msg.id} • User-ID: ${user.id} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [fitEmbed(e)], components: [linkRow(jump(msg.guildId, msg.channelId, msg.id))] });
  });
  on(client, Events.MessageReactionAdd, reactionLog('add'));
  on(client, Events.MessageReactionRemove, reactionLog('remove'));

  on(client, Events.MessageReactionRemoveAll, safe('reaction-clear', async (message, reactions) => {
    if (!opts().events.reactions || !message.guildId || !guildOk(message.guildId)) return;
    if (skip(client, message.channel, message.channelId, null)) return;
    const e = new EmbedBuilder().setColor(COLORS.reactRemove).setTitle('🧼 Alle reacties verwijderd')
      .addFields(
        { name: 'Kanaal', value: `<#${message.channelId}>`, inline: true },
        { name: 'Verwijderde reacties', value: cut(reactions?.map((r) => `${r.emoji.toString()} ×${r.count}`).join('  ') || 'Onbekend', 1000), inline: false },
      ).setFooter({ text: `Bericht-ID: ${message.id} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [e], components: [linkRow(jump(message.guildId, message.channelId, message.id))] });
  }));
  on(client, Events.MessageReactionRemoveEmoji, safe('reaction-emoji', async (reaction) => {
    const msg = reaction.message;
    if (!opts().events.reactions || !msg.guildId || !guildOk(msg.guildId) || skip(client, msg.channel, msg.channelId, null)) return;
    const e = new EmbedBuilder().setColor(COLORS.reactRemove).setTitle('🧼 Emoji-reactie volledig verwijderd')
      .setDescription(reaction.emoji.toString())
      .addFields({ name: 'Kanaal', value: `<#${msg.channelId}>`, inline: true })
      .setFooter({ text: `Bericht-ID: ${msg.id} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [e], components: [linkRow(jump(msg.guildId, msg.channelId, msg.id))] });
  }));

  // ----- voice -----
  on(client, Events.VoiceStateUpdate, safe('voice', async (o, n) => {
    if (!opts().events.voice || !guildOk(n.guild) || !n.member) return;
    const u = n.member.user;
    if (u.id === client.user.id || (u.bot && opts().ignoreBots) || opts().ignoredUsers.includes(u.id)) return;
    const lines = [];
    let title = '🎙️ Voice-update', color = COLORS.voice;
    if (o.channelId !== n.channelId) {
      if (!o.channelId) { title = '🔊 Voice betreden'; color = COLORS.join; lines.push(`Betreden: <#${n.channelId}>`); }
      else if (!n.channelId) { title = '🔇 Voice verlaten'; color = COLORS.leave; lines.push(`Verlaten: <#${o.channelId}>`); }
      else { title = '🔀 Voice verplaatst'; lines.push(`<#${o.channelId}> ➜ <#${n.channelId}>`); }
    } else {
      const chk = [['selfMute', 'Zichzelf gemute', 'Zichzelf unmute'], ['selfDeaf', 'Zichzelf gedeafend', 'Zichzelf undeafend'],
        ['serverMute', 'Server-mute gekregen', 'Server-mute weg'], ['serverDeaf', 'Server-deaf gekregen', 'Server-deaf weg'],
        ['streaming', 'Is live gegaan (stream)', 'Stream gestopt'], ['selfVideo', 'Camera aan', 'Camera uit']];
      for (const [k, on, off] of chk) if (!!o[k] !== !!n[k]) lines.push(n[k] ? on : off);
      if (!lines.length) return;
      lines.unshift(`In: <#${n.channelId}>`);
    }
    const e = new EmbedBuilder().setColor(color).setTitle(title).setDescription(lines.join('\n'))
      .addFields({ name: 'Gebruiker', value: userLine(u), inline: true })
      .setThumbnail(u.displayAvatarURL()).setFooter({ text: `User-ID: ${u.id} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [e] });
  }));

  // ----- leden: join / leave / bijnaam / rollen / timeout -----
  on(client, Events.GuildMemberAdd, safe('join', async (member) => {
    if (!opts().events.members || !guildOk(member.guild)) return;
    const age = Date.now() - member.user.createdTimestamp;
    const e = new EmbedBuilder().setColor(COLORS.join).setTitle(`📥 Lid gejoind${member.user.bot ? ' (BOT)' : ''}`)
      .setDescription(`${member} is lid nummer **${member.guild.memberCount}**.`)
      .addFields(
        { name: 'Gebruiker', value: userLine(member.user), inline: true },
        { name: '🎂 Account gemaakt', value: fullTs(member.user.createdTimestamp), inline: true },
        ...(age < 7 * 24 * 3600 * 1000 ? [{ name: '⚠️', value: `Nieuw account (${duration(age)} oud)`, inline: true }] : []),
      ).setThumbnail(member.user.displayAvatarURL()).setFooter({ text: `User-ID: ${member.id} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [e] });
  }));

  on(client, Events.GuildMemberRemove, safe('leave', async (member) => {
    if (!opts().events.members || !guildOk(member.guild)) return;
    const kick = await findAudit(member.guild, AuditLogEvent.MemberKick, (x) => x.targetId === member.id, 10000);
    const roles = member.roles?.cache.filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`) || [];
    const e = new EmbedBuilder().setColor(COLORS.leave).setTitle(kick ? '👢 Lid gekickt' : '📤 Lid vertrokken')
      .addFields(
        { name: 'Gebruiker', value: userLine(member.user), inline: true },
        ...(member.joinedTimestamp ? [{ name: '📅 Lid sinds', value: `${ts(member.joinedTimestamp, 'D')} (${duration(Date.now() - member.joinedTimestamp)})`, inline: true }] : []),
        ...(kick ? [{ name: 'Gekickt door', value: userLine(kick.executor), inline: true }, { name: 'Reden', value: cut(kick.reason || 'Geen reden', 500), inline: false }] : []),
        ...(roles.length ? [{ name: `Rollen (${roles.length})`, value: cut(roles.join(' '), 1000), inline: false }] : []),
      ).setThumbnail(member.user.displayAvatarURL()).setFooter({ text: `User-ID: ${member.id} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [e] });
  }));

  on(client, Events.GuildMemberUpdate, safe('member', async (o, n) => {
    if (!opts().events.members || !guildOk(n.guild) || o.partial) return;
    const fields = [];
    let roleChange = false, other = false;
    if (o.nickname !== n.nickname) { other = true; fields.push({ name: '📝 Bijnaam', value: `${cut(o.nickname || '*geen*', 100)} ➜ ${cut(n.nickname || '*geen*', 100)}`, inline: false }); }
    const added = n.roles.cache.filter((r) => !o.roles.cache.has(r.id));
    const removed = o.roles.cache.filter((r) => !n.roles.cache.has(r.id));
    if (added.size) { roleChange = true; fields.push({ name: '➕ Rol(len) erbij', value: cut(added.map((r) => `<@&${r.id}>`).join(' '), 1000), inline: false }); }
    if (removed.size) { roleChange = true; fields.push({ name: '➖ Rol(len) weg', value: cut(removed.map((r) => `<@&${r.id}>`).join(' '), 1000), inline: false }); }
    if (o.communicationDisabledUntilTimestamp !== n.communicationDisabledUntilTimestamp) {
      other = true;
      const until = n.communicationDisabledUntilTimestamp;
      fields.push({ name: '🔇 Timeout', value: until && until > Date.now() ? `Tot ${fullTs(until)}` : 'Opgeheven', inline: false });
    }
    if (o.avatar !== n.avatar) { other = true; fields.push({ name: '🖼️ Server-avatar', value: 'Gewijzigd', inline: false }); }
    if (!fields.length) return;

    const entry = await findAudit(n.guild, roleChange && !other ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberUpdate, (x) => x.targetId === n.id, 10000)
      || (roleChange && other ? await findAudit(n.guild, AuditLogEvent.MemberRoleUpdate, (x) => x.targetId === n.id, 10000) : null);
    if (entry?.executor?.id === n.id) fields.push({ name: 'Door', value: 'Zelf', inline: true });
    else if (entry?.executor) fields.push({ name: 'Door', value: userLine(entry.executor), inline: true });
    if (entry?.reason) fields.push({ name: 'Reden', value: cut(entry.reason, 500), inline: false });

    const e = new EmbedBuilder().setColor(COLORS.member).setTitle('👤 Lid bijgewerkt')
      .setDescription(`${n} (\`${n.user.username}\`)`).addFields(fields)
      .setThumbnail(n.user.displayAvatarURL()).setFooter({ text: `User-ID: ${n.id} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [fitEmbed(e)] });
  }));

  // ----- bans -----
  const banLog = (add) => safe('ban', async (ban) => {
    if (!opts().events.bans || !guildOk(ban.guild)) return;
    if (ban.partial) ban = await ban.fetch().catch(() => ban);
    const entry = await findAudit(ban.guild, add ? AuditLogEvent.MemberBanAdd : AuditLogEvent.MemberBanRemove, (x) => x.targetId === ban.user.id, 10000);
    const e = new EmbedBuilder().setColor(add ? COLORS.ban : COLORS.join).setTitle(add ? '🔨 Lid gebanned' : '🕊️ Ban opgeheven')
      .addFields(
        { name: 'Gebruiker', value: userLine(ban.user), inline: true },
        { name: 'Door', value: entry?.executor ? userLine(entry.executor) : 'Onbekend', inline: true },
        ...(add ? [{ name: 'Reden', value: cut(ban.reason || entry?.reason || 'Geen reden', 800), inline: false }] : []),
      ).setThumbnail(ban.user.displayAvatarURL()).setFooter({ text: `User-ID: ${ban.user.id} • ${config.footerText}` }).setTimestamp();
    await send(client, { embeds: [e] });
  });
  on(client, Events.GuildBanAdd, banLog(true));
  on(client, Events.GuildBanRemove, banLog(false));

  console.log(`✅ Message-logs actief${config.channels.messageLogs ? '' : ' (maar channels.messageLogs is leeg!)'} – ${cache.size} berichten uit cache geladen.`);
}

function duration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}u`;
  if (h) return `${h}u ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { flush(); process.exit(0); });

function destroy(client) {
  for (const [c, event, fn] of listeners) if (!client || c === client) c.removeListener(event, fn);
  listeners = listeners.filter(([c]) => client && c !== client);
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  flush();
}

module.exports = { init, destroy, _test: { diffWords, snowflakeTime, duration, cut } };
