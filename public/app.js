'use strict';
const state={player:null,csrf:null,page:'home',lastDrop:null,busy:false,authMode:'login',marketQuery:'',marketTier:'',resolved:null,recipientQuery:'',spinCost:200,tiers:[],dailyBonus:4000,selectedTier:'common',commonOdds:[],casinoBet:500,casinoResult:null,chatDraft:'',muted:(()=>{try{return localStorage.getItem('game-muted')==='1'}catch{return false}})()};
const root=document.querySelector('#app');
const toastRoot=document.querySelector('#toast-root');
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const icons={home:'home',spin:'dice',market:'market',collection:'stack',profile:'user',leaderboard:'trophy',transfer:'send'};
const tierNames={common:'Обычный',uncommon:'Необычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный'};
const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
const money=n=>`<span class="money">${number.format(Number(n)||0)} <span class="ruble">₽</span></span>`;
const esc=x=>String(x??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const icon=(name,cls='')=>`<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const tier=t=>`<span class="tier ${esc(t||'common')}">${esc(tierNames[t]||t)}</span>`;
const hash=n=>`#${Number(n)}`;
const reltime=seconds=>{const d=Math.max(0,Math.ceil(seconds));if(!d)return 'доступно';const h=Math.floor(d/3600),m=Math.ceil((d%3600)/60);return h?`${h} ч ${m} мин`:`${m} мин`;};
const dateStr=ts=>new Date(ts*1000).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Original short synthesized sound cues. No external files, no licensing or buffering.
const audio={ctx:null,lastTick:0,
 unlock(){if(state.muted)return;try{this.ctx??=new (window.AudioContext||window.webkitAudioContext)();if(this.ctx.state==='suspended')this.ctx.resume();}catch{}},
 tone(freq,duration=.12,kind='sine',volume=.035,delay=0){if(state.muted)return;this.unlock();if(!this.ctx)return;const a=this.ctx,t=a.currentTime+delay;
  const osc=a.createOscillator(),gain=a.createGain();osc.type=kind;osc.frequency.setValueAtTime(freq,t);gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(volume,t+.015);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);osc.connect(gain).connect(a.destination);osc.start(t);osc.stop(t+duration+.01);},
 cue(name,rarity){if(state.muted)return;
  if(name==='tick'){const now=performance.now();if(now-this.lastTick<65)return;this.lastTick=now;this.tone(330+Math.random()*85,.055,'triangle',.014);return;}
  const patterns={
   common:[330,392],uncommon:[392,494,587],rare:[392,587,784],epic:[440,660,880,1175],legendary:[523,784,1047,1568,2093],
   sell:[520,650,780],buy:[440,554,740],equip:[660,880,990],work:[440,554,660],casino:[350,440,523]
  };
  const notes=patterns[name==='drop'?rarity:name]||patterns.common;
  notes.forEach((n,i)=>this.tone(n,name==='drop'?.21:.14,(name==='drop'&&['epic','legendary'].includes(rarity))?'sine':'triangle',.028,i*(name==='drop'?.12:.075)));
 }
};
// Visual preview uses readable combinations too — no keyboard mash during spin.
const demoRoots=['ghost','shadow','neon','moon','storm','king','nova','vibe','wolf','pixel','night','dark','gold','star','dream','orbit','vortex','raven','frost','flame','lucky','zero','alpha','prime','laser','glow','swift','sky','fox','zen','boss','legend','cyber','solar'];
const demoPrefixes=['real','neo','its','the','only','dark','gold','ultra','max'];
const demoSuffixes=['pro','go','tv','zone','gg','core','x','rx'];
const demoNumbers=['7','77','777','99','007','01','42','202','404','999'];
const demoShort=['x','7','gg','77','zen','vip','king','boss','nova','moon','777'];
const demoPick=a=>a[Math.floor(Math.random()*a.length)];
function randomDemo(t){
 const lens={common:[9,13],uncommon:[7,9],rare:[6,7],epic:[5,6],legendary:[1,4]};
 const [min,max]=lens[t]||lens.common;
 for(let i=0;i<80;i++){
  const word=demoPick(demoRoots),other=demoPick(demoRoots),num=demoPick(demoNumbers);
  const variant=[word,word+other,demoPick(demoPrefixes)+word,word+demoPick(demoSuffixes),word+num,word+'_'+num,demoPick(demoShort)][Math.floor(Math.random()*7)];
  if(variant.length>=min&&variant.length<=max)return '@'+variant;
 }
 return '@'+(t==='legendary'?'king':t==='epic'?'ghost':t==='rare'?'shadow':t==='uncommon'?'neon777':'neonstorm7');
}
const secondsUntil=(last,period)=>Math.max(0,period-(Date.now()/1000-last));
const todayUtc=()=>Math.floor(Date.now()/86400000);

