// Vaste berichten van de bot: porto, regels, commands-overzicht, ledenlijst.
// Ze worden gemaakt met een commando en daarna BEWERKT (niet opnieuw geplaatst), zoals de "(bewerkt)" in het porto-kanaal.
const config = require('./config');
const db = require('./db');
const { embed } = require('./utils');

async function getChannel(client, id) {
  if (!id) return null;
  return client.channels.fetch(id).catch(() => null);
}

// Bewerkt het bestaande bericht van dit paneel, of plaatst het voor het eerst.
// want = kanaal uit config (leeg = maakt niet uit), fallback = kanaal om in te plaatsen als er geen config-kanaal is.
async function upsertPanel(client, key, { want = null, fallback = null, adopt = null }, payload) {
  const ref = db.data.panels[key];
  if (ref && (!want || want.id === ref.channelId)) {
    const ch = await getChannel(client, ref.channelId);
    // force: true = altijd vers bij Discord ophalen (de cache kan een al verwijderd bericht nog bevatten)
    const msg = ch ? await ch.messages.fetch({ message: ref.messageId, force: true }).catch(() => null) : null;
    if (msg) {
      try { await msg.edit(payload); return { msg, created: false }; } catch { /* bericht is weg: plaats hieronder opnieuw */ }
    }
  }
  const target = want || fallback;
  if (!target) return null;
  // adopt: is er in het kanaal al een eerder bericht van deze bot (bijv. na verlies van data.json)? Dan dat bericht bewerken i.p.v. een nieuw te plaatsen.
  if (adopt && target.messages) {
    const recent = await target.messages.fetch({ limit: 50 }).catch(() => null);
    const old = recent?.find((m) => m.author.id === client.user.id && adopt(m));
    if (old) {
      try { await old.edit(payload); db.setPanel(key, { channelId: target.id, messageId: old.id }); return { msg: old, created: false }; }
      catch { /* plaats hieronder een nieuw paneel als het oude niet bewerkbaar is */ }
    }
  }
  const msg = await target.send(payload);
  db.setPanel(key, { channelId: target.id, messageId: msg.id });
  return { msg, created: true };
}

// ================= PORTO =================
function buildPorto() {
  const p = db.data.porto;
  const e = embed('📻 GSF Gang Porto', null, config.logColor).addFields(
    { name: 'Huidige frequentie', value: '```\n' + (p ? p.frequentie : 'Niet ingesteld') + '\n```' },
    {
      name: 'Regels',
      value: [
        '> 1. Deel de porto **nooit** met iemand buiten de gang.',
        '> 2. **Iedereen** met een gang-rol moet in de porto zitten.',
        '> 3. Verander de frequentie met `/portochange`.',
      ].join('\n'),
    },
    { name: '​', value: p ? `Laatst gewijzigd: <t:${Math.floor(p.changedAt / 1000)}:R>` : 'Laatst gewijzigd: nog nooit' },
  );
  if (p) e.setTimestamp(p.changedAt);
  return e;
}
async function updatePortoPanel(client) {
  const want = await getChannel(client, config.channels.porto);
  if (config.channels.porto && !want) throw new Error('Porto-kanaal niet gevonden (check channels.porto in config.js)');
  return upsertPanel(client, 'porto', { want, adopt: (m) => m.embeds.some((e) => /GSF Gang Porto/i.test(e.title || '')) }, { embeds: [buildPorto()] });
}

// ================= REGELS =================
const nr = (lines) => lines.map((l, n) => `**${n + 1}:** ${l}`).join('\n');

