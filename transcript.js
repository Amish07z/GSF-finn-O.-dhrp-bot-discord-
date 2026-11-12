// Transcripts van tickets: direct leesbaar in Discord (in een thread onder het transcript-bericht), geen HTML-bestand.
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const config = require('./config');
const { embed } = require('./utils');

const tz = 'Europe/Amsterdam';
const fmtTime = (d) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: tz });
const fmtDay = (d) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Haalt de berichten van een kanaal op (oud -> nieuw), max 2000
async function collectMessages(channel, max = 2000) {
  const msgs = []; let last;
  while (msgs.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, ...(last && { before: last }) });
    if (!batch.size) break;
    msgs.push(...batch.values()); last = batch.last().id;
    if (batch.size < 100) break;
  }
  return msgs.reverse();
}

// Zet berichten om naar leesbare regels
function toLines(msgs) {
  const lines = []; let day = '';
  for (const m of msgs) {
    const d = fmtDay(m.createdAt);
    if (d !== day) { day = d; lines.push(`\n**── ${d} ──**`); }
    const name = m.member?.displayName || m.author.globalName || m.author.username;
    const head = `\`${fmtTime(m.createdAt)}\` **${name}**${m.author.bot ? ' 🤖' : ''}`;
    const body = [];
    if (m.content) body.push(m.content);
    for (const e of m.embeds) {
      const parts = [e.title && `**${e.title}**`, e.description, ...(e.fields || []).map((f) => `**${f.name}:** ${f.value}`)].filter(Boolean).join('\n');
      if (parts) body.push(cut(parts, 1800).split('\n').map((l) => `> ${l}`).join('\n'));
    }
    for (const a of m.attachments.values()) body.push(`📎 [${a.name}](${a.url})`);
    if (m.components?.length && !body.length) body.push('*(knoppen / menu)*');
    if (!body.length) continue;
    const first = body[0];
    lines.push(`${head}: ${first.startsWith('>') ? '\n' + first : first}`, ...body.slice(1));
  }
  return lines;
}

// Verdeelt regels over embeds van max ~3900 tekens
function toChunks(lines, max = 3900) {
  const chunks = []; let cur = '';
  const push = () => { if (cur.trim()) chunks.push(cur); cur = ''; };
  for (let line of lines) {
    while (line.length > max) { // één heel lang bericht: opdelen
      push(); chunks.push(line.slice(0, max)); line = line.slice(max);
    }
    if ((cur + '\n' + line).length > max) push();
    cur += (cur ? '\n' : '') + line;
  }
  push();
  return chunks;
}

// Samenvattings-embed (in de stijl van GSF Bot: Kanaal / Klant / Gesloten door / Categorie / Berichten)
function summaryEmbed({ channelName, ownerId, closedBy, categorie, count, reden }) {
  const e = embed('Ticket Transcript', null, config.logColor).addFields(
    { name: 'Kanaal', value: `#${channelName}`, inline: true },
    { name: 'Klant', value: `<@${ownerId}>`, inline: true },
    { name: 'Gesloten door', value: `${closedBy}`, inline: true },
    { name: 'Categorie', value: categorie, inline: true },
    { name: 'Berichten', value: String(count), inline: true },
  );
  if (reden) e.addFields({ name: 'Reden', value: cut(reden, 1000) });
  return e;
}


// ===== HTML-transcript (echt bestand, blijft altijd bewaard in het ticketLogs-kanaal) =====
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtFull = (d) => d.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'medium', timeZone: tz });