async function request(url,{method='GET',body}={}){
 const r=await fetch(url,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(state.csrf?{'X-CSRF-Token':state.csrf}:{})},credentials:'same-origin',body:body!==undefined?JSON.stringify(body):undefined});
 let data;try{data=await r.json();}catch{throw Error('Неожиданный ответ сервера');}
 if(!r.ok){if(r.status===401&&state.player){state.player=null;render();}throw Error(data.error||'Ошибка запроса');}
 return data;
}
function toast(message,err=false){const el=document.createElement('div');el.className='toast'+(err?' err':'');el.textContent=message;toastRoot.append(el);setTimeout(()=>el.remove(),4200);}
function syncPlayer(p){if(!p)return;state.player=p;document.querySelectorAll('[data-balance]').forEach(e=>e.innerHTML=money(p.balance));document.querySelectorAll('[data-capital]').forEach(e=>e.innerHTML=money(p.capital));}
const button=(action,text,style='secondary',attrs='')=>`<button class="btn ${style}" type="button" data-action="${action}" ${attrs}>${text}</button>`;
function header(){return `<header class="main-head"><div><div class="brand">USERNAME <span>GAME</span></div><div class="overline" style="margin-top:5px">COLLECT · TRADE · STAND OUT</div></div><div class="head-right"><button type="button" class="sound-toggle" data-action="sound" aria-label="${state.muted?'Включить звуки':'Выключить звуки'}">${state.muted?'♪̸':'♫'}</button><button type="button" class="head-avatar" data-go="profile" aria-label="Открыть профиль">${icon('user')}</button></div></header>`;}
function balance(){return `<div class="panel balance-card"><div><div class="overline">Баланс</div><div data-balance>${money(state.player.balance)}</div></div><button type="button" class="soft-btn" data-action="daily">${icon('gift','sm')} Бонус</button></div>`;}
const navItems=[['home','Главная','home'],['spin','Генератор','dice'],['market','Рынок','market'],['collection','Коллекция','stack'],['profile','Профиль','user']];
function nav(){return `<nav class="bottom-nav" aria-label="Навигация">${navItems.map(([id,label,i])=>`<button class="nav-btn ${(id===state.page||(id==='profile'&&['leaderboard','transfer'].includes(state.page)))?'active':''}" data-go="${id}">${icon(i)}<span>${label}</span></button>`).join('')}</nav>`;}
function frame(){return `<div class="app-shell">${header()}<main id="view" aria-live="off"></main></div>${nav()}`;}
function title(heading,sub){return `<div class="page-title"><h1>${heading}</h1>${sub?`<p>${sub}</p>`:''}</div>`;}
function empty(head,desc,i='stack'){return `<div class="empty">${icon(i)}<strong>${esc(head)}</strong>${esc(desc)}</div>`;}
function home(){const p=state.player;const delay=Date.now()/1000-p.last_daily_at;return `${balance()}<section class="hero panel"><div class="label">${icon('spark','sm')} КОЛЛЕКЦИОННАЯ ОНЛАЙН-ИГРА</div><h1>Твой следующий ник может стать легендой.</h1><p>Генерируй уникальные игровые @имена, торгуй с игроками и поднимайся в рейтинге.</p><button class="hero-action" data-go="spin">Начать генерацию ${icon('arrow')}</button></section>
<div class="quick-grid"><button data-go="market" class="quick">${icon('market')}Рынок</button><button data-go="leaderboard" class="quick">${icon('trophy')}Топ игроков</button><button data-go="transfer" class="quick">${icon('send')}Переводы</button><button data-go="earn" class="quick">${icon('wallet')}Заработок</button><button data-go="casino" class="quick">${icon('dice')}Казино</button><button data-go="sales" class="quick">${icon('market')}Продажи</button><button data-go="chat" class="quick">${icon('send')}Общий чат</button><button data-go="offers" class="quick">${icon('market')}Личные сделки</button><button data-go="referrals" class="quick">${icon('gift')}Друзья</button></div>
<section class="section"><div class="section-head"><h2>Твой прогресс</h2><button class="link" data-go="profile">Профиль ${icon('arrow','sm')}</button></div><div class="tile-grid"><div class="tile"><div class="overline">Общий капитал</div><div class="value" data-capital>${money(p.capital)}</div></div><div class="tile"><div class="overline">Ников в коллекции</div><div class="value">${p.collection_size}</div></div></div></section>
<div class="panel feature"><div class="feature-head">${icon('gift')}<h3>Ежедневный бонус</h3></div><div class="feature-row"><p>${delay>=86400?'Награда уже доступна!':`Следующая награда через ${reltime(86400-delay)}.`}<br>Бонус ${money(state.dailyBonus)} в игровых рублях.</p><button class="btn small-btn ghost" data-action="daily" ${delay>=86400?'':'disabled'}>Получить</button></div></div>
<div class="notice" style="margin-top:17px">@Юзернеймы в этой игре — коллекционные игровые предметы. Они не являются реальными Telegram-юзернеймами и не дают прав на них.</div>`;}
function odds(){return `<div class="panel odds"><div class="feature-head">${icon('spark')}<h3>Категории и цены</h3></div>${state.tiers.map(t=>`<div class="odds-row">${tier(t.id)}<span>${money(t.cost)} · ${t.lengths?.[0]}–${t.lengths?.[1]} символов</span></div>`).join('')}<div class="chance-heading">Шансы обычной прокрутки за ${money(state.tiers.find(t=>t.id==='common')?.cost||200)}</div><div class="chance-grid">${state.commonOdds.map(o=>`<div class="chance-item">${tier(o.tier)}<strong>${String(o.percent).replace('.',',')}%</strong></div>`).join('')}</div><p class="form-help">Обычная и бесплатная прокрутки могут дать ник вплоть до эпического. Необычный, редкий, эпический и легендарный платные режимы гарантируют выбранную категорию. Все результаты определяет сервер. Это только игровые ники, не настоящие Telegram-юзернеймы.</p></div>`;}
function spinScreen(){const sel=state.tiers.find(t=>t.id===state.selectedTier)||state.tiers[0]||{cost:200};const p=state.player;
 const freeCount=p.free_spin_day===todayUtc()?p.free_spin_count:0;
 return `${title('Генератор','В обычной прокрутке есть шанс выбить ник вплоть до эпического.')}${balance()}<div class="panel generator-stage"><h3>Коллекционный юзернейм</h3><div class="handle-plate" id="handle-plate"><div class="handle-text" id="handle-text">@username</div></div><div class="stage-label" id="stage-status">Выбери категорию</div><div id="spin-result"></div><div id="spin-controls"><div class="tier-picker">${state.tiers.map(t=>`<button type="button" data-tier="${t.id}" class="tier-choice ${state.selectedTier===t.id?'selected':''}">${tier(t.id)}<strong>${money(t.cost)}</strong><small>${t.id==='common'?'Шанс до эпического':`${t.lengths?.[0]}–${t.lengths?.[1]} символов`}</small></button>`).join('')}</div><div class="stage-price">Стоимость генерации — ${money(sel.cost)}</div><button type="button" data-action="spin" class="btn primary full">${icon('dice')} Генерировать · ${esc(sel.label)}</button><button type="button" data-action="free-spin" class="btn secondary full free-spin-btn" ${freeCount>=5||secondsUntil(p.last_free_spin_at,1800)>0?'disabled':''}>Бесплатный прокрут · осталось ${5-freeCount}/5</button><div class="form-help" style="text-align:center">${secondsUntil(p.last_free_spin_at,1800)>0?'Следующий бесплатный через '+reltime(secondsUntil(p.last_free_spin_at,1800)):'Бесплатная генерация доступна каждые 30 минут.'}</div></div></div>${odds()}`;}
