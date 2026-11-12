// GSF Den Haag – changelog-poster (stijl: GSF groen, Nieuw / Verbeterd / Opgelost met emoji-kopjes)
// Leest changelog.json en plaatst elke NIEUWE entry als embed in het changelog-kanaal zodra de bot opstart
// (dus automatisch na elke deploy/push). Reeds geplaatste entries worden onthouden in changelog-state.json.
const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');
const config = require('./config');

// ===== Instellingen (kunnen overschreven worden in config.js via config.channels.changelog / config.changelog) =====
const CFG = {
  channelId: config.channels?.changelog || config.changelog?.channelId || '',
  author: { name: 'voorhoede7', id: '1368042261064974457', ...(config.changelog?.author || {}) },
  updateBy: config.changelog?.updateBy || '1368042261064974457', // gebruiker die onderaan elke changelog bij "Update door" getagd wordt (voorhoede7)
  pingDev: !!config.changelog?.pingDev, // true = de updater krijgt ook echt een melding (een tag in een embed pingt namelijk niet)
  delayMs: 8000, // even wachten na opstarten, zodat de rest van de bot klaar is
};
// Naam + profielfoto van de dev, live opgehaald zodat een nieuwe foto vanzelf mee verandert
async function devContext(client) {
  const u = await client.users.fetch(CFG.author.id).catch(() => null);
  return {
    botIcon: client.user?.displayAvatarURL?.(),
    authorName: CFG.author.name || u?.displayName || u?.username,
    authorIcon: u?.displayAvatarURL?.(),
  };
}
const ENTRIES_FILE = path.join(__dirname, 'changelog.json');
const STATE_FILE = path.join(process.env.DATA_DIR || __dirname, 'changelog-state.json');

// Secties in een changelog-entry (sleutel in changelog.json -> kopje in de embed)
const SECTIONS = [
  ['added', '✨ Nieuw'],
  ['improved', '🔧 Verbeterd'],
  ['fixed', '🐛 Opgelost'],
  ['removed', '🗑️ Verwijderd'], // optioneel, alleen zichtbaar als er iets in staat
];
// "notes" (interne notities / beheer-acties) komt NOOIT in de publieke embed, zie sendNotes() hieronder
const COUNT_WORD = { added: 'nieuw', improved: 'verbeterd', fixed: 'opgelost', removed: 'verwijderd' };
const MAX_ITEMS = Math.max(1, Number(config.changelog?.maxPerSection) || 6); // meer punten per sectie -> "… en N meer"
// Interne taal die niet in een publieke changelog thuishoort (npm run check blokkeert dit; zet het in "notes")
const INTERNAL = [/\/(sync|reload)\b/i, /\bnpm\b/i, /\bgithub\b/i, /changelog\.json/i];
const MAX_EMBED = 5500; // Discord: max 6000 tekens per bericht, we houden marge

// ===== Opslag van wat al geplaatst is =====
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { posted: [] }; } }
function writeState(s) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(s, null, 2)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); }

function loadEntries() {
  const raw = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('changelog.json moet een lijst (array) zijn.');
  return raw.filter((e) => e && e.id && e.title);
}

// Streng controleren (draait in check.js / GitHub): loadEntries() slaat kapotte entries stilletjes over, dit niet.
function validate() {
  const raw = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('changelog.json moet een lijst (array) zijn.');
  const ids = new Set();
  const long = [];
  raw.forEach((e, n) => {
    const w = `changelog.json entry #${n + 1}${e?.id ? ` (${e.id})` : ''}`;
    if (!e || !e.id || !e.title) throw new Error(`${w}: "id" en "title" zijn verplicht.`);
    if (ids.has(e.id)) throw new Error(`${w}: dubbele id.`);
    ids.add(e.id);
    if (e.date && Number.isNaN(new Date(e.date + 'T12:00:00Z').getTime())) throw new Error(`${w}: "date" moet JJJJ-MM-DD zijn.`);
    for (const key of [...SECTIONS.map(([k]) => k), 'notes']) if (e[key] !== undefined && !(Array.isArray(e[key]) && e[key].every((t) => typeof t === 'string'))) throw new Error(`${w}: \"${key}\" moet een lijst met tekst zijn.`);
    for (const [key] of SECTIONS) for (const t of e[key] || []) {
      const hit = INTERNAL.find((re) => re.test(t));
      if (t.length > 170 && !long.includes(e.id)) long.push(e.id);
      if (hit) throw new Error(`${w}: \"${key}\" bevat interne info (${hit}). Zet dit in \"notes\" (alleen voor staff): \"${t.slice(0, 60)}…\"`);
    }
  });
  if (long.length) console.warn(`⚠️ Changelog: regels langer dan 170 tekens lezen slecht in Discord (entry: ${long.join(', ')}). Kort ze in tot één zin.`);
  return raw.length;
}

