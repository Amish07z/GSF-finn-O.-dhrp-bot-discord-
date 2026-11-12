# GSF Den Haag Roleplay - Discord Bot

## Lokaal draaien
1. `npm install`
2. Kopieer `.env.example` naar `.env` en vul TOKEN, CLIENT_ID, GUILD_ID in
3. `npm start`

Controleer wijzigingen vooraf met `npm run check`.

## Code aanpassen
Pas bestanden aan in `commands/` (of `config.js` voor rollen/kanalen), test met `npm start`, en push:
```
git add .
git commit -m "beschrijving van je wijziging"
git push
```
GitHub controleert elke push automatisch (`npm run check`). Met de server-setup hieronder wordt de bot ook automatisch bijgewerkt.

## 24/7 draaien op een eigen server (bijv. Oracle Cloud Always Free, Ubuntu)
```
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2
git clone https://github.com/JOUW_NAAM/GSF-discord-bot.git ~/gsf-bot
cd ~/gsf-bot && npm install --omit=dev
cp .env.example .env && nano .env
pm2 start index.js --name gsf-bot
pm2 save && pm2 startup     # voer het commando uit dat pm2 toont
```
Handig: `pm2 logs gsf-bot`, `pm2 restart gsf-bot`.

### Automatisch updaten bij elke push
Repo > Settings > Secrets and variables > Actions > New repository secret:
- `SSH_HOST` = IP van je server
- `SSH_USER` = gebruikersnaam (bijv. `ubuntu`)
- `SSH_KEY`  = je private SSH key (maak een aparte key voor deployen)

## Eerste keer na de update (panelen plaatsen)
Typ in Discord, als management:
1. `/commands` - plaatst het commands-overzicht in het commands-kanaal
2. `/regels` - plaatst de GSF regels in het regels-kanaal
3. `/portochange <frequentie>` - plaatst het porto-bericht in het porto-kanaal (daarna wordt het bij elke wijziging bewerkt)
4. `/refresh` - plaatst de ledenlijst (optioneel: zet `channels.ledenlijst` in `config.js`)

Bijnaam: `/aangenomen` zet `𝕲𝕾𝕱 | ` voor de naam, `/ontslagen` haalt het weg. De bot heeft hiervoor de permissie **Bijnamen beheren** nodig en zijn rol moet boven de rollen van de leden staan.

## Belangrijk
- `.env` en `data.json` staan in `.gitignore` en komen NIET op GitHub. Houd de repo **private**.
- `data.json` (warns, blacklist, tickets) staat alleen op de server. Maak er af en toe een backup van.
- Lekt je token ooit: resetten in het Developer Portal > Bot > Reset Token.

## Tickets, blacklist, welkom (nieuw)
Zet in `config.js` nog even deze kanaal-/categorie-ID's in (staan als TODO):
- `channels.ticketLogs` = kanaal #ticket-transcript (zonder dit kan een ticket niet gesloten worden)
- `channels.blacklist` = kanaal #blacklist (of typ `/blacklistlijst` in dat kanaal)
- `ticketTypes[partner].categoryId` = categorie voor partner-tickets (leeg = `ticketCategoryId`)

Daarna in Discord: `/ticketpanel <kanaal>`, `/gangregels`, `/blacklistlijst`.
De bot heeft nodig: Kanalen beheren, Draden aanmaken, Berichten sturen in draden, Rollen beheren, Bijnamen beheren.
Voor de welkom-embed moet de **Server Members Intent** aan staan in het Developer Portal.

## Message logs (nieuw)
`messagelog.js` logt in `channels.messageLogs` (config.js): verwijderde berichten (inhoud, auteur, **wie het verwijderde**, bijlagen opnieuw geüpload, bewerkgeschiedenis), bulk-deletes (met .txt-transcript), bewerkte berichten (voor/na + verschil), vastpinnen, reacties, voice, join/leave, bijnaam/rol/timeout-wijzigingen en bans. Opties staan in `config.messageLog`.
- **Zet in het Developer Portal > Bot > "Message Content Intent" AAN**, anders start de bot niet (of zet `messageLog.contentIntent: false`).
- Bot-rechten: kanalen **bekijken** in alle kanalen, **Audit log bekijken** (voor "verwijderd door") en berichten sturen + bestanden bijvoegen in het log-kanaal.
- De bot onthoudt berichten in `msgcache.json` (7 dagen, max `cacheSize`), zodat verwijderde berichten ook na een herstart zichtbaar zijn. Berichten van vóór de bot de cache vulde kunnen niet worden getoond.


## Extra moderatiecommando's

Prefixcommando's werken met zowel `!` als `?`:
- `!ban @lid reden` / `?ban @lid reden`
- `!kick @lid reden` / `?kick @lid reden`
- `!timeout @lid minuten reden` / `?timeout @lid minuten reden`
- `!purge 25` of `!purge all` (ook `?purge`)

Slashcommando's: `/purge`, `/timeout`, `/slowmode`, `/memberinfo` (gang-profiel voor leden, algemene info voor inwoners; vervangt `/userinfo`), `/serverinfo`, `/avatar`, `/roles`, `/uptime`, `/auditlog`, `/role add`, `/role remove`, `/antinuke-whitelist`, `/sync` en `/reload`.

**Discord Developer Portal:** schakel bij Bot > Privileged Gateway Intents de optie **Message Content Intent** in. Prefixcommando's kunnen anders niet gelezen worden. De bot heeft daarnaast passende Discord-rechten nodig (Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Channels, Manage Roles en View Audit Log). De botrol moet boven de rollen staan die hij beheert.