function itemCard(item,mode='collection'){
 const own=mode==='collection';const listed=!!item.listing_id;
 return `<article class="panel item-card"><div class="item-main"><div style="min-width:0"><div class="item-handle">@${esc(item.handle)}</div><div class="item-sub">${tier(item.tier)}${item.special?`<span class="special-pill">✦ ${esc(item.special)}</span>`:''}${listed&&own?'<span class="pill">На рынке</span>':''}</div></div><div class="item-price">${money(own?(listed?item.listing_price:item.buyback):item.price)}<div class="small muted" style="font-size:10px;margin-top:4px">${own?(listed?'Цена объявления':'Продажа игре'):'Цена игрока'}</div></div></div>
 ${own?`<div class="item-ops">${listed?button('unlist','Снять с рынка','secondary',`data-id="${item.id}"`):button('sell','Продать игре','secondary',`data-id="${item.id}"`)}${!listed?button('open-list','На рынок','secondary',`data-id="${item.id}"`):''}${!listed?button('open-offer','Продать по ID','ghost',`data-id="${item.id}"`):''}${button('equip',state.player.equipped_item_id===item.id?'Снять с профиля':'Установить ник','ghost',`data-id="${item.id}"`)}</div><div id="list-form-${item.id}"></div><div id="offer-form-${item.id}"></div>`:`<div class="item-ops">${button('buy',`Купить ${icon('arrow','sm')}`,'ghost',`data-id="${item.listing_id}" ${item.seller_id===state.player.id?'disabled':''}`)}<span class="small muted" style="align-self:center">Продавец: ${esc(item.seller_name)}</span></div>`}</article>`;
}
function collection(){return `${title('Моя коллекция','Здесь хранятся твои уникальные игровые @юзернеймы.')}<div id="collection-list"><div class="loader-page" style="min-height:170px"><div class="loading-ring"></div></div></div>`;}
function market(){return `${title('Рынок','Настоящие сделки между игроками. У каждого ника — один владелец.')}<form id="market-search" class="filter-row"><label class="search-box">${icon('search')}<input name="q" placeholder="Например, ghost" value="${esc(state.marketQuery)}" autocomplete="off"/></label><select class="select" name="tier" aria-label="Редкость">${[['','Все'],...Object.entries(tierNames)].map(([id,label])=>`<option value="${id}" ${state.marketTier===id?'selected':''}>${esc(label)}</option>`).join('')}</select><button class="btn small-btn" aria-label="Найти" type="submit">${icon('search','sm')}</button></form><div class="notice">Комиссия при продаже — 5%. Покупки безопасно проводятcя сервером: деньги и ник передаются одной операцией.</div><div id="market-list" class="item-list"><div class="loader-page" style="min-height:170px"><div class="loading-ring"></div></div></div>`;}
function leaderboard(){return `${title('Топ игроков','10 самых богатых игроков по общему капиталу.')}
<div class="notice">Капитал = рубли на балансе + выкупная стоимость принадлежащих игроку ников. Цены объявлений не влияют на рейтинг.</div>
<div id="leaderboard-list"><div class="loader-page" style="min-height:170px"><div class="loading-ring"></div></div></div>`;}
function rankRow(p){return `<div class="rank-row"><div class="rank-number">${p.place}</div><div class="rank-person"><strong>${esc(p.display_name)}</strong> ${p.id===state.player.id?'<span class="pill">Вы</span>':''}<div class="small muted">${p.telegram_username?'Telegram: @'+esc(p.telegram_username):'Telegram: не привязан'}${p.equipped_handle?' · игровой @'+esc(p.equipped_handle):''}</div></div><div class="rank-money">${money(p.capital)}</div></div>`;}
function profile(){const p=state.player;return `${title('Мой профиль','Коллекция, репутация и личные достижения.')}
<div class="panel profile-card"><div class="profile-line"><div class="avatar">${esc((p.display_name||'U')[0].toUpperCase())}</div><div style="min-width:0"><div class="name">${esc(p.display_name)} ${p.equipped_handle?`<span class="equipped">@${esc(p.equipped_handle)}</span>`:''}</div><div class="id">ID ${p.id} · ${p.telegram_username?'Telegram @'+esc(p.telegram_username):'Telegram не привязан'}</div></div></div><div class="tag-line">${icon('spark','sm')}${p.equipped_handle?`Твой установленный ник: <strong>@${esc(p.equipped_handle)}</strong>`:'Выбери ник из коллекции, чтобы выделиться среди игроков.'}</div><div class="profile-actions"><button data-go="offers" class="btn secondary">${icon('market')} Личные сделки</button><button data-go="chat" class="btn secondary">${icon('send')} Общий чат</button><button data-go="leaderboard" class="btn secondary">${icon('trophy')} Топ-10</button><button data-go="transfer" class="btn secondary">${icon('send')} Перевод ₽</button><button data-go="referrals" class="btn secondary">${icon('gift')} Пригласить друзей</button></div></div>
<div class="section"><div class="tile-grid"><div class="tile"><div class="overline">Баланс</div><div class="value" data-balance>${money(p.balance)}</div></div><div class="tile"><div class="overline">Капитал</div><div class="value" data-capital>${money(p.capital)}</div></div><div class="tile"><div class="overline">Уровень</div><div class="value">${p.level}</div></div><div class="tile"><div class="overline">Ников</div><div class="value">${p.collection_size}</div></div></div></div>
<div class="section"><div class="section-head"><h2>Последние операции</h2></div><div class="panel card" id="history-list"><p class="muted small">Загрузка…</p></div></div><div class="section">${button('logout',`${icon('out')} Выйти из аккаунта`,'full secondary')}</div>`;}
function transferPage(){return `${title('Перевести ₽','Отправляй виртуальные рубли другим игрокам.')}
<div class="panel form-card"><label class="field" for="recipient">ID игрока или игровой @username</label><input id="recipient" class="text-input" placeholder="Например, 14 или @ghost" value="${esc(state.recipientQuery)}" autocomplete="off"/><button type="button" class="btn ghost full" data-action="resolve">${icon('search')} Найти игрока</button><div id="recipient-preview">${state.resolved?recipientCard(state.resolved):''}</div><label class="field" for="amount">Сумма перевода</label><input type="number" id="amount" class="text-input" min="10" max="500000000" step="1" placeholder="Например, 5000"/><p class="form-help">Ваш баланс: ${money(state.player.balance)}. Минимум 10 ₽, максимум 500 000 000 ₽ за перевод. Проверь ID получателя перед подтверждением.</p><button class="btn primary full" type="button" data-action="transfer" ${state.resolved?'':'disabled'}>${icon('send')} Отправить рубли</button></div><div class="notice" style="margin-top:16px">Переводы нельзя отменить. @username здесь означает ник внутри игры, не Telegram-аккаунт. Если имена неоднозначны, используйте цифровой ID.</div>`;}
function recipientCard(p){return `<div class="resolve-preview">${icon('check','sm')} <strong>${esc(p.display_name)}</strong> ${p.equipped_handle?`<span class="equipped">@${esc(p.equipped_handle)}</span>`:''}<div class="muted small">ID ${p.id} · логин @${esc(p.login)}</div></div>`;}
function auth(){const signup=state.authMode==='register';return `<div class="auth-wrap"><div class="auth-inner"><div class="auth-mark">@</div><div class="auth-title">Username <span class="accent">Game</span></div><div class="auth-sub">Генерируй. Коллекционируй. Торгуй.</div><div class="panel auth-card"><div class="auth-tabs"><button class="auth-tab ${!signup?'active':''}" data-authmode="login">Вход</button><button class="auth-tab ${signup?'active':''}" data-authmode="register">Регистрация</button></div><form id="auth-form"><label class="field" for="auth-login">Логин (латиницей)</label><input id="auth-login" class="text-input" name="login" placeholder="Например, player77" minlength="3" maxlength="20" autocomplete="username" required/>${signup?`<label class="field" for="auth-name">Имя в игре</label><input id="auth-name" class="text-input" name="display_name" placeholder="Как к тебе обращаться" maxlength="28" required/>`:''}<label class="field" for="auth-password">Пароль</label><input id="auth-password" class="text-input" name="password" type="password" placeholder="Минимум 8 символов" autocomplete="${signup?'new-password':'current-password'}" required minlength="8"/><button class="btn primary full" type="submit">${signup?'Создать аккаунт':'Войти в игру'} ${icon('arrow')}</button></form></div><p class="auth-note">В Telegram вход выполняется автоматически после проверки Telegram-аккаунта.<br>Все рубли и юзернеймы — только игровые, без обмена на реальные ценности.</p></div></div>`;}
function earnScreen(){const p=state.player,remaining=secondsUntil(p.last_work_at,600),workCount=p.work_day===todayUtc()?p.work_count:0;
 return `${title('Заработок','Пополняй баланс без рискованных генераций.')}${balance()}<div class="panel form-card"><div class="feature-head">${icon('wallet')}<h3>Контракт дня</h3></div><p class="muted">Выполняй короткие игровые заказы и получай 400–700 ₽ раз в 10 минут. Не более 10 заказов в сутки.</p><div class="contract-reward">${workCount}/10 выполнено сегодня</div>${button('work',remaining>0?'Доступно через '+reltime(remaining):'Выполнить контракт','primary full',remaining>0||workCount>=10?'disabled':'')}</div><div class="panel form-card" style="margin-top:12px"><div class="feature-head">${icon('gift')}<h3>Бонус и бесплатные генерации</h3></div><p class="muted">Забирай ежедневный бонус ${money(state.dailyBonus)} и до 5 обычных юзернеймов бесплатно, по одному каждые 30 минут.</p><div class="btn-row" style="margin-top:12px">${button('daily','Бонус','secondary') }<button type="button" class="btn secondary" data-go="spin">Генератор</button></div></div>`;}
