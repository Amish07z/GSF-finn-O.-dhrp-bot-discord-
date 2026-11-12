require('dotenv').config();

module.exports = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  antinukeAdminIds: ['1368042261064974457'], // voorhoede7: beheert de anti-nuke en krijgt alle anti-nuke-meldingen in zijn DM
  antinukeWhitelistRoleIds: ['1567817981428502528'], // DEV-rol is altijd vrijgesteld van anti-nuke
  serverName: 'GSF Den Haag Roleplay',
  // Backup-/bezwaarserver (optioneel). De bot moet in die server zitten. Discord laat bots alleen DM'en naar mensen met wie ze minstens één
  // server delen; wie hier lid van blijft, krijgt ook na een ban/kick/unban nog DM's. Plak hier een permanente uitnodigingslink.
  appealInviteUrl: '',
  footerText: 'GSF • Den Haag Roleplay', // footer onder alle embeds
  color: 0xc0392b, // GSF rood
  logColor: 0x2ecc70, // GSF groen: groene balk van de logs/panelen

  // Changelogs: nieuwe entries uit changelog.json worden bij het opstarten automatisch in channels.changelog geplaatst.
  changelog: {
    pingDev: false, // true = voorhoede7 krijgt ook echt een melding bij automatisch geplaatste entries
  },

  // Bijnaam-prefix: wordt voor de naam gezet bij /aangenomen en weggehaald bij /ontslagen
  namePrefix: '𝕲𝕾𝕱 | ',
  oldNamePrefixes: [], // oude prefix(en): worden ook weggehaald/vervangen bij /aangenomen en /ontslagen
  maxWarns: 3,      // /warn <nummer> accepteert 1 t/m maxWarns
  bijnaVolPlekken: 3, // sollicitatie-status wordt "Bijna vol" bij maximaal zoveel vrije plekken
  maxMembers: 0,    // start-waarde max gangleden (0 = geen limiet). Aanpassen kan met /editmax

  // Zet EENMALIG op true en herstart de bot als commando's voor sommige rollen onzichtbaar zijn. Daarna weer op false zetten en opnieuw pushen.
  resetCommands: false,

  // Regels accepteren: nieuwe leden zien alleen dit kanaal en krijgen pas de Inwoner-rol na het klikken op de knop (verify.js)
  verify: {
    channelId: '1570057402768822282',  // ✅︱regels-accepteren
    categoryId: '1567269934747090977', // Landingsbaan
  },

  // Inwoner-rol: wordt gegeven zodra iemand in het regels-kanaal op de knop drukt (NIET meer automatisch bij het joinen).
  // Leeg laten = de bot zoekt een rol met de naam "Inwoner".
  inwonerRoleId: '1567269932515852291',

  // Actief-rol: gaat weg bij /afwezig en komt terug bij /aanwezig
  actiefRoleId: '1567269932918378607',
  // Non-actief-rol: komt automatisch bij /afwezig en gaat weg bij /aanwezig
  nonActiefRoleId: '1567269932918378601',

  // ===== GANG RANGEN (laagste -> hoogste) =====
  gangRoleId: '1567269932918378602', // GSF (basisrol voor alle leden)

  // GSF Lead = leiding-rol. Wordt automatisch gegeven vanaf deze rang, en weggehaald bij een lagere rang of ontslag.
  leadRoleId: '1567269932918378603',
  leadFromRank: 'Brother',
  ranks: [
    { name: 'Hang Around',    id: '1567274843714486408', emoji: '⏳' },
    { name: 'Lookout',        id: '1567269932989816873', emoji: '👀' },
    { name: 'Runner',         id: '1567269932989816874', emoji: '🏃' },
    { name: 'Street Soldier', id: '1567269932989816875', emoji: '🪖' },
    { name: 'Street Capo',    id: '1567269932989816876', emoji: '⚔️' },
    { name: 'Brother',        id: '1567269932989816877', emoji: '🤝' },
    { name: 'Chief Enforcer', id: '1567269932989816878', emoji: '🛡️' },
    { name: 'Big Brother',    id: '1567269932989816879', emoji: '👑' },
  ],

  // ===== BEHEERRECHTEN =====
  // Management: promo/demote/ontslagen/aangenomen/blacklist/ban/ticketpanel/etc.
  managementRoleIds: [
    '1567269932989816879', // Big Brother
    '1567269932989816878', // Chief Enforcer
  ],
  // Staff: warn/mute/clear/tickets beheren/etc. Begint bij de GSF Lead-rol (leadRoleId, hierboven) en alles daarboven.
  // Extra rollen die staff mogen zijn kun je hier nog toevoegen.
  staffRoleIds: [
    '1567269932989816877', // Brother
  ],
  // Rol die iemand krijgt bij /blacklist (optioneel, laat leeg = geen rol)
  blacklistRoleId: '',

  // ===== KANALEN (kanaal-ID's, leeg = fallback naar het kanaal waar het commando is gebruikt) =====
  channels: {
    logs: '1568004384602853536',      // alle bot-logs (aangenomen, ontslagen, porto, tickets, ...)
    messageLogs: '', // 💬 TODO: kanaal-ID voor de message-logs: verwijderde/bewerkte berichten, reacties, voice, leden, bans (zie messageLog hieronder)
    commands: '1568003929265021000',  // /commands plaatst hier het commands-overzicht (zie opmerking in het antwoord: ID eindigt op 000, check!)
    porto: '1567269935527366695',     // het "GSF Gang Porto" paneel (wordt aangepast door /portochange)
    regels: '1569400291911143424',    // /regels plaatst hier de GSF regels
    ledenlijst: '',                   // de ledenlijst (live bijgewerkt). Leeg = /refresh plaatst hem in het kanaal waar je het typt
    aangenomen: '1567901313168048198', // ✅︱aangenomen: logs bij /aangenomen en bij aannemen via sollicitatie
    ontslagen: '1567901328305426542',  // ❌︱ontslagen: logs bij /ontslagen
    promoties: '',     // /promo en /demote announcements
    afwezig: '',       // /afwezig en /aanwezig meldingen
    afwezigOverzicht: '1568028895310127154', // non-actief: live overzicht van wie afwezig is (embed wordt automatisch bijgewerkt)
    ticketLogs: '1568004866507276389', // ✉️︱ticket-transcript (transcripts van gesloten tickets)
    blacklist: '1568005409988415518', // #blacklist (hier komt de blacklist-lijst, 1 embed die wordt bijgewerkt)
    gangregels: '1567269935753990236', // /gangregels plaatst hier de gang-regels (rijden, rippen, ruzies)
    status: '',        // TODO: kanaal-ID van #status (leeg = /status plaatst het in het kanaal waar je het typt)
    welkom: '1567269934747090979',     // welkom-embed bij elke nieuwe member
    changelog: '',     // TODO: kanaal-ID van het changelog-kanaal (leeg = changelogs worden nog niet geplaatst)
  },

  // ===== MESSAGE LOGS (messagelog.js) =====
  messageLog: {
    enabled: true,
    contentIntent: true,     // zet op false als "Message Content Intent" NIET aan staat in het Developer Portal (dan zijn berichtteksten onzichtbaar)
    ignoreBots: false,       // andere bots negeren (de bot zelf wordt altijd genegeerd)
    ignoredChannels: [],     // kanaal-ID's die je niet gelogd wilt hebben
    ignoredCategories: [],   // categorie-ID's (bijv. staff-categorie)
    ignoredUsers: [],        // user-ID's
    saveAttachments: true,   // bijlagen van verwijderde berichten opnieuw uploaden in de log
    cacheSize: 5000,         // aantal berichten dat de bot onthoudt (nodig om verwijderde berichten terug te kunnen zien)
    events: {
      create: false,         // elk nieuw bericht loggen (erg druk) - standaard uit
      delete: true, bulkDelete: true, edit: true, pin: true,
      reactions: true, voice: true, members: true, bans: true,
    },
  },

  // Fallback-categorie voor tickets zonder eigen categorie (category-ID, optioneel)
  ticketCategoryId: '',

  // Ticket-categorieën in het dropdown-menu. categoryId = categorie waarin de tickets van dit type komen.
  ticketTypes: [
    { key: 'sollicitatie', label: 'Sollicitatie', description: 'Solliciteer bij GSF', emoji: '📝', categoryId: '1568009181795983412', form: true },
    { key: 'partner', label: 'Partner', description: 'Vraag een partnership aan', emoji: '🤝', categoryId: '1568009222833045645' }, // categorie voor partner-tickets
  ],

  // FiveM server (optioneel, voor /serverstatus). Bijv: 'http://123.45.67.89:30120'
  fivemUrl: '',
};

// Bij /ontslagen worden alle rang-rollen + de GSF-rol verwijderd
module.exports.dienstRoleIds = [...module.exports.ranks.map((r) => r.id), module.exports.gangRoleId, module.exports.leadRoleId, module.exports.actiefRoleId, module.exports.nonActiefRoleId].filter(Boolean);
