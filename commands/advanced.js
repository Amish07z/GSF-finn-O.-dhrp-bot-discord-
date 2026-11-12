const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, AuditLogEvent, PermissionFlagsBits, Routes, REST, Collection,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');
const { E, embed, hasLevel, levelName, logAction, addZicht, addZichtPrive, vis } = require('../utils');

const commands = [];
const components = [];
const startedAt = Date.now();
// ===== /memberinfo: één commando voor iedereen =====
// Gangmember (GSF-rol / rang / lead) -> gang-profiel (rang, aangenomen, afwezigheid, warns, ...)
// Gewone inwoner of niet in de server -> algemene info (account, rollen, warns, blacklist, ban)
const { isLedenRole } = require('../panels');
const ts = (ms, f = 'R') => `<t:${Math.floor(ms / 1000)}:${f}>`;
const KEY_PERMS = { Administrator: 'Administrator', ManageGuild: 'Server beheren', ManageRoles: 'Rollen beheren', ManageChannels: 'Kanalen beheren', BanMembers: 'Leden bannen', KickMembers: 'Leden kicken', ModerateMembers: 'Timeouts geven' };

async function buildMemberInfo(guild, user, m) {
  const isGang = !!m && [...m.roles.cache.keys()].some(isLedenRole);
  const e = embed(`${isGang ? '🟥' : '🏙️'} ${user.tag}`, null, isGang ? config.color : 0x5865f2)
    .setThumbnail((m || user).displayAvatarURL({ size: 512 }));
  e.setDescription(`${m || user}\n${isGang ? '**GSF-lid**' : m ? '**Inwoner**' : '**Niet in de server**'}`);

  // --- Algemeen ---
  e.addFields(
    { name: 'ID', value: `\`${user.id}\``, inline: true },
    { name: 'Account aangemaakt', value: ts(user.createdTimestamp), inline: true },
    { name: 'Server gejoined', value: m?.joinedTimestamp ? ts(m.joinedTimestamp) : 'Niet in server', inline: true },
  );

  // --- Gang-gedeelte ---
  if (isGang) {
    const ri = (() => { let idx = -1; config.ranks.forEach((r, n) => { if (m.roles.cache.has(r.id)) idx = n; }); return idx; })();
    const rank = ri !== -1 ? config.ranks[ri] : null;
    const lead = !!config.leadRoleId && m.roles.cache.has(config.leadRoleId);
    const hired = db.getHired(user.id);
    const abs = db.data.absent?.[user.id];
    const absLog = (db.data.absences || []).filter((a) => a.userId === user.id);
    const nonActief = !!config.nonActiefRoleId && m.roles.cache.has(config.nonActiefRoleId);

    e.addFields(
      { name: 'Rang', value: rank ? `${rank.emoji} ${rank.name}` : 'Geen rang', inline: true },
      { name: 'Leiding', value: lead ? '✅ GSF Lead' : '—', inline: true },
      { name: 'Status', value: abs ? `🔴 Afwezig` : nonActief ? '🔴 Non-actief' : '🟢 Actief', inline: true },
      { name: 'Aangenomen', value: hired ? `${ts(hired.date, 'D')} (${ts(hired.date)})\ndoor <@${hired.by}> als **${hired.rank}**` : 'Onbekend (aangenomen vóór deze update)', inline: false },
    );
    if (abs) e.addFields({ name: 'Huidige afwezigheid', value: `**Reden:** ${abs.reden}\n**Van:** ${abs.van || '-'} • **Tot:** ${abs.tot || '-'}` });
    e.addFields({ name: 'Afwezigheidsmeldingen', value: absLog.length ? `${absLog.length}x • laatste: ${ts(absLog[absLog.length - 1].date)}` : 'Geen', inline: true });
  }

  // --- Warns & blacklist (voor iedereen) ---
  const warns = db.getWarns(user.id);
  e.addFields({
    name: `Warns (${warns.length}/${config.maxWarns})`,
    value: warns.length ? warns.slice(-3).map((w) => `**#${w.nummer}** • ${ts(w.date, 'd')} • ${String(w.reason).slice(0, 80)}`).join('\n') : 'Geen',
    inline: false,
  });
  const bl = db.isBlacklisted(user.id) ? db.data.blacklist[user.id] : null;
  e.addFields({ name: 'Blacklist', value: bl ? `🚫 Ja: ${bl.reason}${bl.until ? ` (tot ${ts(bl.until, 'd')})` : ' (permanent)'}` : 'Nee', inline: true });
  if (!m) {
    const ban = await guild.bans.fetch(user.id).catch(() => null);
    e.addFields({ name: 'Ban', value: ban ? `🔨 Ja: ${ban.reason || 'geen reden'}` : 'Nee', inline: true });
  }

  // --- Rollen / rechten (alleen als in de server) ---
  if (m) {
    const roles = m.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
    e.addFields({ name: `Rollen (${roles.size})`, value: roles.size ? roles.map((r) => r.toString()).join(' ').slice(0, 1024) : 'Geen rollen' });
    const perms = Object.entries(KEY_PERMS).filter(([f]) => m.permissions.has(f)).map(([, n]) => n);
    if (perms.length) e.addFields({ name: 'Sleutelrechten', value: perms.join(', ') });
    if (m.communicationDisabledUntilTimestamp > Date.now()) e.addFields({ name: 'Timeout', value: `Tot ${ts(m.communicationDisabledUntilTimestamp, 'f')}` });
  }
  return e;
}