function casinoScreen(){return `${title('Казино','Только виртуальные рубли. Без пополнения и вывода.')}${balance()}<div class="panel casino-stage"><div class="feature-head">${icon('dice')}<h3>Три барабана</h3></div><div class="casino-reels" id="casino-reels"><span>7</span><span>◆</span><span>7</span></div><div id="casino-result" class="casino-result">Выбери ставку и испытай удачу.</div><div class="casino-bets">${[100,500,2000,5000].map(n=>`<button type="button" data-bet="${n}" class="tier-choice ${state.casinoBet===n?'selected':''}">${money(n)}</button>`).join('')}</div>${button('casino',`Играть за ${money(state.casinoBet)}`,'primary full')}<p class="form-help">35% — проигрыш · 39% — возврат · 15% — x1,5 · 8% — x2 · 2,5% — x4 · 0,5% — x10. Теоретическая отдача 92,5%. Между ставками — 6 секунд. Это не способ стабильного заработка.</p></div>`;}
function chatScreen(){return `${title('Общий чат','Сообщения всех игроков в одной комнате.')}<div class="notice">Без личных данных, ссылок на оплату и спама. Сообщения видны всем игрокам, история ограничена последними 80.</div><div class="panel chat-panel"><div class="chat-feed" id="chat-feed" aria-label="Сообщения чата"><p class="muted small">Загружаем сообщения…</p></div><form id="chat-form" class="chat-compose"><input class="text-input" name="message" maxlength="280" placeholder="Сообщение всем игрокам…" autocomplete="off" required/><button type="submit" class="btn primary">Отправить</button></form></div>`;}
const offerStatus={pending:'Ожидает ответа',accepted:'Куплен',declined:'Отклонено',cancelled:'Отменено',expired:'Истекло'};
function offersScreen(){return `${title('Личные сделки','Продажа игровых @ников конкретному игроку по ID.')}<div class="notice">Цена — от 1 до 1 000 000 000 ₽. Предложение действует 24 часа. Покупатель подтверждает сделку сам; комиссия 5% взимается с продавца. Выставить ник можно из коллекции.</div><div class="section"><div class="section-head"><h2>Предложения</h2><button data-action="reload-offers" class="link">Обновить</button></div><div id="offers-list"><p class="muted small">Загрузка…</p></div></div>`;}
function chatHtml(m){return `<div class="chat-line ${m.player_id===state.player.id?'mine':''}"><div class="chat-top"><strong>${esc(m.display_name)}</strong>${m.equipped_handle?`<span class="equipped">@${esc(m.equipped_handle)}</span>`:''}<span class="chat-time">${new Date(m.created_at*1000).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></div><div class="chat-body">${esc(m.message)}</div><div class="chat-id">ID ${m.player_id}${m.telegram_username?' · TG @'+esc(m.telegram_username):''}</div></div>`;}
async function loadChat(){if(state.page!=='chat'||!state.player)return;const feed=document.querySelector('#chat-feed');if(!feed)return;try{const nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<110;const d=await request('/api/chat');if(state.page!=='chat'||!feed.isConnected)return;const fingerprint=d.messages.map(m=>m.id).join(',');if(feed.dataset.fingerprint===fingerprint)return;feed.dataset.fingerprint=fingerprint;feed.innerHTML=d.messages.length?d.messages.map(chatHtml).join(''):'<p class="muted small">Сообщений пока нет. Начни разговор!</p>';if(nearBottom)feed.scrollTop=feed.scrollHeight;}catch(e){if(feed.isConnected)feed.innerHTML=`<p class="muted small">${esc(e.message)}</p>`;}}
function offerHtml(o){const received=o.buyer_id===state.player.id;return `<div class="panel offer-card"><div class="offer-name">@${esc(o.handle)} ${tier(o.tier)}${o.special?`<span class="special-pill">${esc(o.special)}</span>`:''}</div><div class="offer-meta">${received?'Продавец':'Покупатель'}: ${esc(received?o.seller_name:o.buyer_name)} · ID ${received?o.seller_id:o.buyer_id}</div><div class="offer-line"><strong>${money(o.price)}</strong><span class="small muted">${esc(offerStatus[o.status]||o.status)}</span></div>${o.status==='pending'?`<div class="item-ops">${received?button('accept-offer','Купить','primary',`data-id="${o.id}"`)+button('decline-offer','Отклонить','secondary',`data-id="${o.id}"`):button('cancel-offer','Отменить','secondary',`data-id="${o.id}"`)}</div>`:''}</div>`;}
async function loadOffers(){if(state.page!=='offers'||!state.player)return;const target=document.querySelector('#offers-list');if(!target)return;try{const d=await request('/api/offers');if(!target.isConnected)return;target.innerHTML=d.offers.length?d.offers.map(offerHtml).join(''):'<div class="panel form-card muted small">Пока предложений нет. Открой коллекцию и выбери «Продать по ID».</div>';}catch(e){toast(e.message,true);}}
function salesScreen(){return `${title('Таблица продаж','Последние продажи игре и сделки между игроками.')}<div class="panel sales-board" id="sales-list"><p class="muted small">Загрузка сделок…</p></div>`;}