function buildRegels() {
  const e1 = embed('📜 GSF Regels',
    `<@&${config.gangRoleId}>\n\nAls je aangenomen word tot proefperiode dien je akkoord te gaan met alle onderstaande regels! En zal jij je hier aan moeten houden.\nZodra dit niet gebeurd, zal dit negatieve gevolgen hebben.`, config.logColor)
    .addFields(
      {
        name: 'Algemeen',
        value: nr([
          'Als je GSF wilt verlaten overleg je dat eerst met Lead.',
          'Je geeft nooit informatie over GSF aan andere spelers/politie, gebeurt dit wel word je per direct uit GSF gegooit en opgespoort ingame.',
          'Je gaat niet met andere gangs om (alleen met toestemming van Lead).',
          'Je brengt nooit iemand zomaar naar ons ganghuis/andere gebieden van GSF. Alleen met toestemming van Lead, gebeurt dit wel word je gekicked en opgespoort ingame.',
        ]),
      },
      {
        name: 'Regels omtrent discord',
        value: nr([
          'Het is verboden om ingame informatie te verkrijgen via de discord. (denk hierbij aan ik heb een revive nodig ben dood of ben net geript door...)',
          'Het is verboden om van een call gebruik te maken terwijl je ingame bent. Je joined Altijd GSF Ingame Voice in de gang discord als je ingame bent! (met uitzondering van redzone of een andere server)',
          'Het is verboden om leden te kleineren en of te pesten. Als jij je gepest voelt neem dan contact op met Lead.',
        ]),
      },
      {
        name: 'Regels omtrent porto/portoprotocollen',
        value: nr([
          'Als er meerdere personen in de gang porto zitten zeg je alleen iets als het belangrijk is. Geen onnodige onzin praat bijv: ik heb zoveel geld en auto’s etc.',
          'Je luistert ten alle tijden naar Lead als hij iets wil zeggen is het stil.',
          'Als de porto geïnfiltreerd is of lijkt door politie of andere spelers zeg je dat. Dan zal de persoon met de hoogste rang het nieuwe porto kanaal aangeven in de GSF Discord.',
          'Je geeft nooit ons porto nummer door aan andere mensen zonder toestemming van Lead. (zodra je iemand buiten GSF mee wil chillen ga je in een ander porto kanaal).',
        ]),
      },
    );

  const e2 = embed('🕶️ GSF Onderwereld Regels', nr([
    'Ga je ingame of ben je ingame? Ben je verplicht om GSF ingame voice te joinen in de gang discord van Denhaag.',
    'Ben je dood of word je geript werk je netjes mee en MAG je 7 sec tijd rekken. Na dat je bent geript call je het rustig in porto en hunten wij die flikkers die jou hebben geript.',
    'Verbreek jij een onderwereld regel, bijvoorbeeld niet ingame voice gaan krijg je een per directe warn met een notatie erbij.',
  ]), config.logColor).addFields(
    {
      name: 'Contacten/connecties',
      value: nr([
        'Je mag alleen contacten binnen de overheid hebben als die in het voordeel zijn van GSF bijvoorbeeld dat ze informatie geven of andere voordelen. Verder niet.',
        'Contacten binnen andere organisaties mogen alleen als je dit aangeeft bij Lead.',
      ]),
    },
    {
      name: '​',
      value: 'Bij overtreding van een regel zal er een sanctie kunnen worden opgelegd. De straf hangt van de situatie af, dit kan van mondelingen waarschuwing oplopen tot een kick. Bij de meeste gevallen word je opgespoort ingame en vermoord ingame.',
    },
  );
  return [e1, e2];
}
async function postRegels(client) {
  const want = await getChannel(client, config.channels.regels);
  if (!want) throw new Error('Regels-kanaal niet gevonden (check channels.regels in config.js)');
  return upsertPanel(client, 'regels', { want, adopt: (m) => m.embeds.some((e) => /GSF Regels|GSF Onderwereld Regels/i.test(e.title || '')) }, { embeds: buildRegels() });
}

// ================= GANG REGELS (rijden / rippen / ruzies) =================
function buildGangregels() {
  return embed('📋 GSF Gang Regels', null, config.logColor).addFields(
    {
      name: 'Met ze alle rijden',
      value: '> We moeten ten allen tijden met z\'n allen rijden wanneer we activeren. Dit is zo omdat we elkaar dan ten alle tijden kunnen backen en in moeilijke situaties met ze alle bij elkaar zijn waardoor we meer fights winnen.',
    },
    {
      name: 'Rippen',
      value: '> Wanneer iemand een persoon benen heeft dient hij die persoon ook te hands-uppen. De rest moet in z\'n voertuig 360 houden om het scenario heen zodat we niet als floppers allemaal gefeegd kunnen worden.',
    },
    {
      name: 'Rippen met reden',
      value: '> Als iemand zegt we hebben reden moet die persoon clip hebben. Indien we geen clip hebben kunnen we hier niet op handhaven wegens gang-strike.',
    },
    {
      name: 'Ruzies',
      value: '> Als je ruzie hebt met iemand binnen de gang moet je een ticket aanmaken. Dan zal Lead ernaar kijken en bijbehorende sancties geven (rol maakt niet uit).',
    },
  );
}
async function postGangregels(client) {
  const want = await getChannel(client, config.channels.gangregels);
  if (!want) throw new Error('Gangregels-kanaal niet gevonden (check channels.gangregels in config.js)');
  return upsertPanel(client, 'gangregels', { want, adopt: (m) => m.embeds.some((e) => /GSF Gang Regels/i.test(e.title || '')) }, { embeds: [buildGangregels()] });
}