const canAct = (i, target) => i.guild.ownerId===i.user.id || (i.member.roles?.highest?.position||0) > target.roles.highest.position;
const safeReply = (i, payload) => i.replied||i.deferred ? i.followUp(payload) : i.reply(payload);

// /timeout
commands.push({level:'staff', data:new SlashCommandBuilder().setName('timeout').setDescription('Geef een lid een timeout')
 .addUserOption(o=>o.setName('user').setDescription('Lid').setRequired(true))
 .addIntegerOption(o=>o.setName('minuten').setDescription('Duur in minuten (1 t/m 40320)').setRequired(true).setMinValue(1).setMaxValue(40320))
 .addStringOption(o=>o.setName('reden').setDescription('Reden').setRequired(true)),
 async execute(i,client){const u=i.options.getUser('user'),m=await i.guild.members.fetch(u.id).catch(()=>null),mins=i.options.getInteger('minuten'),r=i.options.getString('reden'); if(!m)return i.reply({content:'Lid niet gevonden.',flags:E}); if(!canAct(i,m)||!m.moderatable)return i.reply({content:'Rolhiërarchie verhindert deze timeout.',flags:E}); await m.timeout(mins*60000,`${i.user.tag}: ${r}`); await i.reply({embeds:[embed('🔇 Timeout geplaatst',`**Lid:** ${u}\n**Duur:** ${mins} minuten\n**Reden:** ${r}`)]}); logAction(client,i,'🔇 Timeout',`${u} — ${mins} minuten. Reden: ${r}`);}});

