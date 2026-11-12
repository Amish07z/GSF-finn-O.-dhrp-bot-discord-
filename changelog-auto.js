// Automatische changelog via LOKALE bestandsanalyse – geen AI, geen externe API, geen internet nodig.
// Werking: bij het opstarten maakt dit een "foto" van de bot (alle commando's met opties/omschrijving/werking + hashes van alle
// .js-bestanden + pakketversies) en vergelijkt die met de foto van de vorige keer (changelog-snapshot.json in DATA_DIR).
// Het verschil wordt een changelog-entry (added/improved/removed) die changelog.js in jouw embed-stijl plaatst.
// Alleen commando's voor iedereen worden gemeld (nieuw, verwijderd, omschrijving/opties gewijzigd). Interne bestanden, pakketten en
// code-only wijzigingen niet: voor alles wat inwoners moeten weten schrijf je een handgeschreven entry in changelog.json.
// Eerste keer: alleen een basis vastleggen, er wordt niets geplaatst.
// Een handgeschreven entry in changelog.json heeft voorrang (dan wordt er geen automatische entry gemaakt).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const ROOT = __dirname;
const SNAP_FILE = path.join(process.env.DATA_DIR || ROOT, 'changelog-snapshot.json');
const ENTRIES_FILE = path.join(ROOT, 'changelog.json');
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'transcripts']);
const SKIP_FILES = new Set(['changelog.js', 'changelog-auto.js', 'check.js']); // de changelog-machine zelf is geen "nieuws"

// Leesbare namen voor interne bestanden (aanpasbaar via config.changelog.fileLabels)
const LABELS = {
  'panels.js': 'Live panelen', 'messagelog.js': 'Message-logs', 'security.js': 'Beveiliging / anti-nuke',
  'transcript.js': 'Ticket-transcripts', 'prefix.js': "Prefix-commando's", 'staff.js': 'Personeelsbeheer',
  'permfix.js': 'Rechtenherstel', 'db.js': 'Gegevensopslag', 'utils.js': 'Hulpfuncties', 'loader.js': 'Commando-registratie',
  'index.js': 'Kern van de bot', 'config.js': 'Instellingen', ...(config.changelog?.fileLabels || {}),
};
const label = (rel) => LABELS[rel] || (rel.startsWith('events/') ? `Event ${path.basename(rel, '.js')}` : rel);

const sha = (s) => crypto.createHash('sha1').update(String(s).replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);

// ===== Foto maken =====
function flatten(opts, prefix = '') {
  const out = {};
  for (const x of opts || []) {
    const k = prefix + x.name;
    out[k] = { t: x.type, r: !!x.required, d: x.description || '', c: (x.choices || []).map((c) => c.name).join(',') };
    if (x.options) Object.assign(out, flatten(x.options, `${k} `));
  }
  return out;
}

function snapCommands() {
  const out = {};
  const dir = path.join(ROOT, 'commands');
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    const mod = require(path.join(dir, f)); // zit al in de require-cache van de draaiende bot
    for (const c of mod.commands || []) {
      const j = c.data.toJSON();
      out[j.name] = { file: `commands/${f}`, level: c.level || null, desc: j.description || '', opts: flatten(j.options), code: sha(c.execute || '') };
    }
  }
  return out;
}

function walk(dir, rel = '') {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out = out.concat(walk(path.join(dir, e.name), r)); }
    else if (e.name.endsWith('.js') && !SKIP_FILES.has(e.name)) out.push(r);
  }
  return out;
}

function snapshot() {
  const files = {};
  for (const rel of walk(ROOT)) files[rel] = sha(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  let deps = {};
  try { const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); deps = { ...p.dependencies }; } catch { /* geen package.json */ }
  return { commands: snapCommands(), files, deps };
}