`/purge wipe:true` verwijdert alle berichten uit het gekozen tekstkanaal; het verwijdert het kanaal zelf niet. Berichten ouder dan 14 dagen worden individueel verwijderd omdat Discord die niet in bulk toestaat. `/sync` registreert slashcommando's globaal; globale publicatie kan enige tijd duren.

**Zichtbaarheid-optie:** `/memberinfo`, `/warns`, `/serverinfo`, `/avatar`, `/roles`, `/uptime`, `/ranglijst` en `/serverstatus` hebben een optionele optie `zichtbaarheid` (Iedereen / Alleen ik). Leeg laten = iedereen ziet het antwoord. `/auditlog` en `/antinuke-whitelist` hebben dezelfde optie, maar daar is leeg = alleen jij (gevoelige info). Voeg het aan een ander commando toe met `.addStringOption(addZicht)` en `...vis(i)` in de reply (staat in `utils.js`).

## Changelog (automatisch)
Nieuwe versies verschijnen vanzelf als embed in het changelog-kanaal (`config.channels.changelog`; zolang dat leeg is plaatst de bot niets).
- **Stijl:** een embed in de volgorde ✨ Nieuw, 🔧 Verbeterd, 🐛 Opgelost (🗑️ Verwijderd alleen als je het invult), met bovenin versie, datum, één zin samenvatting en de aantallen. Per sectie staan maximaal 6 punten (`config.changelog.maxPerSection`), de rest wordt "… en N meer". Houd elk punt bij één korte zin (lange regels geven een waarschuwing in `npm run check`).
- **Alleen voor staff, niet publiek:** zet beheer-acties en interne info (rechten instellen, `/sync`, `/reload`, GitHub/npm) in `notes`. Die komen **nooit** in de embed maar als tekstbericht in een staff-kanaal (`config.changelog.staffChannelId`), of anders alleen in de console. `npm run check` weigert interne termen (`/sync`, `/reload`, `npm`, GitHub, `changelog.json`) in de publieke lijsten.
- Alle entries staan in `changelog.json` (oud -> nieuw). Bij het opstarten plaatst `changelog.js` elke entry die nog niet geplaatst is; wat al geplaatst is staat in `changelog-state.json` (staat in `.gitignore`).
- **Nieuwe entry toevoegen:** voeg onderaan `changelog.json` een blok toe met een unieke `id`, `version`, `date` (`JJJJ-MM-DD`), `title`, optioneel `summary` en lijsten `added`, `improved`, `fixed`, `removed` en `notes` (alleen voor staff). Push, en na de herstart staat hij in het kanaal.
- De bot heeft in dat kanaal de rechten *Kanaal bekijken*, *Berichten sturen* en *Embeds insluiten* nodig.
- **Dev-ping:** wil je dat voorhoede7 een echte melding krijgt bij automatisch geplaatste entries, zet dan `config.changelog.pingDev: true` (`updateBy` is aan te passen). De ping staat boven de embed; er staat geen dev-naam meer in de embed zelf.
- `npm run check` (en GitHub) keurt een kapotte `changelog.json` nu af: ontbrekende `id`/`title`, dubbele `id`, slechte `date`.

### Automatische changelog (lokale bestandsanalyse, zonder API)
`changelog-auto.js` vergelijkt bij elke start de bot met de vorige keer (`changelog-snapshot.json` in `DATA_DIR`) en meldt alleen **commando's voor iedereen**: nieuw, verwijderd, of omschrijving/opties/toegang gewijzigd. Interne bestanden, pakketversies, commando's voor staff en wijzigingen aan alleen de werking worden bewust niet gemeld. Wil je dat inwoners iets weten, schrijf dan een handgeschreven entry in `changelog.json`. Geen AI, geen internet nodig voor de analyse.
- De allereerste start legt alleen een basis vast; vanaf de volgende update komen de embeds vanzelf.
- Staat er een handgeschreven entry klaar in `changelog.json`, dan gaat die voor en wordt er geen automatische gemaakt.

### Regels accepteren (verify.js)
Nieuwe leden krijgen **niet** meer automatisch de Inwoner-rol. In `✅︱regels-accepteren` (categorie Landingsbaan) plaatst de bot bij het opstarten een regels-embed met een knop; pas na het klikken krijgt iemand de Inwoner-rol en gaan de kanalen open die bij zijn rollen horen.
- Instellingen: `config.verify` (`channelId`, `categoryId`). De tekst staat bovenin `verify.js`; na een wijziging past de bot het bericht bij de volgende start zelf aan.
- **Zichtbaarheid regel je in Discord:** zet bij alle andere kanalen/categorieën *Kanaal bekijken* uit voor @everyone en aan voor Inwoner (en de andere rollen). Daar kan de bot niets aan veranderen zonder je indeling te slopen.
- `/regelspaneel` (management) plaatst het paneel opnieuw en controleert welke kanalen @everyone nog ziet en of de bot-rol boven Inwoner staat. Met `rechten:Ja` zet hij het regels-kanaal alleen-lezen voor @everyone en verborgen voor Inwoners.
- De bot heeft **Rollen beheren** nodig en zijn rol moet boven Inwoner staan.

### Zelf een changelog plaatsen: `/changelog`
Alleen voor de server-eigenaar en `config.antinukeAdminIds` (`level` in `commands/changelog.js`). Vul `titel` in (en optioneel `versie` en `samenvatting`); daarna opent een formulier met vijf vakken: ✨ Nieuw, 🔧 Verbeterd, 🐛 Opgelost, 🗑️ Verwijderd en 🔒 Alleen staff (komt niet in de embed). Eén punt per regel, `**vet**` en `` `code` `` werken. Leeg laten mag, minstens één vak moet gevuld zijn. De embed komt direct in het changelog-kanaal, in dezelfde stijl als de automatische.