// ===== Embed bouwen =====
function fieldsFor(name, items) {
  const out = []; let cur = '';
  const lines = items.slice(0, MAX_ITEMS).map((t) => `• ${t}`);
  if (items.length > MAX_ITEMS) lines.push(`… en ${items.length - MAX_ITEMS} meer`);
  for (let l of lines) {
    if (l.length > 1000) l = l.slice(0, 997) + '…';
    if (cur && (cur + '\n' + l).length > 1000) { out.push(cur); cur = l; } else cur = cur ? `${cur}\n${l}` : l;
  }
  if (cur) out.push(cur);
  return out.map((value, n) => ({ name: n === 0 ? name : '\u200b', value, inline: false }));
}
const size = (e) => (e.title?.length || 0) + (e.description?.length || 0) + (e.footer?.text.length || 0) + (e.author?.name.length || 0)
  + (e.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);

// Geeft 1 of meer embeds (platte objecten, discord.js accepteert die direct) voor één changelog-entry
function buildEmbeds(entry, ctx = {}) {
  const ts = entry.date ? Math.floor(new Date(entry.date + 'T12:00:00Z').getTime() / 1000) : null;
  const meta = [entry.version ? `**v${entry.version}**` : '', ts ? `<t:${ts}:D>` : ''].filter(Boolean).join('  ·  ');
  const counts = SECTIONS.filter(([k]) => entry[k]?.length).map(([k, label]) => `${label.split(' ')[0]} ${entry[k].length} ${COUNT_WORD[k]}`).join('  ·  ');
  const head = [meta, entry.summary, counts].filter(Boolean).join('\n\n');

  let fields = [];
  for (const [key, label] of SECTIONS) if (Array.isArray(entry[key]) && entry[key].length) fields.push(...fieldsFor(label, entry[key]));

  const base = () => ({
    color: config.logColor || config.color, // GSF groen
    footer: { text: config.footerText || 'GSF • Den Haag Roleplay' },
    ...(ctx.authorName ? { author: { name: ctx.authorName, ...(ctx.authorIcon ? { icon_url: ctx.authorIcon } : {}) } } : {}),
    ...(ts ? { timestamp: new Date(ts * 1000).toISOString() } : {}),
  });

  const first = { ...base(), title: entry.title.slice(0, 256), description: head || undefined, fields: [],
    ...(ctx.botIcon ? { thumbnail: { url: ctx.botIcon } } : {}) };
  const embeds = [first];
  let cur = first;
  for (const f of fields) {
    if (size(cur) + f.name.length + f.value.length > MAX_EMBED || cur.fields.length >= 24) {
      cur = { ...base(), title: `${entry.title} (vervolg)`.slice(0, 256), fields: [] };
      embeds.push(cur);
    }
    cur.fields.push(f);
  }
  // Onderaan de laatste embed: wie de update heeft gedaan (naam + tag)
  const credit = { name: 'Update door', value: `<@${CFG.updateBy}>`, inline: false };
  if (size(cur) + credit.name.length + credit.value.length > MAX_EMBED || cur.fields.length >= 25) {
    cur = { ...base(), title: `${entry.title} (vervolg)`.slice(0, 256), fields: [] };
    embeds.push(cur);
  }
  cur.fields.push(credit);
  return embeds;
}