// /purge: max 100 recent, wipe: alle berichten (ook ouder dan 14 dagen, individueel)
commands.push({level:'staff',data:new SlashCommandBuilder().setName('purge').setDescription('Verwijder berichten uit een tekstkanaal')
 .addChannelOption(o=>o.setName('kanaal').setDescription('Kanaal (standaard huidig)').addChannelTypes(ChannelType.GuildText))
 .addIntegerOption(o=>o.setName('aantal').setDescription('Aantal recente berichten (1-100)').setMinValue(1).setMaxValue(100))
 .addBooleanOption(o=>o.setName('wipe').setDescription('Verwijder alle berichten uit het kanaal')),
 async execute(i,client){const ch=i.options.getChannel('kanaal')||i.channel, n=i.options.getInteger('aantal'), wipe=i.options.getBoolean('wipe')||false; if(!i.memberPermissions.has(PermissionFlagsBits.ManageMessages))return i.reply({content:'Je mist de permissie Manage Messages.',flags:E}); if(!ch?.isTextBased()||!ch.messages)return i.reply({content:'Kies een tekstkanaal.',flags:E}); if(!n&&!wipe)return i.reply({content:'Geef `aantal` op of zet `wipe` aan.',flags:E}); await i.deferReply({flags:E}); let removed=0; if(!wipe){const msgs=await ch.messages.fetch({limit:n}); const fresh=msgs.filter(m=>Date.now()-m.createdTimestamp<14*86400000); if(fresh.size) {const deleted=await ch.bulkDelete(fresh,true); removed+=deleted.size;} } else {let before; for(let page=0;page<1000;page++){const batch=await ch.messages.fetch({limit:100,before}); if(!batch.size)break; before=batch.last().id; const fresh=batch.filter(m=>Date.now()-m.createdTimestamp<14*86400000); if(fresh.size){const d=await ch.bulkDelete(fresh,true).catch(()=>null); removed+=d?.size||0;} const old=batch.filter(m=>Date.now()-m.createdTimestamp>=14*86400000); for(const m of old){await m.delete().then(()=>removed++).catch(()=>{});} if(batch.size<100)break; }} await i.editReply(`🧹 ${removed} bericht(en) verwijderd in ${ch}.`); logAction(client,i,'🧹 Purge',`${removed} berichten verwijderd in ${ch}${wipe?' (volledige wipe)':''}.`);}});