// ===== Versies =====
const parse = (v) => String(v || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const bump = (v, minor) => { const [a, b, c] = parse(v); return minor ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`; };
function latestManualVersion() {
  try { return JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8')).map((e) => e.version).filter(Boolean).sort(cmp).pop() || '1.0.0'; } catch { return '1.0.0'; }
}

// ===== Verschil -> changelog-entry =====
const LEVEL = { everyone: 'iedereen', staff: 'staff', management: 'management' };
const lvl = (l) => (l && LEVEL[l] ? ` (${LEVEL[l]})` : '');
const q = (s) => `\`${s}\``;

function diff(prev, cur) {
  const added = [], improved = [], removed = [];
  let nAdded = 0, nRemoved = 0, nChanged = 0;

  for (const [n, c] of Object.entries(cur.commands)) {
    const p = prev.commands?.[n];
    const pub = !c.level || c.level === 'everyone'; // alleen commando's die inwoners zelf kunnen gebruiken horen in een publieke changelog
    if (!p) { if (pub) { added.push(`**Nieuw commando ${q('/' + n)}:** ${c.desc}`); nAdded++; } continue; }
    if (!pub) continue;
    const parts = [];
    if (p.desc !== c.desc) parts.push(`omschrijving aangepast (“${c.desc}”)`);
    if (p.level !== c.level) parts.push(`toegang nu: ${LEVEL[c.level] || 'onbekend'}`);
    const po = p.opts || {}, co = c.opts || {};
    for (const k of Object.keys(co)) {
      if (!po[k]) parts.push(`nieuwe optie ${q(k)}${co[k].d ? ` (${co[k].d})` : ''}`);
      else if (JSON.stringify(po[k]) !== JSON.stringify(co[k])) parts.push(`optie ${q(k)} aangepast`);
    }
    for (const k of Object.keys(po)) if (!co[k]) parts.push(`optie ${q(k)} verwijderd`);
    if (parts.length) { improved.push(`**${q('/' + n)}:** ${parts.join(', ')}`); nChanged++; }
  }
  for (const [n, pc] of Object.entries(prev.commands || {})) if (!cur.commands[n] && (!pc.level || pc.level === 'everyone')) { removed.push(`**Commando ${q('/' + n)} verwijderd**`); nRemoved++; }

  // Interne bestanden, pakketversies en commando's voor staff worden bewust NIET gemeld: dat is geen nieuws voor inwoners.

  if (!added.length && !improved.length && !removed.length) return null;
  const bits = [];
  if (nAdded) bits.push(nAdded > 1 ? `${nAdded} nieuwe commando's` : '1 nieuw commando');
  if (nChanged) bits.push(`${nChanged} commando${nChanged > 1 ? "'s" : ''} aangepast`);
  if (nRemoved) bits.push(`${nRemoved} commando${nRemoved > 1 ? "'s" : ''} verwijderd`);
  return { added, improved, removed, minor: nAdded + nRemoved > 0, summary: bits.length ? `${bits.join(', ')}.` : 'Interne verbeteringen en onderhoud.' };
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); // JJJJ-MM-DD

function save(s) {
  fs.mkdirSync(path.dirname(SNAP_FILE), { recursive: true });
  fs.writeFileSync(SNAP_FILE + '.tmp', JSON.stringify(s));
  fs.renameSync(SNAP_FILE + '.tmp', SNAP_FILE);
}

// detect(): { entry, commit } – entry = changelog-entry of null; commit() = foto opslaan (pas aanroepen NA succesvol plaatsen)
function detect() {
  const cur = snapshot();
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')); } catch { /* eerste keer */ }
  const baseVersion = [prev?.version, latestManualVersion()].filter(Boolean).sort(cmp).pop();
  if (!prev) {
    save({ ...cur, version: baseVersion });
    console.log('ℹ️ Changelog-auto: basis vastgelegd; vanaf de volgende update verschijnen wijzigingen automatisch.');
    return { entry: null, commit() {} };
  }
  const d = diff(prev, cur);
  if (!d) return { entry: null, commit: () => { if (JSON.stringify({ ...prev, version: 0 }) !== JSON.stringify({ ...cur, version: 0 })) save({ ...cur, version: baseVersion }); } };
  const version = bump(baseVersion, d.minor);
  const entry = {
    id: `auto-${sha(JSON.stringify(cur))}`, version, date: today(),
    title: 'Nieuwe update', summary: d.summary,
    added: d.added, improved: d.improved, removed: d.removed,
  };
  return { entry, commit: () => save({ ...cur, version }) };
}

module.exports = { detect, diff, snapshot };