// ===== Plaatsen =====
// Interne notities (entry.notes) gaan NIET in de publieke embed. Ze worden naar een staff-kanaal gestuurd
// (config.changelog.staffChannelId) of, als dat niet is ingesteld, alleen in de console gelogd.
async function sendNotes(client, entry) {
  if (!entry.notes?.length) return;
  const text = `📌 **Notities bij ${entry.version ? `v${entry.version}` : entry.title}** (alleen voor staff)\n${entry.notes.map((n) => `• ${n}`).join('\n')}`.slice(0, 1900);
  const id = config.changelog?.staffChannelId;
  const ch = id ? await client.channels.fetch(id).catch(() => null) : null;
  if (ch?.isTextBased?.()) await ch.send({ content: text, allowedMentions: { parse: [] } }).catch((e) => console.error('Changelog-notities plaatsen mislukt:', e.message));
  else console.log(`ℹ️ Changelog-notities (niet publiek):\n${text}`);
}

let running = false;
let warnedNoChannel = false;
// force = true: plaatst alles opnieuw (alleen handmatig gebruiken)
async function postPending(client, { force = false } = {}) {
  if (running) return { posted: 0 };
  running = true;
  try {
    const entries = loadEntries();
    const state = readState();
    const todo = entries.filter((e) => force || !state.posted.includes(e.id));
    // Automatische changelog (lokale bestandsanalyse, geen API): alleen als er geen handgeschreven entry klaarstaat
    let auto = null;
    if (!force) { try { auto = require('./changelog-auto').detect(); } catch (e) { console.error('Changelog-auto fout:', e.message); } }
    if (auto?.entry && !todo.length && !state.posted.includes(auto.entry.id)) todo.push(auto.entry);
    if (!todo.length) { auto?.commit(); return { posted: 0 }; }

    // Nog geen changelog-kanaal ingesteld: niets plaatsen en niets onthouden, dus er gaat ook niets verloren
    if (!CFG.channelId) {
      if (!warnedNoChannel) { warnedNoChannel = true; console.warn(`ℹ️ Changelog: ${todo.length} nieuwe entry/entries wachten, maar er is nog geen kanaal ingesteld (zet channels.changelog in config.js).`); }
      return { posted: 0 };
    }
    const ch = await client.channels.fetch(CFG.channelId).catch(() => null);
    if (!ch?.isTextBased?.()) { console.error(`❌ Changelog: kanaal ${CFG.channelId} niet gevonden of geen tekstkanaal (heeft de bot toegang?).`); return { posted: 0 }; }
    const ctx = await devContext(client);

    let posted = 0; let failed = false;
    for (const entry of todo) { // volgorde van changelog.json = oud -> nieuw
      try {
        for (const [n, emb] of buildEmbeds(entry, ctx).entries()) {
          const ping = CFG.pingDev && n === 0; // alleen het eerste bericht van een entry pingt
          await ch.send({
            ...(ping ? { content: `<@${CFG.updateBy}>` } : {}),
            embeds: [emb],
            allowedMentions: ping ? { users: [CFG.updateBy] } : { parse: [] },
          });
        }
        if (!state.posted.includes(entry.id)) state.posted.push(entry.id);
        writeState(state); posted++;
        await sendNotes(client, entry);
      } catch (e) { failed = true; console.error('❌ Changelog plaatsen mislukt:', e.message, '(rechten: Berichten sturen + Embeds insluiten in het kanaal)'); break; }
    }
    if (!failed) auto?.commit(); // foto pas opslaan als alles geplaatst is, anders volgende start opnieuw proberen
    if (posted) console.log(`✅ Changelog: ${posted} entry/entries geplaatst in #${ch.name || CFG.channelId}.`);
    return { posted };
  } finally { running = false; }
}

// Plaatst één entry meteen (voor /changelog). Geeft het eerste bericht terug.
async function postEntry(client, entry) {
  const ch = await client.channels.fetch(CFG.channelId).catch(() => null);
  if (!ch?.isTextBased?.()) throw new Error('changelog-kanaal niet gevonden of geen tekstkanaal (config.channels.changelog; heeft de bot toegang?)');
  const ctx = await devContext(client);
  let first = null;
  for (const emb of buildEmbeds(entry, ctx)) {
    const m = await ch.send({ embeds: [emb], allowedMentions: { parse: [] } });
    first = first || m;
  }
  await sendNotes(client, entry);
  return first;
}

function init(client) {
  const run = () => setTimeout(() => postPending(client).catch((e) => console.error('Changelog fout:', e.message)), CFG.delayMs);
  if (client.isReady()) run(); else client.once(Events.ClientReady, run);
}

module.exports = { postEntry, init, postPending, buildEmbeds, loadEntries, validate };