// ================= BLACKLIST-LIJST (1 embed, wordt bijgewerkt) =================
const dtNL = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year}, ${p.hour}:${p.minute}`;
};
function verloopt(until) {
  if (!until) return '**Permanent**';
  const mins = Math.max(0, Math.floor((until - Date.now()) / 60000));
  return `**${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}u ${mins % 60}m (${dtNL(until)})**`;
}
async function buildBlacklist(client) {
  const list = db.getBlacklist();
  const blocks = [];
  for (const b of list) {
    const name = b.tag || (await client.users.fetch(b.userId).then((u) => u.username).catch(() => null)) || b.userId;
    blocks.push(`🚫 **${name}** (<@${b.userId}>)\n➤ Verloopt: ${verloopt(b.until)}\n➤ Reden: ${b.reason}`);
  }
  const head = `**Totaal:** ${list.length} geblacklist`;
  if (!blocks.length) return [embed('🚫 GSF Blacklist', `${head}\n\nMomenteel staat er niemand op de blacklist.`, config.logColor)];
  // Past alles niet in 1 embed (4096 tekens)? Dan een tweede embed in hetzelfde bericht.
  const pages = []; let cur = head;
  for (const b of blocks) {
    if ((cur + '\n\n' + b).length > 3900) { pages.push(cur); cur = b; } else cur += '\n\n' + b;
  }
  pages.push(cur);
  return pages.slice(0, 10).map((d, n) => embed(n === 0 ? '🚫 GSF Blacklist' : null, d, config.logColor));
}
async function updateBlacklistPanel(client, fallback = null) {
  const want = await getChannel(client, config.channels.blacklist);
  return upsertPanel(client, 'blacklist', { want, fallback, adopt: (m) => m.embeds.some((e) => /GSF Blacklist/i.test(e.title || '')) }, { embeds: await buildBlacklist(client) });
}

// ================= AFWEZIGHEID-OVERZICHT (1 embed, wordt bijgewerkt) =================
function buildAfwezig() {
  const list = db.getAbsent();
  const blocks = list.map((a) => `🏖️ **${a.tag || a.userId}** (<@${a.userId}>)\n➤ Van: **${a.van}**\n➤ Tot: **${a.tot}**\n➤ Reden: ${a.reden}`);
  const head = `**Totaal:** ${list.length} afwezig`;
  if (!blocks.length) return [embed('🏖️ GSF Afwezigheid', `${head}\n\nMomenteel is er niemand afwezig.`, config.logColor)];
  const pages = []; let cur = head;
  for (const b of blocks) {
    if ((cur + '\n\n' + b).length > 3900) { pages.push(cur); cur = b; } else cur += '\n\n' + b;
  }
  pages.push(cur);
  return pages.slice(0, 10).map((d, n) => embed(n === 0 ? '🏖️ GSF Afwezigheid' : null, d, config.logColor));
}
async function updateAfwezigPanel(client, fallback = null) {
  const want = await getChannel(client, config.channels.afwezigOverzicht);
  const oldRef = db.data.panels.afwezig;
  const res = await upsertPanel(client, 'afwezig', { want, fallback, adopt: (m) => m.embeds.some((e) => /GSF Afwezigheid/i.test(e.title || '')) }, { embeds: buildAfwezig() });
  if (res?.msg) {
    // Kanaal veranderd? Dan het oude overzicht-bericht opruimen
    if (oldRef && oldRef.channelId !== res.msg.channelId) {
      const oc = await getChannel(client, oldRef.channelId);
      await oc?.messages?.delete(oldRef.messageId).catch(() => {});
    }
    // Oude losse meldingen van de bot (🏖️ Afwezigheidsmelding / ✅ Weer aanwezig) uit het kanaal halen
    const recent = await res.msg.channel.messages.fetch({ limit: 100 }).catch(() => null);
    const stray = recent?.filter((m) => m.id !== res.msg.id && m.author.id === client.user.id && m.embeds.some((e) => /Afwezigheidsmelding|Weer aanwezig/i.test(e.title || '')));
    for (const m of stray?.values() || []) await m.delete().catch(() => {});
  }
  return res;
}

// ================= SOLLICITATIE STATUS =================
const STATUSSEN = {
  open:  { icon: '🟢', naam: 'Open',      uitleg: 'Er is ruimte voor nieuwe sollicitaties.' },
  bijna: { icon: '🟠', naam: 'Bijna vol', uitleg: 'Er is nog beperkt ruimte. Wees snel!' },
  vol:   { icon: '🔴', naam: 'Vol',       uitleg: 'We nemen momenteel geen nieuwe sollicitaties aan.' },
};
// Automatisch: op basis van het aantal gangleden en het maximum (/editmax). Anders de handmatig gekozen status.
function bepaalStatus(count, max) {
  const mode = db.data.statusMode || 'auto';
  if (mode !== 'auto' && STATUSSEN[mode]) return mode;
  if (!(max > 0)) return 'open';
  const vrij = max - count;
  if (vrij <= 0) return 'vol';
  return vrij <= config.bijnaVolPlekken ? 'bijna' : 'open';
}
async function buildStatus(guild) {
  const count = await gangCount(guild);
  const max = db.data.maxMembers;
  const key = bepaalStatus(count, max);
  const s = STATUSSEN[key];
  const lijst = Object.entries(STATUSSEN).map(([k, v]) => (k === key ? `${v.icon} **${v.naam}** — ${v.uitleg}` : `${v.icon} ${v.naam} — ${v.uitleg}`)).join('\n');
  const d = `**Huidige status**\n${s.icon} **${s.naam}**\n\n`
    + `**Gangleden:** ${count}${max > 0 ? ` / ${max}` : ''} leden\n`
    + `**Vrije plekken:** ${max > 0 ? Math.max(0, max - count) : 'onbeperkt'}\n\n`
    + `**Statussen**\n${lijst}`;
  return embed('📝 Sollicitatie Status', d, config.logColor);
}
async function updateStatusPanel(client, guild, fallback = null) {
  const want = await getChannel(client, config.channels.status);
  return upsertPanel(client, 'status', { want, fallback, adopt: (m) => m.embeds.some((e) => /Sollicitatie Status/i.test(e.title || '')) }, { embeds: [await buildStatus(guild)] });
}

// ================= WELKOM =================
function buildWelkom(member) {
  const d = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Amsterdam' });
  return embed('👋 WELKOM!', `Welkom ${member} in de **GSF** Discord server!`, config.logColor)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '📊 Totaal aantal leden', value: String(member.guild.memberCount), inline: true },
      { name: '📅 Datum', value: d, inline: true },
      ...(config.appealInviteUrl ? [{ name: '📩 Blijf bereikbaar', value: `Join ook onze backup-server: ${config.appealInviteUrl}`, inline: false }] : []),
    );
}

// ================= COMMANDS OVERZICHT =================
const OVERZICHT = [
  ['🛠️ Algemeen & Beheer', [
    ['/refresh', 'Plaats de ledenlijst één keer (daarna werkt hij zichzelf live bij)'],
    ['/afwezig <reden> <van> <tot>', 'Meld je afwezigheid (Actief-rol weg, Non-actief-rol erbij)'],
    ['/aanwezig', 'Meld je weer aanwezig (Actief-rol terug, Non-actief-rol weg)'],
    ['/memberinfo [user]', 'Bekijk gang-profiel of algemene info over een lid'],
    ['/ranglijst', 'Toon alle GSF-leden per rang'],
    ['/warns [user]', 'Bekijk de waarschuwingen van een lid'],
    ['/serverinfo', 'Bekijk serverinformatie'],
    ['/serverstatus', 'Bekijk de status van de FiveM server'],
    ['/avatar [user]', 'Bekijk een avatar op volledige grootte'],
    ['/roles', 'Toon alle serverrollen zonder ze te taggen'],
    ['/uptime', 'Bekijk hoelang de bot online is'],
  ]],
  ['🛡️ Moderatie', [
    ['/ban <user> <reden>', 'Ban een lid'],
    ['/unban <speler> <reden>', 'Unban een speler (kies uit de lijst)'],
    ['/kick <user> <reden>', 'Kick een lid'],
    ['/timeout <user> <minuten> <reden>', 'Geef een timeout'],
    ['/untimeout <speler> [reden]', 'Haal een timeout weg (kies uit de lijst)'],
    ['/mute <user> <minuten> [reden]', 'Mute een lid'],
    ['/unmute <speler> [reden]', 'Unmute een lid (kies uit de lijst)'],
    ['/clear <aantal>', 'Verwijder recente berichten'],
    ['/clearuser <user> <aantal>', 'Verwijder berichten van één speler'],
    ['/purge <kanaal> <aantal|wipe>', 'Verwijder berichten of wis een kanaalgeschiedenis'],
    ['/slowmode <kanaal> <seconden>', 'Stel slowmode in op een kanaal'],
    ['/lock / /unlock', 'Vergrendel of ontgrendel het kanaal'],
    ['/auditlog', 'Bekijk de laatste 20 auditlog-acties'],
    ['/role add|remove', 'Beheer rollen via een dropdown'],
  ]],
  ['⌨️ Prefix-commando\'s (! of ?)', [
    ['!ban / ?ban', 'Ban met reden'],
    ['!unban / ?unban', 'Unban via gebruikers-ID'],
    ['!kick / ?kick', 'Kick met reden'],
    ['!timeout / ?timeout', 'Timeout, bijv. 30, 30m, 2u of 1d'],
    ['!untimeout / ?untimeout', 'Haal een timeout weg'],
    ['!purge / ?purge', 'Verwijder een aantal berichten of gebruik all'],
    ['!slowmode / ?slowmode', 'Stel slowmode in het huidige kanaal in'],
  ]],
  ['🔐 Beveiliging & Botbeheer', [
    ['/antinuke', 'Beheer anti-nuke beveiliging'],
    ['/antinuke-whitelist', 'Toon alle vrijgestelde gebruikers en rollen'],
    ['/changelog', 'Plaats zelf een changelog'],
    ['/sync', 'Registreer slashcommando’s globaal opnieuw'],
    ['/reload <type> <module>', 'Herlaad een command-, event- of pluginmodule'],
  ]],
  ['👑 Gang Beheer', [
    ['/promo <stappen> <user> <reden>', 'Promoveer een lid'],
    ['/demote <stappen> <user> <reden>', 'Demoveer een lid'],
    ['/aangenomen <user> <rang> <reden>', 'Neem een nieuw lid aan'],
    ['/ontslagen <user> <reden>', 'Ontsla een lid'],
    ['/warn <nummer> <user> <reden>', 'Geef een waarschuwing'],
    ['/removewarn <speler> <nummer> <reden>', 'Trek een waarschuwing in (kies uit de lijst)'],
    ['/blacklist <user> <reden> [duur]', 'Blacklist een gebruiker'],
    ['/unblacklist <speler>', 'Haal van de blacklist (kies uit de lijst)'],
    ['/portochange <frequentie>', 'Wijzig de gang porto'],
    ['/editmax <aantal>', 'Wijzig max gangleden'],
  ]],
  ['🎫 Ticket Beheer', [
    ['/ticketpanel <kanaal>', 'Plaats het ticket paneel'],
    ['/claim', 'Claim het ticket'],
    ['/add <user>', 'Voeg een user toe aan ticket'],
    ['/remove <user>', 'Verwijder een user uit ticket'],
    ['/close <reden>', 'Sluit het ticket (transcript wordt opgeslagen)'],
    ['/rename <naam>', 'Hernoem het ticket kanaal'],
    ['/sollicitatieformulier', 'Stuur het sollicitatieformulier opnieuw in een ticket'],
  ]],
  ['📜 Panelen', [
    ['/commands', 'Plaats of werk dit commands-overzicht bij'],
    ['/regels', 'Plaats of werk de GSF regels bij'],
    ['/gangregels', 'Plaats of werk de gang-regels bij (rijden, rippen, ruzies)'],
    ['/regelspaneel', 'Plaats het regels-accepteren paneel opnieuw'],
    ['/status [status]', 'Plaats of werk de sollicitatie-status bij (automatisch of handmatig)'],
    ['/blacklistlijst', 'Plaats of werk de blacklist-lijst bij'],
  ]],
];
function buildOverzicht(client) {
  const e = embed('📚 Bot Commands Overzicht', 'Hieronder vind je een overzicht van alle beschikbare commands voor de GSF bot.', config.logColor);
  for (const [name, list] of OVERZICHT) e.addFields({ name, value: list.map(([c, d]) => `\`${c}\` — ${d}`).join('\n') });
  e.setFooter({ text: config.footerText, iconURL: client.user.displayAvatarURL() });
  return e;
}
async function postOverzicht(client) {
  const want = await getChannel(client, config.channels.commands);
  if (!want) throw new Error('Commands-kanaal niet gevonden (check channels.commands in config.js; ID goed gekopieerd?)');
  return upsertPanel(client, 'commands', { want, adopt: (m) => m.embeds.some((e) => /Bot Commands Overzicht/i.test(e.title || '')) }, { embeds: [buildOverzicht(client)] });
}