function referralsScreen(){return `${title('Пригласи друзей','Приглашай игроков в Telegram Mini App и получай награды.')}
<div class="panel referral-hero"><div class="referral-icon">${icon('gift','lg')}</div><div class="overline">Награда за одного друга</div><div class="referral-reward">100 000 <span class="ruble">₽</span></div><p>Друг должен впервые запустить игру по твоей ссылке через свой Telegram-аккаунт.</p></div>
<div id="referrals-content" class="section"><div class="panel form-card muted small">Загружаем приглашения…</div></div>
<div class="notice" style="margin-top:18px">Начисление — пригласившему, один раз за каждого нового Telegram-пользователя. Простая регистрация на сайте и повторные входы не дают бонус. Все рубли только игровые.</div>`;}
function referralsHtml(info){const link=info.link;
 return `<div class="tile-grid referral-stats"><div class="tile"><div class="overline">Приглашено игроков</div><div class="value">${number.format(info.invited)}</div></div><div class="tile"><div class="overline">Получено с рефералов</div><div class="value">${money(info.earned)}</div></div></div>
 <div class="panel referral-link-card"><div class="feature-head">${icon('send')}<h3>Твоя ссылка</h3></div>
 ${link?`<label class="field" for="my-ref-link">Отправь эту ссылку другу</label><input class="text-input referral-link-input" type="text" id="my-ref-link" readonly value="${esc(link)}"/><div class="referral-actions">${button('copy-referral',`${icon('stack')} Копировать`,'secondary')} ${button('share-referral',`${icon('send')} Поделиться`,'primary')}</div>`:
 `<div class="notice">Для реферальной ссылки администратор игры должен добавить <code>MINI_APP_URL</code> — Telegram-ссылку на Mini App — в переменные окружения сервера. До настройки начисления по ссылке недоступны.</div>`}
 </div>
 <div class="section"><div class="section-head"><h2>Последние приглашённые</h2></div>
 ${info.recent?.length?`<div class="panel referral-list">${info.recent.map(p=>`<div class="referral-row"><div><strong>${esc(p.display_name)}</strong><div class="small muted">ID ${p.player_id}${p.telegram_username?' · TG @'+esc(p.telegram_username):''}</div></div><div class="referral-amount">+${money(p.reward)}</div></div>`).join('')}</div>`:empty('Приглашений пока нет','Поделись своей ссылкой с друзьями!','gift')}</div>`;}