// /slowmode channel-selectable (existing command is replaced in extra.js)
commands.push({level:'staff',data:new SlashCommandBuilder().setName('slowmode').setDescription('Stel slowmode in voor een kanaal')
 .addIntegerOption(o=>o.setName('seconden').setDescription('0 = uit (max 21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
 .addChannelOption(o=>o.setName('kanaal').setDescription('Kanaal (standaard huidig)').addChannelTypes(ChannelType.GuildText)),
 async execute(i,client){const ch=i.options.getChannel('kanaal')||i.channel,s=i.options.getInteger('seconden'); if(!i.memberPermissions.has(PermissionFlagsBits.ManageChannels))return i.reply({content:'Je mist de permissie Manage Channels.',flags:E}); await ch.setRateLimitPerUser(s,`Door ${i.user.tag}`); await i.reply({embeds:[embed('🐌 Slowmode',`${ch}: ${s?s+' seconden':'uitgeschakeld'}.`)]}); logAction(client,i,'🐌 Slowmode',`${ch} ingesteld op ${s}s.`);}});

// Member / server / avatar / roles / uptime / audit log
commands.push({level:'everyone',data:new SlashCommandBuilder().setName('memberinfo').setDescription('Info over een speler: gang-profiel voor leden, algemene info voor inwoners').addUserOption(o=>o.setName('user').setDescription('Speler (leeg = jezelf)')).addStringOption(addZicht),async execute(i){const user=i.options.getUser('user')||i.user;const m=await i.guild.members.fetch(user.id).catch(()=>null);return i.reply({embeds:[await buildMemberInfo(i.guild,user,m)],...vis(i)});}});
commands.push({level:'everyone',data:new SlashCommandBuilder().setName('serverinfo').setDescription('Bekijk informatie over deze Discord-server').addStringOption(addZicht),async execute(i){const g=i.guild; await g.fetch(); const owner=await g.fetchOwner().catch(()=>null); const e=embed(`🌐 ${g.name}`,null).setThumbnail(g.iconURL({size:512})).addFields({name:'Eigenaar',value:owner?`${owner.user.tag}`:'Onbekend',inline:true},{name:'Server-ID',value:`\`${g.id}\``,inline:true},{name:'Aangemaakt',value:`<t:${Math.floor(g.createdTimestamp/1000)}:D>`,inline:true},{name:'Leden',value:`${g.memberCount}`,inline:true},{name:'Kanalen',value:`${g.channels.cache.size}`,inline:true},{name:'Rollen',value:`${g.roles.cache.size-1}`,inline:true},{name:'Boosts',value:`${g.premiumSubscriptionCount||0} (niveau ${g.premiumTier})`,inline:true},{name:'Verificatie',value:String(g.verificationLevel),inline:true}); return i.reply({embeds:[e],...vis(i)});}});
commands.push({level:'everyone',data:new SlashCommandBuilder().setName('avatar').setDescription('Bekijk de avatar van een gebruiker').addUserOption(o=>o.setName('user').setDescription('Gebruiker (optioneel)')).addStringOption(addZicht),async execute(i){const u=i.options.getUser('user')||i.user;const url=u.displayAvatarURL({size:1024,extension:'png'});return i.reply({embeds:[embed(`🖼️ Avatar • ${u.tag}`,`[Open afbeelding](${url})`).setImage(url)],...vis(i)});}});
commands.push({level:'everyone',data:new SlashCommandBuilder().setName('roles').setDescription('Toon alle serverrollen').addStringOption(addZicht),async execute(i){const roles=i.guild.roles.cache.filter(r=>r.id!==i.guild.id).sort((a,b)=>b.position-a.position);const lines=roles.map(r=>`**${r.name}** — positie ${r.position} — ${r.members.size} leden`);const chunks=[];while(lines.length)chunks.push(lines.splice(0,35).join('\n'));return i.reply({embeds:chunks.slice(0,5).map((x,n)=>embed(`🎭 Serverrollen (${roles.size})${chunks.length>1?` • ${n+1}/${chunks.length}`:''}`,x)) ,...vis(i)});}});
commands.push({level:'everyone',data:new SlashCommandBuilder().setName('uptime').setDescription('Toon hoelang deze bot online is').addStringOption(addZicht),async execute(i,client){const ms=client.uptime||Date.now()-startedAt;const d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);return i.reply({embeds:[embed('⏱️ Bot uptime',`**${d} dagen, ${h} uur, ${m} minuten en ${s} seconden**\nGestart: <t:${Math.floor((Date.now()-ms)/1000)}:F>`)],...vis(i)});}});
commands.push({level:'management',data:new SlashCommandBuilder().setName('auditlog').setDescription('Toon de laatste 20 server audit logs').addStringOption(addZichtPrive),async execute(i){await i.deferReply({...vis(i,'prive')});const logs=await i.guild.fetchAuditLogs({limit:20});const lines=logs.entries.map(x=>`**${x.action}** • ${x.executor?.tag||'Onbekend'}\n${x.target?.tag||x.target?.name||x.targetId||'Geen doel'} • <t:${Math.floor(x.createdTimestamp/1000)}:R>${x.reason?`\nReden: ${x.reason}`:''}`);const pages=[];while(lines.length)pages.push(lines.splice(0,5).join('\n\n'));return i.editReply({embeds:pages.slice(0,4).map((p,n)=>embed(`📋 Auditlog • ${n+1}/${pages.length}`,p))});}});

// /role add|remove; remove uses a live dropdown of the target member's current roles.
commands.push({level:'management',data:new SlashCommandBuilder().setName('role').setDescription('Beheer rollen van een serverlid')
 .addSubcommand(s=>s.setName('add').setDescription('Geef een rol').addUserOption(o=>o.setName('user').setDescription('Lid').setRequired(true)).addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
 .addSubcommand(s=>s.setName('remove').setDescription('Verwijder een rol via dropdown').addUserOption(o=>o.setName('user').setDescription('Lid').setRequired(true))),
 async execute(i){const sub=i.options.getSubcommand(),u=i.options.getUser('user'),m=await i.guild.members.fetch(u.id).catch(()=>null);if(!m)return i.reply({content:'Lid niet gevonden.',flags:E});if(!canAct(i,m))return i.reply({content:'Je kunt geen rollen beheren van dit lid (rolhiërarchie).',flags:E});if(sub==='add'){const r=i.options.getRole('rol');if(r.managed||r.position>=i.guild.members.me.roles.highest.position)return i.reply({content:'Deze rol kan de bot niet beheren.',flags:E});if(i.guild.ownerId!==i.user.id&&r.position>=i.member.roles.highest.position)return i.reply({content:'Je kunt geen rol beheren die gelijk aan of hoger is dan je eigen hoogste rol.',flags:E});await m.roles.add(r,`Door ${i.user.tag}`);return i.reply({embeds:[embed('✅ Rol toegevoegd',`${r} is toegevoegd aan ${m}.`)],flags:E});}const opts=m.roles.cache.filter(r=>r.id!==i.guild.id&&!r.managed&&r.position<i.guild.members.me.roles.highest.position&&(i.guild.ownerId===i.user.id||r.position<i.member.roles.highest.position)).sort((a,b)=>b.position-a.position).map(r=>({label:r.name.slice(0,100),value:r.id}));if(!opts.length)return i.reply({content:'Dit lid heeft geen verwijderbare rollen.',flags:E});const page=0,menu=new StringSelectMenuBuilder().setCustomId(`role-remove:${i.user.id}:${m.id}:${page}`).setPlaceholder(`Selecteer rol(len) • pagina 1/${Math.ceil(opts.length/25)}`).setMinValues(1).setMaxValues(Math.min(25,opts.length)).addOptions(opts.slice(0,25));const rows=[new ActionRowBuilder().addComponents(menu)];if(opts.length>25)rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`role-remove-page:${i.user.id}:${m.id}:1`).setLabel('Volgende →').setStyle(ButtonStyle.Secondary)));return i.reply({content:`Selecteer de rol(len) die van ${m} verwijderd moeten worden. (${opts.length} beschikbare rollen)`,components:rows,flags:E});}});