// ================= LEDENLIJST =================
async function ensureMembers(guild) {
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch();
}
async function gangCount(guild) {
  await ensureMembers(guild);
  const role = guild.roles.cache.get(config.gangRoleId);
  return role ? role.members.size : 0;
}
function fitList(items, limit = 1000) {
  let out = '', n = 0;
  for (const it of items) {
    if ((out + ' ' + it).length > limit - 12) break;
    out += (out ? ' ' : '') + it; n++;
  }
  if (!out) return '—';
  return n < items.length ? `${out} …+${items.length - n}` : out;
}
async function buildLedenlijst(guild) {
  await ensureMembers(guild);
  const names = (role) => [...(role?.members.values() || [])].sort((x, y) => x.displayName.localeCompare(y.displayName)).map((m) => m.toString());
  const blocks = [];
  const lead = config.leadRoleId ? guild.roles.cache.get(config.leadRoleId) : null;
  if (lead) { const l = names(lead); blocks.push(`**${lead.name} (leiding)** (${l.length})\n${l.join(' ') || '—'}`); }
  for (const r of [...config.ranks].reverse()) {
    const role = guild.roles.cache.get(r.id);
    const l = names(role);
    blocks.push(`**${role?.name || r.name}** (${l.length})\n${l.join(' ') || '—'}`);
  }
  // Past alles niet in 1 embed (4096 tekens)? Dan een vervolg-embed in hetzelfde bericht.
  const pages = []; let cur = '';
  for (const bl of blocks) {
    if (cur && (cur + '\n\n' + bl).length > 3900) { pages.push(cur); cur = bl; } else cur += (cur ? '\n\n' : '') + bl;
  }
  pages.push(cur);
  return pages.slice(0, 10).map((d, n) => embed(n === 0 ? '📋 GSF Ranglijst' : null, d));
}
async function refreshLedenlijst(client, guild, fallback = null) {
  const want = await getChannel(client, config.channels.ledenlijst);
  return upsertPanel(client, 'ledenlijst', { want, fallback, adopt: (m) => m.embeds.some((e) => /GSF.*ledenlijst|ledenlijst/i.test(e.title || '')) }, { embeds: await buildLedenlijst(guild) });
}
// Na aannemen/ontslaan/promo/demote: lijst bijwerken (kleine vertraging zodat Discord de rollen heeft doorgevoerd)
let ledenTimer = null;
function scheduleLedenlijst(client, guild, delay = 700) {
  clearTimeout(ledenTimer); // meerdere wijzigingen vlak na elkaar = 1 update
  ledenTimer = setTimeout(() => {
    if (db.data.panels.ledenlijst || config.channels.ledenlijst) refreshLedenlijst(client, guild).catch(() => {});
    if (db.data.panels.status) updateStatusPanel(client, guild).catch(() => {}); // status alleen bijwerken als hij al geplaatst is
  }, delay);
}
// Rollen die de ledenlijst beinvloeden (GSF-rol + alle rangen)
const isLedenRole = (id) => id === config.gangRoleId || id === config.leadRoleId || config.ranks.some((r) => r.id === id);

module.exports = {
  buildPorto, updatePortoPanel, buildRegels, postRegels, buildOverzicht, postOverzicht,
  gangCount, buildLedenlijst, refreshLedenlijst, scheduleLedenlijst,
  isLedenRole, buildGangregels, postGangregels, buildStatus, updateStatusPanel, buildBlacklist, updateBlacklistPanel, buildWelkom, buildAfwezig, updateAfwezigPanel,
};