function buildHtml(msgs, meta) {
  const rows = msgs.map((m) => {
    const name = m.member?.displayName || m.author.globalName || m.author.username;
    const parts = [];
    if (m.content) parts.push(`<div class="txt">${esc(m.content).replace(/\n/g, '<br>')}</div>`);
    for (const e of m.embeds) {
      const f = (e.fields || []).map((x) => `<div><b>${esc(x.name)}</b><br>${esc(x.value).replace(/\n/g, '<br>')}</div>`).join('');
      parts.push(`<div class="emb">${e.title ? `<b>${esc(e.title)}</b><br>` : ''}${e.description ? esc(e.description).replace(/\n/g, '<br>') : ''}${f}</div>`);
    }
    for (const a of m.attachments.values()) {
      parts.push(/^image\//.test(a.contentType || '') ? `<a href="${esc(a.url)}"><img class="img" src="${esc(a.url)}"></a>` : `<div>📎 <a href="${esc(a.url)}">${esc(a.name)}</a></div>`);
    }
    if (!parts.length) parts.push('<i>(knoppen / menu)</i>');
    return `<div class="m"><img class="av" src="${esc(m.author.displayAvatarURL({ size: 64, extension: 'png' }))}"><div><span class="n">${esc(name)}</span>${m.author.bot ? '<span class="bot">APP</span>' : ''}<span class="t">${esc(fmtFull(m.createdAt))}</span>${parts.join('')}</div></div>`;
  }).join('\n');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Transcript ${esc(meta.channelName)}</title><style>
body{background:#313338;color:#dbdee1;font-family:Arial,Helvetica,sans-serif;margin:0;padding:24px}
h1{font-size:20px;color:#fff;margin:0 0 4px}.sub{color:#949ba4;font-size:13px;margin-bottom:20px}
.m{display:flex;gap:12px;margin:0 0 14px}.av{width:40px;height:40px;border-radius:50%}
.n{font-weight:bold;color:#fff}.bot{background:#5865f2;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px;margin-left:6px}
.t{color:#949ba4;font-size:11px;margin-left:8px}.txt{margin-top:2px;line-height:1.35}
.emb{border-left:4px solid #2ecc70;background:#2b2d31;padding:8px 12px;margin-top:4px;border-radius:4px;max-width:520px;line-height:1.35}
.img{max-width:380px;max-height:300px;border-radius:6px;margin-top:4px}a{color:#00a8fc}
</style></head><body><h1>Ticket transcript – #${esc(meta.channelName)}</h1>
<div class="sub">${esc(meta.categorie)} · ${msgs.length} berichten · gesloten door ${esc(meta.closedByName)} · ${esc(fmtFull(new Date()))}<br>${esc(config.footerText)}</div>
${rows}
</body></html>`;
}

// Bewaart een kopie op schijf (map transcripts/ naast data.json), als extra back-up
function saveLocal(fileName, html) {
  try {
    const dir = path.join(process.env.DATA_DIR || __dirname, 'transcripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), html);
  } catch (err) { console.error('Transcript lokaal opslaan mislukt:', err.message); }
}

// Plaatst samenvatting + transcript in het ticketLogs-kanaal. Geeft het samenvattingsbericht terug (of null bij mislukken).
async function postTranscript(client, summary, msgs, channelName, meta = {}) {
  const id = config.channels.ticketLogs;
  const target = id ? await client.channels.fetch(id).catch(() => null) : null;
  if (!target) return null;

  // 1) Het echte transcript: HTML-bestand direct bij de samenvatting (blijft altijd staan)
  const fileName = `transcript-${channelName}-${Date.now()}.html`;
  const html = buildHtml(msgs, { channelName, categorie: meta.categorie || '-', closedByName: meta.closedByName || '-' });
  saveLocal(fileName, html);
  const sent = await target.send({ embeds: [summary], files: [new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName })] });

  // 2) Extra: ook direct leesbaar in een thread (mag mislukken, het bestand staat er al)
  try {
    const thread = await sent.startThread({ name: `transcript-${channelName}`.slice(0, 100), autoArchiveDuration: 10080, reason: 'Ticket transcript' }).catch(() => null);
    const dest = thread || target;
    const chunks = toChunks(toLines(msgs));
    if (!chunks.length) chunks.push('*Geen berichten.*');
    for (let n = 0; n < chunks.length; n++) {
      const e = new EmbedBuilder().setColor(config.logColor).setDescription(chunks[n]);
      if (n === chunks.length - 1) e.setFooter({ text: config.footerText });
      await dest.send({ embeds: [e], allowedMentions: { parse: [] } });
    }
  } catch (err) { console.error('Transcript-thread mislukt:', err.message); }
  return sent;
}

module.exports = { collectMessages, summaryEmbed, postTranscript };