components.push({match:id=>id.startsWith('role-remove:'),async execute(i){const [,actor,target]=i.customId.split(':');if(i.user.id!==actor)return i.reply({content:'Alleen degene die dit menu heeft geopend kan dit gebruiken.',flags:E});const m=await i.guild.members.fetch(target).catch(()=>null);if(!m||!canAct({guild:i.guild,user:i.user,member:i.member},m))return i.update({content:'Lid niet meer beschikbaar of rolhiërarchie verhindert dit.',components:[]});const removed=[];for(const id of i.values){const r=i.guild.roles.cache.get(id);if(r&&!r.managed&&r.position<i.guild.members.me.roles.highest.position&&m.roles.cache.has(id)){await m.roles.remove(r,`Door ${i.user.tag}`);removed.push(r.name);}}return i.update({content:removed.length?`✅ Verwijderd van ${m}: ${removed.join(', ')}`:'Geen rollen verwijderd.',components:[]});}});
components.push({match:id=>id.startsWith('role-remove-page:'),async execute(i){const [,actor,target,pageText]=i.customId.split(':');if(i.user.id!==actor)return i.reply({content:'Alleen degene die dit menu heeft geopend kan dit gebruiken.',flags:E});const m=await i.guild.members.fetch(target).catch(()=>null);if(!m)return i.update({content:'Lid niet gevonden.',components:[]});const roles=m.roles.cache.filter(r=>r.id!==i.guild.id&&!r.managed&&r.position<i.guild.members.me.roles.highest.position&&(i.guild.ownerId===i.user.id||r.position<i.member.roles.highest.position)).sort((a,b)=>b.position-a.position).map(r=>({label:r.name.slice(0,100),value:r.id}));const pages=Math.ceil(roles.length/25),page=Math.max(0,Math.min(pages-1,Number(pageText)||0)),slice=roles.slice(page*25,(page+1)*25);const menu=new StringSelectMenuBuilder().setCustomId(`role-remove:${actor}:${target}:${page}`).setPlaceholder(`Selecteer rol(len) • pagina ${page+1}/${pages}`).setMinValues(1).setMaxValues(Math.min(25,slice.length)).addOptions(slice);const buttons=[];if(page>0)buttons.push(new ButtonBuilder().setCustomId(`role-remove-page:${actor}:${target}:${page-1}`).setLabel('← Vorige').setStyle(ButtonStyle.Secondary));if(page<pages-1)buttons.push(new ButtonBuilder().setCustomId(`role-remove-page:${actor}:${target}:${page+1}`).setLabel('Volgende →').setStyle(ButtonStyle.Secondary));const rows=[new ActionRowBuilder().addComponents(menu)];if(buttons.length)rows.push(new ActionRowBuilder().addComponents(buttons));return i.update({content:`Selecteer rollen van ${m} (${roles.length} beschikbaar).`,components:rows});}});