const views={home,spin:spinScreen,market,collection,profile,leaderboard,transfer:transferPage,earn:earnScreen,casino:casinoScreen,sales:salesScreen,chat:chatScreen,offers:offersScreen,referrals:referralsScreen};
let seq=0;
async function render(){const token=++seq;
 if(!state.player){root.innerHTML=auth();return;}
 root.innerHTML=frame();
 const view=document.querySelector('#view');
 view.innerHTML=(views[state.page]||home)();
   if(state.page==='referrals'){
    try{const data=await request('/api/referrals');if(token!==seq)return;document.querySelector('#referrals-content').innerHTML=referralsHtml(data);}catch(e){if(token===seq)toast(e.message,true);}
  }
  if(state.page==='chat'){await loadChat();}
 if(state.page==='offers'){await loadOffers();}
 if(state.page==='collection'){
  try{const data=await request('/api/inventory');if(token!==seq)return;document.querySelector('#collection-list').innerHTML=data.items.length?`<div class="item-list">${data.items.map(i=>itemCard(i)).join('')}</div>`:empty('Пока нет юзернеймов','Сделай первую генерацию и начни свою коллекцию.','dice');}catch(e){if(token===seq)toast(e.message,true);}
 }
 if(state.page==='market'){
  try{const params=new URLSearchParams({q:state.marketQuery,tier:state.marketTier});const data=await request('/api/market?'+params);if(token!==seq)return;document.querySelector('#market-list').innerHTML=data.items.length?data.items.map(i=>itemCard(i,'market')).join(''):empty('Нет объявлений','Пока никто не продаёт такие ники. Выставь первый!','market');}catch(e){if(token===seq)toast(e.message,true);}
 }
 if(state.page==='leaderboard'){
  try{const data=await request('/api/leaderboard');if(token!==seq)return;document.querySelector('#leaderboard-list').innerHTML=`<div class="panel rank-list">${data.top.map(rankRow).join('')}</div>${data.me&&data.me.place>10?`<div class="own-rank"><div class="rank-number">#${data.me.place}</div><div class="rank-person"><strong>${esc(data.me.display_name)}</strong><div class="small muted">${data.me.telegram_username?'TG @'+esc(data.me.telegram_username):'Telegram не привязан'} · Ваше место по капиталу</div></div>${money(data.me.capital)}</div>`:''}`;}catch(e){if(token===seq)toast(e.message,true);}
 }
 if(state.page==='sales'){
  try{const data=await request('/api/sales');if(token!==seq)return;document.querySelector('#sales-list').innerHTML=data.items.length?data.items.map(r=>`<div class="sale-row"><div class="sale-top"><strong>@${esc(r.item_handle||'—')}</strong>${money(r.amount)}</div><div class="small muted">${r.kind==='market_sale'?'Рынок':r.kind==='private_sale'?'Продажа по ID':'Игра'} · ${esc(r.display_name)}${r.telegram_username?' · TG @'+esc(r.telegram_username):''} · ${dateStr(r.created_at)}</div></div>`).join(''):'<p class="muted small">Продаж пока не было</p>';}catch(e){if(token===seq)toast(e.message,true);}
 }
 if(state.page==='profile'){
  try{const data=await request('/api/history');if(token!==seq)return;const titles={work:'Контракт',free_spin:'Бесплатная генерация',casino:'Казино',spin:'Генерация',sell_game:'Продажа игре',listed:'Объявление',buy:'Покупка',market_sale:'Продажа на рынке',private_buy:'Личная покупка',private_sale:'Личная продажа',referral:'За приглашённого друга',daily:'Ежедневная награда',transfer_in:'Входящий перевод',transfer_out:'Исходящий перевод'};document.querySelector('#history-list').innerHTML=data.items.length?data.items.map(r=>`<div class="history-row"><div><strong>${esc(titles[r.kind]||r.kind)}</strong><small>${dateStr(r.created_at)}${r.other_name?' · '+esc(r.other_name):''}</small></div><b class="${r.amount>=0?'positive':'negative'}">${r.amount>0?'+':''}${number.format(r.amount)} ₽</b></div>`).join(''):'<p class="muted small">Пока нет операций</p>';}catch(e){if(token===seq)toast(e.message,true);}
 }
}
function go(page){if(state.busy)return;state.page=page;state.resolved=null;state.recipientQuery='';state.lastDrop=null;render();window.scrollTo({top:0,behavior:'instant'});}
async function playSpin(item){const plate=document.querySelector('#handle-plate'),txt=document.querySelector('#handle-text'),status=document.querySelector('#stage-status'),res=document.querySelector('#spin-result'),controls=document.querySelector('#spin-controls');
 if(!plate||!txt||!status||!res||!controls)return;
 controls.innerHTML='';res.innerHTML='';plate.className='handle-plate is-spinning';status.textContent='Генерация…';
 const delays=reduceMotion?[100,100]:[...Array(12).fill(56),...Array(7).fill(94),...Array(5).fill(150),220,280,350,450];
 const previews=new Set();
 for(let i=0;i<delays.length;i++){let candidate=randomDemo(state.selectedTier);for(let attempt=0;attempt<35&&previews.has(candidate);attempt++)candidate=randomDemo(state.selectedTier);previews.add(candidate);txt.textContent=candidate;plate.classList.remove('active');void plate.offsetWidth;plate.classList.add('active');if(i%2===0)audio.cue('tick');await sleep(delays[i]);}
 plate.className='handle-plate result '+item.tier;txt.textContent='@'+item.handle;status.innerHTML=tier(item.tier);audio.cue('drop',item.tier);
 res.innerHTML=`<div class="result-panel"><div class="result-name">Вы получили уникальный ник</div>${item.special?`<div class="result-special"><span class="special-pill">✦ ${esc(item.special)}</span></div>`:''}<div class="result-price">${money(item.appraisal)}</div><div class="stage-caption">Оценка игры · мгновенная продажа ${money(item.buyback)}</div><div class="result-btns">${button('sell',`Продать игре за ${money(item.buyback)}`,'primary full',`data-id="${item.id}"`)}${button('open-list',`${icon('market')} Выставить на рынок`,'full secondary',`data-id="${item.id}"`)}${button('keep',`${icon('stack')} В коллекцию`,'full secondary')}</div><div id="list-form-${item.id}"></div></div>`;
 controls.innerHTML=`<div class="stage-price">Следующая генерация</div>${button('spin',`${icon('dice')} Крутить ещё (${money((state.tiers.find(t=>t.id===state.selectedTier)||{cost:200}).cost)})`,'primary full')}`;
}
async function animateCasino(d){const reels=document.querySelector('#casino-reels'),result=document.querySelector('#casino-result');if(!reels||!result)return;
 const cells=[...reels.children],symbols=['7','◆','♠','✦','●'];result.textContent='Барабаны вращаются…';
 for(let i=0;i<(reduceMotion?4:19);i++){cells.forEach((x,j)=>x.textContent=symbols[Math.floor(Math.random()*symbols.length)]);if(i%3===0)audio.cue('tick');await sleep(reduceMotion?30:60+i*8);}
 if(d.multiplier===0){cells.forEach((x,j)=>x.textContent=['7','●','◆'][j]);}
 else if(d.multiplier<=1){cells.forEach((x,j)=>x.textContent=['7','7','●'][j]);}
 else{cells.forEach(x=>x.textContent=d.multiplier>=4?'7':'◆');}
 result.innerHTML=d.net>=0?`Выигрыш: <strong>${money(d.won)}</strong> · x${d.multiplier}`:`Проигрыш: <strong>${money(-d.net)}</strong>`;
 audio.cue(d.net>=0?'buy':'common');
}
async function doAction(btn){const action=btn.dataset.action,id=Number(btn.dataset.id);if(state.busy)return;
 try{
  if(action==='spin'||action==='free-spin'){
   audio.unlock();state.busy=true;btn.disabled=true;const d=await request(action==='spin'?'/api/spin':'/api/free-spin',{method:'POST',body:action==='spin'?{tier:state.selectedTier}:{}});syncPlayer(d.player);state.lastDrop=d.item;await playSpin(d.item);state.busy=false;return;
  }
  if(action==='keep'){go('collection');return;}
  if(action==='sound'){state.muted=!state.muted;try{localStorage.setItem('game-muted',state.muted?'1':'0')}catch{}if(!state.muted)audio.cue('equip');render();return;}
  if(action==='work'){audio.unlock();const d=await request('/api/work',{method:'POST',body:{}});syncPlayer(d.player);audio.cue('work');toast(`Заработано ${number.format(d.amount)} ₽`);render();return;}
  if(action==='casino'){audio.unlock();state.busy=true;btn.disabled=true;try{const d=await request('/api/casino',{method:'POST',body:{bet:state.casinoBet}});syncPlayer(d.player);await animateCasino(d);}finally{state.busy=false;btn.disabled=false;}return;}
  if(action==='copy-referral'){
    const input=document.querySelector('#my-ref-link');if(!input||!input.value)throw Error('Реферальная ссылка недоступна');
    if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(input.value);}
    else{input.focus();input.select();if(!document.execCommand('copy'))throw Error('Выдели ссылку и скопируй вручную');}
    toast('Ссылка скопирована!');return;
  }
  if(action==='share-referral'){
    const input=document.querySelector('#my-ref-link');if(!input||!input.value)throw Error('Реферальная ссылка недоступна');
    const share='https://t.me/share/url?'+new URLSearchParams({url:input.value,text:'Заходи в Username Generator | Game! Собирай редкие игровые ники и торгуй ими.'});
    if(window.Telegram?.WebApp?.openTelegramLink)window.Telegram.WebApp.openTelegramLink(share);
    else window.open(share,'_blank','noopener,noreferrer');
    return;
  }
  if(action==='reload-offers'){await loadOffers();return;}
  if(['accept-offer','decline-offer','cancel-offer'].includes(action)){
   const command=action.replace('-offer','');
   if(command==='accept'&&!confirm('Купить этот ник за указанную сумму? Оплата спишется с твоего баланса.'))return;
   const d=await request(`/api/offers/${id}/${command}`,{method:'POST',body:{}});
   if(d.player)syncPlayer(d.player);
   if(command==='accept'){audio.cue('buy');toast('Юзернейм получен!');}
   else toast('Статус предложения изменён');
   await loadOffers();return;
  }
  if(action==='open-offer'){
   const target=document.getElementById('offer-form-'+id);if(!target)return;
   target.innerHTML=`<form data-offer-id="${id}" class="offer-create"><label class="field">ID покупателя</label><input class="text-input" name="buyer_id" type="number" min="1" step="1" placeholder="Например, 15" required/><label class="field">Цена в игровых рублях</label><input class="text-input" name="price" type="number" min="1" max="1000000000" step="1" placeholder="От 1 до 1 000 000 000" required/><button class="btn primary full" type="submit">Отправить предложение</button></form>`;
   target.querySelector('input').focus();return;
  }
  if(action==='open-list'){
   const target=document.getElementById('list-form-'+id);if(!target)return;target.innerHTML=`<form data-list-id="${id}" class="list-price-form"><input name="price" class="text-input" type="number" min="100" max="100000000" step="1" placeholder="Твоя цена, ₽" required/><button class="btn ghost" type="submit">Выставить</button></form>`;target.querySelector('input').focus();return;
  }
  if(action==='resolve'){
   state.recipientQuery=document.querySelector('#recipient')?.value.trim()||'';
   const data=await request('/api/players/resolve?q='+encodeURIComponent(state.recipientQuery));
   if(data.player.id===state.player.id)throw Error('Нельзя отправлять перевод себе');
   state.resolved=data.player;document.querySelector('#recipient-preview').innerHTML=recipientCard(data.player);document.querySelector('[data-action="transfer"]').disabled=false;return;
  }
  if(action==='transfer'){
   if(!state.resolved)throw Error('Сначала найдите получателя');
   const amount=Number(document.querySelector('#amount').value);
   if(!Number.isSafeInteger(amount)||amount<10||amount>500000000)throw Error('Укажите сумму от 10 до 500 000 000 ₽');
   if(!confirm(`Отправить ${number.format(amount)} ₽ игроку ${state.resolved.display_name} (ID ${state.resolved.id})?`))return;
   const d=await request('/api/transfers',{method:'POST',body:{to_id:state.resolved.id,amount}});syncPlayer(d.player);toast(`Перевод ${number.format(amount)} ₽ выполнен`);state.resolved=null;state.recipientQuery='';await render();return;
  }
  if(action==='logout'){
   await request('/api/auth/logout',{method:'POST',body:{}});state.player=null;state.csrf=null;state.page='home';render();return;
  }
  if(action==='daily'){
   const d=await request('/api/daily',{method:'POST',body:{}});syncPlayer(d.player);toast(`Начислено ${number.format(d.amount)} ₽`);render();return;
  }
  if(action==='equip'){
   const selected=state.player.equipped_item_id===id?null:id;const d=await request('/api/equip',{method:'POST',body:{item_id:selected}});syncPlayer(d.player);audio.cue('equip');toast(selected?'Ник установлен в профиль':'Ник снят с профиля');await render();return;
  }
  if(action==='sell'){
   if(!confirm('Продать этот ник игре? Вернуть его после продажи нельзя.'))return;
   const d=await request(`/api/items/${id}/sell`,{method:'POST',body:{}});syncPlayer(d.player);audio.cue('sell');toast(`Получено ${number.format(d.amount)} ₽`);state.lastDrop=null;await render();return;
  }
  if(action==='unlist'){
   await request(`/api/items/${id}/unlist`,{method:'POST',body:{}});toast('Лот снят с продажи');await render();return;
  }
  if(action==='buy'){
   if(!confirm('Купить этот юзернейм у игрока?'))return;
   const d=await request(`/api/market/${id}/buy`,{method:'POST',body:{}});syncPlayer(d.player);audio.cue('buy');toast(`@${d.item.handle} теперь твой!`);await render();return;
  }
 }catch(e){toast(e.message,true);if(action==='spin'||action==='free-spin'){state.busy=false;render();}}
}
root.addEventListener('click',async ev=>{
 const authBtn=ev.target.closest('[data-authmode]');if(authBtn){state.authMode=authBtn.dataset.authmode;render();return;}
 const goBtn=ev.target.closest('[data-go]');if(goBtn){go(goBtn.dataset.go);return;}
 const tierBtn=ev.target.closest('[data-tier]');if(tierBtn){state.selectedTier=tierBtn.dataset.tier;render();return;}
 const betBtn=ev.target.closest('[data-bet]');if(betBtn){state.casinoBet=Number(betBtn.dataset.bet);render();return;}
 const actionBtn=ev.target.closest('[data-action]');if(actionBtn){if(actionBtn.disabled)return;audio.unlock();await doAction(actionBtn);}
});
root.addEventListener('submit',async ev=>{
 const form=ev.target;
 if(form.id==='auth-form'){
  ev.preventDefault();const data=Object.fromEntries(new FormData(form));const url=state.authMode==='register'?'/api/auth/register':'/api/auth/login';
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  try{const r=await request(url,{method:'POST',body:data});state.player=r.player;state.csrf=r.csrf;state.page='home';render();toast('Добро пожаловать!');}catch(e){toast(e.message,true);submit.disabled=false;}
  return;
 }
 if(form.id==='market-search'){
  ev.preventDefault();const f=new FormData(form);state.marketQuery=String(f.get('q')||'').trim();state.marketTier=String(f.get('tier')||'');render();return;
 }
 if(form.id==='chat-form'){
  ev.preventDefault();const input=form.querySelector('[name="message"]'),message=input.value.trim();if(!message)return;
  const submit=form.querySelector('button');submit.disabled=true;
  try{await request('/api/chat',{method:'POST',body:{message}});input.value='';await loadChat();const feed=document.querySelector('#chat-feed');if(feed)feed.scrollTop=feed.scrollHeight;}
  catch(e){toast(e.message,true);}finally{submit.disabled=false;}return;
 }
 if(form.dataset.offerId){
  ev.preventDefault();const itemId=Number(form.dataset.offerId),data=Object.fromEntries(new FormData(form));
  const buyerId=Number(data.buyer_id),price=Number(data.price);
  try{
   if(!Number.isSafeInteger(buyerId)||buyerId<1||!Number.isSafeInteger(price)||price<1||price>1000000000)throw Error('Проверь ID и цену от 1 до 1 млрд ₽');
   const d=await request('/api/players/resolve?q='+encodeURIComponent('#'+buyerId));
   if(!confirm(`Отправить игроку ${d.player.display_name} (ID ${buyerId}) предложение купить ник за ${number.format(price)} ₽?`))return;
   await request('/api/offers',{method:'POST',body:{item_id:itemId,buyer_id:buyerId,price}});
   toast('Предложение отправлено!');go('offers');
  }catch(e){toast(e.message,true);}return;
 }
 if(form.dataset.listId){
  ev.preventDefault();const id=Number(form.dataset.listId),price=Number(new FormData(form).get('price'));
  try{if(!Number.isSafeInteger(price))throw Error('Введите целую цену');await request(`/api/items/${id}/list`,{method:'POST',body:{price}});audio.cue('sell');toast('Ник выставлен на общий рынок');state.lastDrop=null;await render();}catch(e){toast(e.message,true);}return;
 }
});
root.addEventListener('change',ev=>{if(ev.target.closest('#market-search')&&ev.target.matches('select')){const form=ev.target.closest('form'),fd=new FormData(form);state.marketTier=String(fd.get('tier')||'');state.marketQuery=String(fd.get('q')||'').trim();render();}});
root.addEventListener('input',ev=>{if(ev.target.id==='recipient'){state.resolved=null;const p=document.querySelector('#recipient-preview');if(p)p.innerHTML='';const b=document.querySelector('[data-action="transfer"]');if(b)b.disabled=true;}});
async function boot(){
 try{
  const d=await request('/api/bootstrap');
  // Inside Telegram always verify its current identity first; an old browser
  // session should not hide a first-time referral visit from a different user.
  const initData=window.Telegram?.WebApp?.initData;
  if(initData){
   try{const t=await request('/api/auth/telegram',{method:'POST',body:{initData}});state.player=t.player;state.csrf=t.csrf;const b=await request('/api/bootstrap');state.spinCost=b.spin_cost;state.tiers=b.tiers;state.commonOdds=b.common_spin_odds||[];state.dailyBonus=b.daily_bonus;window.Telegram.WebApp.ready();window.Telegram.WebApp.expand();await render();return;}catch(e){toast('Telegram-вход: '+e.message,true);}
  }
  if(d.authenticated){state.player=d.player;state.csrf=d.csrf;state.spinCost=d.spin_cost;state.tiers=d.tiers;state.commonOdds=d.common_spin_odds||[];state.dailyBonus=d.daily_bonus;await render();return;}
  state.tiers=[['common',200,9,13],['uncommon',800,7,9],['rare',3000,6,7],['epic',12000,5,6],['legendary',65000,1,4]].map(([id,cost,a,b])=>({id,cost,lengths:[a,b],label:tierNames[id]}));
  render();
 }catch(e){root.innerHTML=`<div class="loader-page"><h2>Нет связи с сервером</h2><p class="muted">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Повторить</button></div>`;}
}
boot();

// Refresh chat and private offers while their screens are visible.
setInterval(()=>{if(!state.player||document.hidden)return;if(state.page==='chat')loadChat();else if(state.page==='offers')loadOffers();},4500);
