require('dotenv').config();

module.exports = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  // Anti-nuke-admins: mogen /antinuke beheren en hebben overal toegang (ook zonder rol).
  antinukeAdminIds: [
    '1368042261064974457', // voorhoede7 (admin, krijgt GEEN DM's)
    '1076617457327939656', // finn_oester
    '1503420542982684764', // oestertrollie
    '1219657945223266366', // aapje_nl_
  ],
  // Wie ALLE anti-nuke-meldingen in de DM krijgt (los van de admin-lijst hierboven)
  antinukeDmIds: [
    '1076617457327939656', // finn_oester
    '1503420542982684764', // oestertrollie
    '1219657945223266366', // aapje_nl_
  ],
  antinukeWhitelistRoleIds: ['1563527895966810122'], // deze rol is altijd vrijgesteld van anti-nuke
  serverName: 'GSF Den Haag Roleplay',
  // Backup-/bezwaarserver (optioneel). De bot moet in die server zitten. Discord laat bots alleen DM'en naar mensen met wie ze minstens één
  // server delen; wie hier lid van blijft, krijgt ook na een ban/kick/unban nog DM's. Plak hier een permanente uitnodigingslink.
  appealInviteUrl: '',
  footerText: 'GSF • Den Haag Roleplay', // footer onder alle embeds
  color: 0xc0392b, // GSF rood
  logColor: 0x2ecc70, // GSF groen: groene balk van de logs/panelen

  // Verse start: bij het opstarten worden EENMALIG de oude bericht-cache en changelog-onthoud-bestanden gewist (data.json blijft). Nog een keer? Verhoog dit getal.
  freshStart: '1',

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
    channelId: '1570575371370369124',  // ✅︱regels-accepteren
    categoryId: '',                    // categorie "Landingsbaan" (optioneel: kanaal-ID van de categorie waar het regels-kanaal in hoort)
  },

  // Inwoner-rol: wordt gegeven zodra iemand in het regels-kanaal op de knop drukt (NIET meer automatisch bij het joinen).
  // Leeg laten = de bot zoekt een rol met de naam "Inwoner".
  inwonerRoleId: '1570595079347896360',

  // Actief-rol: gaat weg bij /afwezig en komt terug bij /aanwezig
  actiefRoleId: '1570812679877034206',  // Actief-rol
  // Non-actief-rol: komt automatisch bij /afwezig en gaat weg bij /aanwezig
  nonActiefRoleId: '1570812650462642349',  // Non-actief-rol

  // ===== GANG RANGEN (laagste -> hoogste) =====
  gangRoleId: '1567526057186435154', // GSF (basisrol voor alle leden)

  // GSF Lead = leiding-rol. Wordt automatisch gegeven vanaf deze rang, en weggehaald bij een lagere rang of ontslag.
  leadRoleId: '1570589012203151390', // GSF Lead (staat in Discord tussen Street Soldier en Underboss)
  leadFromRank: 'Underboss',
  ranks: [
    { name: 'Look Around',    id: '1563529024288854017', emoji: '👀' },
    { name: 'Hang Around',    id: '1563528954218811422', emoji: '⏳' },
    { name: 'Associate',      id: '1563528906978492567', emoji: '🤝' },
    { name: 'Prospect',       id: '1563528841417466027', emoji: '🔰' },
    { name: 'Soldier',        id: '1563528798664925264', emoji: '🪖' },
    { name: 'Street Soldier', id: '1563528654493982750', emoji: '⚔️' },
    { name: 'Underboss',      id: '1563528555453743206', emoji: '🛡️' },
    { name: 'Boss',           id: '1563528374650015875', emoji: '👑' },
  ],

  // ===== BEHEERRECHTEN =====
  // Management: promo/demote/ontslagen/aangenomen/blacklist/ban/ticketpanel/etc.
  managementRoleIds: [
    '1563528374650015875', // Boss
    '1563528555453743206', // Underboss
  ],
  // Staff: warn/mute/clear/tickets beheren/etc. Begint bij de GSF Lead-rol (leadRoleId, hierboven) en alles daarboven.
  // Extra rollen die staff mogen zijn kun je hier nog toevoegen (leeg = alleen Lead en hoger).
  staffRoleIds: [],
  // Rol die iemand krijgt bij /blacklist (optioneel, laat leeg = geen rol)
  blacklistRoleId: '',

  // ===== KANALEN (kanaal-ID's, leeg = fallback naar het kanaal waar het commando is gebruikt) =====
  channels: {
    logs: '1570578272545275904',      // 🤖︱logs: alle bot-logs (aangenomen, ontslagen, porto, tickets, ...)
    messageLogs: '1570578321589407764', // 🤖︱message-logs: verwijderde/bewerkte berichten, reacties, voice, leden, bans (zie messageLog hieronder)
    commands: '1570578370482143232',  // 🤖︱commands: /commands plaatst hier het commands-overzicht
    porto: '1570576911422464110',     // 📻︱porto: het "GSF Gang Porto" paneel (wordt aangepast door /portochange)
    regels: '1570577005781590097',    // 📚︱regels: /regels plaatst hier de GSF regels
    ledenlijst: '1570574398367465513', // 📃︱leden-lijst (live bijgewerkt; wordt automatisch geplaatst als hij er nog niet staat)
    aangenomen: '1570574601799336006', // ✅︱aangenomen: logs bij /aangenomen en bij aannemen via sollicitatie
    ontslagen: '1570574676638302309',  // ❌︱ontslagen: logs bij /ontslagen
    promoties: '1570577092997812265',  // 🎖️︱promotie: /promo announcements
    demoties: '1570577143107166278',   // ⬇️︱demotie: /demote announcements (leeg = ook in het promotie-kanaal)
    warns: '1570577190532415660',      // ❌︱warn: elke /warn wordt hier ook geplaatst (leeg = niet)
    afwezig: '1570577508951261254',    // 😴︱afwezig (het overzicht staat hier; zie afwezigOverzicht)
    afwezigOverzicht: '1570577508951261254', // 😴︱afwezig: 1 vast overzicht-embed van wie afwezig is (wordt automatisch bijgewerkt, geen losse embeds)
    ticketLogs: '1570578225589915840', // ✉️︱ticket-transcript (transcripts van gesloten tickets)
    blacklist: '1570574730216349796',  // 🚫︱blacklist (hier komt de blacklist-lijst, 1 embed die wordt bijgewerkt)
    gangregels: '',    // TODO: kanaal-ID voor de gang-regels (leeg = /gangregels plaatst ze in het kanaal waar je het typt)
    status: '1570574284177547354',     // 📊︱status: sollicitatie-status paneel
    welkom: '1564704093874815117',     // 👋🏼︱welkom: welkom-embed bij elke nieuwe member
    changelog: '1570575571493060688',  // 🤖︱bot-updates: hier komen de changelogs
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
    { key: 'sollicitatie', label: 'Sollicitatie', description: 'Solliciteer bij GSF', emoji: '📝', categoryId: '1564710163489751162', form: true },
    { key: 'partner', label: 'Partner', description: 'Vraag een partnership aan', emoji: '🤝', categoryId: '1563527755549904959' }, // categorie voor partner-tickets
  ],

  // FiveM server (optioneel, voor /serverstatus). Bijv: 'http://123.45.67.89:30120'
  fivemUrl: '',
};

// Bij /ontslagen worden alle rang-rollen + de GSF-rol verwijderd
module.exports.dienstRoleIds = [...module.exports.ranks.map((r) => r.id), module.exports.gangRoleId, module.exports.leadRoleId, module.exports.actiefRoleId, module.exports.nonActiefRoleId].filter(Boolean);