// Whitelist overview includes both user IDs and role IDs.
commands.push({level:'admin',data:new SlashCommandBuilder().setName('antinuke-whitelist').setDescription('Toon exact alle anti-nuke whitelist uitzonderingen').addStringOption(addZichtPrive),async execute(i){const c=require('../security').cfg();const users=(c.whitelist||[]).map(id=>`• <@${id}> — \`${id}\``);const roles=(c.whitelistRoles||[]).map(id=>{const r=i.guild.roles.cache.get(id);return `• ${r?r.name:'Onbekende/verwijderde rol'} — <@&${id}> — \`${id}\``;});return i.reply({embeds:[embed('🛡️ Anti-Nuke whitelist',null,config.logColor).addFields({name:`Gebruikers (${users.length})`,value:users.join('\n').slice(0,1024)||'Geen'},{name:`Rollen (${roles.length})`,value:roles.join('\n').slice(0,1024)||'Geen'})],...vis(i,'prive')});}});

// /sync globally registers every loaded command.
commands.push({level:'admin',data:new SlashCommandBuilder().setName('sync').setDescription('Forceer globale herregistratie van alle slash commands'),async execute(i,client){await i.deferReply({flags:E});const rest=new REST({version:'10'}).setToken(config.token);const body=client.commands.map(c=>c.data.toJSON());await rest.put(Routes.applicationCommands(config.clientId),{body});return i.editReply(`✅ ${body.length} slash commands globaal geregistreerd. Globale wijzigingen kunnen even nodig hebben om overal zichtbaar te worden.`);}});

// Hot reload of a command module, event entry point, or plugin module.
commands.push({level:'admin',data:new SlashCommandBuilder().setName('reload').setDescription('Herlaad een command-, event- of pluginmodule')
 .addStringOption(o=>o.setName('type').setDescription('Type module').setRequired(true).addChoices({name:'Command',value:'command'},{name:'Event',value:'event'},{name:'Plugin',value:'plugin'}))
 .addStringOption(o=>o.setName('module').setDescription('Bestandsnaam zonder .js (bij command: moderation, extra, etc.)').setRequired(true)),
 async execute(i,client){const type=i.options.getString('type'),name=i.options.getString('module').replace(/\.js$/i,'');const base=type==='command'?'commands':type==='event'?'events':'plugins';const file=path.join(__dirname,'..',base,`${name}.js`);if(!fs.existsSync(file))return i.reply({content:`Module niet gevonden: \`${base}/${name}.js\`.`,flags:E});try{const resolved=require.resolve(file);const previous=require.cache[resolved]?.exports;if(previous?.destroy)await previous.destroy(client);delete require.cache[resolved];const mod=require(file);if(type==='command'){const fresh=require('../loader').load();client.commands.clear();for(const [k,v] of fresh.commands)client.commands.set(k,v);client.components=fresh.components;}else if(type==='event'||type==='plugin'){if(typeof mod.init!=='function')throw new Error('Deze module moet een init(client)-functie exporteren om live te herladen.');await mod.init(client);}return i.reply({content:`✅ ${base}/${name}.js opnieuw geladen.`,flags:E});}catch(err){return i.reply({content:`❌ Herladen mislukt: ${err.message}`,flags:E});}}});

module.exports={commands,components};
