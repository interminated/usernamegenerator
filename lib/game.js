'use strict';
const crypto=require('node:crypto');
const {transaction}=require('./database');
const {error}=require('./auth');
const START_BALANCE=25000;
const DAILY_BONUS=4000;
const DAILY_COOLDOWN=24*3600;
const TRANSFER_LIMIT=500000000;
const MARKET_FEE_PERCENT=5;
// Only the ordinary roll has an upgrade chance. All other paid tiers stay guaranteed.
// Ordinary buyback was rebalanced to keep the advertised roll sustainable.
const TIERS=[
 {id:'common',label:'Обычный',cost:200,min:50,max:150,lengths:[9,13]},
 {id:'uncommon',label:'Необычный',cost:800,min:370,max:880,lengths:[7,9]},
 {id:'rare',label:'Редкий',cost:3000,min:1500,max:3550,lengths:[6,7]},
 {id:'epic',label:'Эпический',cost:12000,min:5300,max:14600,lengths:[5,6]},
 {id:'legendary',label:'Легендарный',cost:65000,min:40000,max:60000,lengths:[1,4]}
];
const SPIN_COST=TIERS[0].cost;
// Probability is resolved on the server, in tenths of a percent. Sum = 1000.
// ordinary: 89%, unusual: 10%, rare: 0.9%, epic: 0.1%, legendary: 0%.
const COMMON_SPIN_ODDS=Object.freeze([
 {tier:'common',label:'Обычный',percent:89,weight:890},
 {tier:'uncommon',label:'Необычный',percent:10,weight:100},
 {tier:'rare',label:'Редкий',percent:0.9,weight:9},
 {tier:'epic',label:'Эпический',percent:0.1,weight:1}
]);
const random=(a,b)=>crypto.randomInt(a,b+1);
const pick=a=>a[crypto.randomInt(a.length)];
const digits=n=>Array.from({length:n},()=>String(random(0,9))).join('');
// Real words, understandable word combinations and pronounceable syllables.
// No arbitrary random-letter strings or cut-off tails.
const ROOTS=[
 'ghost','shadow','storm','night','light','moon','sun','star','wolf','fox','lion','raven','viper','eagle',
 'neon','pixel','vortex','nova','orbit','solar','lunar','space','comet','galaxy','cosmo','astro','zenith',
 'king','queen','royal','crown','boss','alpha','omega','legend','prime','ultra','super','master','elite',
 'gold','silver','ruby','diamond','onyx','steel','frost','ice','flame','fire','blaze','spark','flash','glow',
 'echo','vibe','wave','flow','dream','magic','mystic','lucky','seven','zero','void','dark','bright','sky',
 'swift','rapid','turbo','power','speed','drift','race','drive','urban','city','street','metro','nightly',
 'code','byte','data','cyber','cloud','core','logic','vector','matrix','quantum','server','crypto',
 'cash','money','mint','bank','profit','rich','lux','vip','pro','max','top','nice','cool','flex','hype',
 'zen','ace','ray','neo','sky','ice','fox','owl','jet','rex','one','joy','sun','air','red','blue'
];
const PREFIXES=['real','the','its','iam','mr','my','neo','ultra','hyper','dark','gold','icy','prime','mini','super','nova','only','true','x','max','top','new','hey'];
const SUFFIXES=['pro','tv','gg','go','fx','xo','one','zone','club','lab','hub','core','base','plus','verse','craft','world','x','rx'];
const NICE_NUMS=['7','0','1','9','11','22','33','42','55','66','77','88','99','01','007','101','111','123','202','222','333','404','555','666','707','777','808','888','909','999','2026'];
const SHORT_FAVORITES=[
 'x','z','q','v','a','m','7','0','9','ok','go','hi','gg','tv','xo','io','ai','rx','xx','zz','77','99','00',
 'zen','neo','vip','pro','top','god','ace','max','fox','sky','sun','ice','joy','one','777','000','111','999','007',
 'king','boss','love','gold','zero','moon','cool','dark','fire','star','wolf','mint','nova','cash','vibe','hype','flex','glow'
];
const SYLLABLES=['ra','na','ve','lo','mi','ri','ka','zo','li','so','vi','no','xo','ze','va','lu','ta','mo','ne','ki','ro','la','fy','ry','ma','bo','vo','da','jo','sa','el','an','ex','or','ix','en','ar','neo','zen','tor','lin','ven','rix','nor','sol','ari','ava'];
const HANDLE_LENGTHS={common:[9,13],uncommon:[7,9],rare:[6,7],epic:[5,6],legendary:[1,4]};
function shortHandle(){
 // One- and two-character names are rare by design.
 const p=random(0,999),len=p<2?1:p<18?2:p<140?3:4;
 for(let i=0;i<90;i++){
  const mode=random(0,5);
  let name='';
  if(mode===0)name=pick([...SHORT_FAVORITES,'777','000','king','boss','vip','007','999','love','gold']);
  else if(mode===1)name=pick(ROOTS);
  else if(mode===2)name=pick(SYLLABLES)+pick(SYLLABLES);
  else if(mode===3)name=pick(['x','z','v','q','k','m','a','n'])+pick(NICE_NUMS);
  else if(mode===4)name=pick(['7','9','0','1','8'])+pick(['7','9','0','1','8'])+pick(['7','9','0','1','8']);
  else name=pick(SHORT_FAVORITES)+pick(['7','9','0','1']);
  if(name.length===len)return name;
 }
 return len===1?pick('xqzvm790'):len===2?pick(['gg','tv','99','zz','rx']):len===3?pick(['zen','neo','777','vip']):pick(['king','boss','moon','gold']);
}
function makeHandle(tier){
 const lengths=HANDLE_LENGTHS[tier]||HANDLE_LENGTHS.common;
 if(tier==='legendary')return shortHandle();
 const [min,max]=lengths;
 for(let i=0;i<160;i++){
  const word=pick(ROOTS),other=pick(ROOTS),prefix=pick(PREFIXES),suffix=pick(SUFFIXES),num=pick(NICE_NUMS);
  const mode=random(0,10);
  let name;
  if(mode===0)name=word;
  else if(mode===1)name=word+other;
  else if(mode===2)name=prefix+word;
  else if(mode===3)name=word+suffix;
  else if(mode===4)name=word+'_'+other;
  else if(mode===5)name=word+num;
  else if(mode===6)name=prefix+word+num;
  else if(mode===7)name=word+'_'+num;
  else if(mode===8)name=word+digits(random(2,4));
  else if(mode===9)name=prefix+word+digits(random(1,3));
  else name=word+'_'+suffix;
  if(name&&name.length>=min&&name.length<=max&&/^[a-z0-9_]+$/.test(name))return name;
 }
 // Extremely unlikely fallback: a real word followed by a short numeric suffix.
 for(let i=0;i<400;i++){const w=pick(ROOTS),n=random(1,4);if(w.length+n>=min&&w.length+n<=max)return w+digits(n);}
 throw error('Не получилось подобрать читаемый ник. Повтори попытку.',503);
}
// The chosen tier is the price paid, not necessarily the tier that drops.
function rollTier(chosenId='common',sample=crypto.randomInt(1000)){
 if(chosenId!=='common')return tierOf(chosenId);
 if(!Number.isSafeInteger(sample)||sample<0||sample>=1000)throw error('Некорректный результат генерации');
 let cursor=0;
 for(const option of COMMON_SPIN_ODDS){cursor+=option.weight;if(sample<cursor)return tierOf(option.tier);}
 return tierOf('common');
}
function tierOf(id){return TIERS.find(t=>t.id===id);}
function saleValue(tier,handle){
 if(tier.id!=='legendary')return random(tier.min,tier.max);
 if(handle.length===1)return random(500000,920000);
 if(handle.length===2)return random(130000,260000);
 if(handle.length===3)return random(56000,115000);
 return random(tier.min,tier.max);
}
const PRESTIGE_WORDS=new Set(['king','vip','boss','gold','love','zero','moon','wolf','star','cash','777','000','111','999','007','123','9999','7777']);
function specialFor(name){
 if(name.length===1)return 'Один символ';
 if(name.length===2)return 'Два символа';
 if(PRESTIGE_WORDS.has(name))return 'Культовый ник';
 if(/^([0-9])\1{2,}$/.test(name))return 'Одинаковые цифры';
 if(/^(?:123|234|345|456|567|678|789|012)(?:[0-9])?$/.test(name))return 'Последовательность';
 if(/^([a-z0-9])\1{2,}$/.test(name))return 'Повтор символов';
 if(/^(?:king|boss|vip|gold|ghost|neon|love|money)(?:7|77|777|00|01|007|99|999)$/.test(name))return 'Красивое сочетание';
 if(name.length>=3&&name.length<=6&&name===name.split('').reverse().join(''))return 'Палиндром';
 return null;
}
function getItem(db,id){return db.prepare('SELECT i.*,l.id AS listing_id,l.price AS listing_price FROM items i LEFT JOIN listings l ON i.id=l.item_id WHERE i.id=?').get(id);}
function getPlayer(db,id){
 const p=db.prepare('SELECT id,login,display_name,telegram_id,telegram_username,balance,experience,equipped_item_id,last_daily_at,last_work_at,work_day,work_count,last_free_spin_at,free_spin_day,free_spin_count,last_casino_at,created_at FROM players WHERE id=?').get(id);
 if(!p)return null;
 const e=p.equipped_item_id?db.prepare('SELECT handle,tier FROM items WHERE id=? AND owner_id=?').get(p.equipped_item_id,id):null;
 const a=db.prepare('SELECT COALESCE(SUM(buyback),0) AS assets,COUNT(*) AS collection_size FROM items WHERE owner_id=?').get(id);
 return {...p,equipped_handle:e?.handle||null,equipped_tier:e?.tier||null,capital:p.balance+a.assets,collection_size:a.collection_size,level:Math.floor(Math.sqrt(p.experience/140))+1};
}
function log(db,kind,actor,other,amount,itemId=null,itemHandle=null){db.prepare('INSERT INTO transactions_log(kind,actor_id,other_id,item_id,item_handle,amount,created_at) VALUES(?,?,?,?,?,?,?)').run(kind,actor,other,itemId,itemHandle,amount,Math.floor(Date.now()/1000));}
function newItem(db,playerId,tier,now=Math.floor(Date.now()/1000)){
 for(let i=0;i<500;i++){
  const handle=makeHandle(tier.id);
  if(!/^[a-z0-9_]{1,28}$/.test(handle))continue;
  const reserved=db.prepare('INSERT OR IGNORE INTO generated_handles(handle,generated_at) VALUES(?,?)').run(handle,now);
  if(!reserved.changes)continue;
  const special=specialFor(handle);
  const base=saleValue(tier,handle);
  const buyback=special?Math.floor(base*1.12):base,appraisal=Math.floor(buyback/0.80);
  const created=db.prepare('INSERT INTO items(handle,owner_id,tier,appraisal,buyback,created_at,special) VALUES(?,?,?,?,?,?,?)').run(handle,playerId,tier.id,appraisal,buyback,now,special);
  return getItem(db,Number(created.lastInsertRowid));
 }
 throw error('Пока не получилось найти свободный ник в категории. Повтори попытку.',503);
}
function spin(db,playerId,tierId='common',free=false,now=Math.floor(Date.now()/1000)){
 return transaction(db,()=>{
  const p=getPlayer(db,playerId),chosenTier=tierOf(tierId);
  if(!p)throw error('Аккаунт не найден',401);
  if(!chosenTier)throw error('Неизвестная редкость');
  if(free&&tierId!=='common')throw error('Бесплатная генерация доступна только для обычных ников');
  if(free){
   const today=Math.floor(now/86400),count=p.free_spin_day===today?p.free_spin_count:0;
   if(count>=5)throw error('Пять бесплатных генераций сегодня уже использованы');
   if(now-p.last_free_spin_at<30*60)throw error('Бесплатная генерация будет доступна позже');
  }else if(p.balance<chosenTier.cost)throw error('Недостаточно игровых рублей');
  const tier=rollTier(tierId);
  const item=newItem(db,playerId,tier,now);
  if(free){
   db.prepare('UPDATE players SET experience=experience+5,last_free_spin_at=?,free_spin_day=?,free_spin_count=? WHERE id=?').run(now,Math.floor(now/86400),p.free_spin_day===Math.floor(now/86400)?p.free_spin_count+1:1,playerId);
   log(db,'free_spin',playerId,null,0,item.id,item.handle);
  }else{
   db.prepare('UPDATE players SET balance=balance-?,experience=experience+10 WHERE id=?').run(chosenTier.cost,playerId);
   log(db,'spin',playerId,null,-chosenTier.cost,item.id,item.handle);
  }
  return {item,player:getPlayer(db,playerId),cost:free?0:chosenTier.cost};
 });
}
function expireOffers(db,now=Math.floor(Date.now()/1000)){
 db.prepare("UPDATE trade_offers SET status='expired',resolved_at=? WHERE status='pending' AND expires_at<=?").run(now,now);
}
function hasPendingOffer(db,itemId){expireOffers(db);return !!db.prepare("SELECT 1 FROM trade_offers WHERE item_id=? AND status='pending'").get(itemId);}
function sendOffer(db,sellerId,buyerId,itemId,price,now=Math.floor(Date.now()/1000)){
 return transaction(db,()=>{
  if(!Number.isSafeInteger(buyerId)||buyerId<=0||buyerId===sellerId)throw error('Укажите ID другого игрока');
  if(!Number.isSafeInteger(itemId)||itemId<=0)throw error('Некорректный предмет');
  if(!Number.isSafeInteger(price)||price<1||price>1000000000)throw error('Цена должна быть от 1 до 1 000 000 000 ₽');
  const buyer=getPlayer(db,buyerId);if(!buyer)throw error('Получатель не найден',404);
  const item=getItem(db,itemId);if(!item||item.owner_id!==sellerId)throw error('Ник не принадлежит продавцу',404);
  if(item.listing_id)throw error('Сначала снимите объявление с рынка');
  expireOffers(db,now);
  if(hasPendingOffer(db,itemId))throw error('Для этого ника уже есть активное предложение',409);
  const id=db.prepare("INSERT INTO trade_offers(item_id,seller_id,buyer_id,price,status,created_at,expires_at) VALUES(?,?,?,?,'pending',?,?)").run(itemId,sellerId,buyerId,price,now,now+86400).lastInsertRowid;
  return {offer_id:Number(id),buyer:{id:buyer.id,display_name:buyer.display_name},price};
 });
}
function tradeOffers(db,playerId,now=Math.floor(Date.now()/1000)){
 expireOffers(db,now);
 return db.prepare(`SELECT o.*,i.handle,i.tier,i.special,ps.display_name AS seller_name,pb.display_name AS buyer_name
 FROM trade_offers o JOIN items i ON i.id=o.item_id
 JOIN players ps ON ps.id=o.seller_id JOIN players pb ON pb.id=o.buyer_id
 WHERE o.seller_id=? OR o.buyer_id=? ORDER BY o.id DESC LIMIT 80`).all(playerId,playerId);
}
function updateOffer(db,playerId,offerId,action,now=Math.floor(Date.now()/1000)){
 expireOffers(db,now);
 return transaction(db,()=>{
  if(!Number.isSafeInteger(offerId)||offerId<=0)throw error('Некорректное предложение');
  const o=db.prepare('SELECT o.*,i.owner_id,i.handle,i.tier,l.id AS listing_id FROM trade_offers o JOIN items i ON i.id=o.item_id LEFT JOIN listings l ON l.item_id=i.id WHERE o.id=?').get(offerId);
  if(!o)throw error('Предложение не найдено',404);
  if(o.status!=='pending')throw error('Предложение уже завершено',409);
  if(o.owner_id!==o.seller_id||o.listing_id)throw error('Предмет больше недоступен',409);
  if(action==='accept'){
   if(playerId!==o.buyer_id)throw error('Только покупатель может принять предложение',403);
   const buyer=getPlayer(db,playerId);
   if(buyer.balance<o.price)throw error('Недостаточно средств для покупки');
   const fee=Math.floor(o.price*MARKET_FEE_PERCENT/100),sellerReceives=o.price-fee;
   const seller=getPlayer(db,o.seller_id);
   if(!Number.isSafeInteger(seller.balance+sellerReceives))throw error('Превышен допустимый баланс',400);
   db.prepare('UPDATE players SET balance=balance-? WHERE id=?').run(o.price,playerId);
   db.prepare('UPDATE players SET balance=balance+?,equipped_item_id=CASE WHEN equipped_item_id=? THEN NULL ELSE equipped_item_id END WHERE id=?').run(sellerReceives,o.item_id,o.seller_id);
   db.prepare('UPDATE items SET owner_id=? WHERE id=?').run(playerId,o.item_id);
   db.prepare("UPDATE trade_offers SET status='accepted',resolved_at=? WHERE id=?").run(now,o.id);
   log(db,'private_buy',playerId,o.seller_id,-o.price,o.item_id,o.handle);
   log(db,'private_sale',o.seller_id,playerId,sellerReceives,o.item_id,o.handle);
   return {ok:true,fee,seller_receives:sellerReceives,player:getPlayer(db,playerId)};
  }
  if(action==='decline'){
   if(playerId!==o.buyer_id)throw error('Только покупатель может отклонить',403);
   db.prepare("UPDATE trade_offers SET status='declined',resolved_at=? WHERE id=?").run(now,o.id);
  }else if(action==='cancel'){
   if(playerId!==o.seller_id)throw error('Только продавец может отменить',403);
   db.prepare("UPDATE trade_offers SET status='cancelled',resolved_at=? WHERE id=?").run(now,o.id);
  }else throw error('Неподдерживаемое действие');
  return {ok:true};
 });
}
function chatMessages(db){return db.prepare(`SELECT m.id,m.player_id,m.message,m.created_at,p.display_name,p.telegram_username,
 i.handle AS equipped_handle FROM chat_messages m JOIN players p ON p.id=m.player_id
 LEFT JOIN items i ON i.id=p.equipped_item_id AND i.owner_id=p.id ORDER BY m.id DESC LIMIT 80`).all().reverse();}
function postChat(db,playerId,message,now=Math.floor(Date.now()/1000)){
 if(typeof message!=='string')throw error('Введите сообщение');
 message=message.replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 if(message.length<1||message.length>280)throw error('Сообщение должно содержать от 1 до 280 символов');
 return transaction(db,()=>{
  const latest=db.prepare('SELECT created_at FROM chat_messages WHERE player_id=? ORDER BY id DESC LIMIT 1').get(playerId);
  if(latest&&now-latest.created_at<3)throw error('Подожди 3 секунды перед следующим сообщением',429);
  const count=db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE player_id=? AND created_at>?').get(playerId,now-60).n;
  if(count>=12)throw error('Не более 12 сообщений в минуту',429);
  const id=db.prepare('INSERT INTO chat_messages(player_id,message,created_at) VALUES(?,?,?)').run(playerId,message,now).lastInsertRowid;
  db.prepare('DELETE FROM chat_messages WHERE id<(SELECT COALESCE(MAX(id)-1500,0) FROM chat_messages)').run();
  return {id:Number(id)};
 });
}
function sellToGame(db,playerId,itemId){return transaction(db,()=>{
 const i=getItem(db,itemId);
 if(!i||i.owner_id!==playerId)throw error('Юзернейм не найден',404);
 if(i.listing_id)throw error('Сначала снимите лот с рынка');
 if(hasPendingOffer(db,itemId))throw error('Сначала отмените персональное предложение');
 db.prepare('UPDATE players SET equipped_item_id=NULL WHERE id=? AND equipped_item_id=?').run(playerId,itemId);
 db.prepare('DELETE FROM items WHERE id=?').run(itemId);
 db.prepare('UPDATE players SET balance=balance+? WHERE id=?').run(i.buyback,playerId);
 log(db,'sell_game',playerId,null,i.buyback,itemId,i.handle);
 return {amount:i.buyback,player:getPlayer(db,playerId)};
});}
function listItem(db,playerId,itemId,price){return transaction(db,()=>{
 if(!Number.isSafeInteger(price)||price<100||price>100000000)throw error('Цена должна быть от 100 до 100 000 000 ₽');
 const i=getItem(db,itemId);
 if(!i||i.owner_id!==playerId)throw error('Юзернейм не найден',404);
 if(i.listing_id)throw error('Уже выставлен на рынке');
 if(hasPendingOffer(db,itemId))throw error('Сначала отмените персональное предложение');
 const r=db.prepare('INSERT INTO listings(item_id,seller_id,price,created_at) VALUES(?,?,?,?)').run(itemId,playerId,price,Math.floor(Date.now()/1000));
 log(db,'listed',playerId,null,price,itemId,i.handle);
 return {listing_id:Number(r.lastInsertRowid),item:getItem(db,itemId)};
});}
function unlist(db,playerId,itemId){return transaction(db,()=>{
 const listing=db.prepare('SELECT * FROM listings WHERE item_id=? AND seller_id=?').get(itemId,playerId);
 if(!listing)throw error('Ваш лот не найден',404);
 db.prepare('DELETE FROM listings WHERE id=?').run(listing.id);
 return {item:getItem(db,itemId)};
});}
function buy(db,buyerId,listingId){return transaction(db,()=>{
 const l=db.prepare('SELECT l.*,i.owner_id,i.handle,i.tier FROM listings l JOIN items i ON i.id=l.item_id WHERE l.id=?').get(listingId);
 if(!l)throw error('Лот уже продан или снят',404);
 if(l.seller_id===buyerId)throw error('Нельзя покупать собственный лот');
 if(l.owner_id!==l.seller_id)throw error('Лот устарел',409);
 const b=getPlayer(db,buyerId);
 if(!b||b.balance<l.price)throw error('Недостаточно игровых рублей');
 const fee=Math.max(1,Math.floor(l.price*MARKET_FEE_PERCENT/100)),sellerReceives=l.price-fee;
 db.prepare('UPDATE players SET balance=balance-? WHERE id=?').run(l.price,buyerId);
 db.prepare('UPDATE players SET balance=balance+? WHERE id=?').run(sellerReceives,l.seller_id);
 db.prepare('UPDATE players SET equipped_item_id=NULL WHERE id=? AND equipped_item_id=?').run(l.seller_id,l.item_id);
 db.prepare('DELETE FROM listings WHERE id=?').run(l.id);
 db.prepare('UPDATE items SET owner_id=? WHERE id=?').run(buyerId,l.item_id);
 log(db,'buy',buyerId,l.seller_id,-l.price,l.item_id,l.handle);
 log(db,'market_sale',l.seller_id,buyerId,sellerReceives,l.item_id,l.handle);
 return {item:getItem(db,l.item_id),seller_receives:sellerReceives,fee,player:getPlayer(db,buyerId)};
});}
function equip(db,playerId,itemId){return transaction(db,()=>{
 if(itemId!==null){const i=getItem(db,itemId);if(!i||i.owner_id!==playerId)throw error('Нет такого юзернейма в коллекции',404);}
 db.prepare('UPDATE players SET equipped_item_id=? WHERE id=?').run(itemId,playerId);
 return getPlayer(db,playerId);
});}
function resolveRecipient(db,query){
 if(typeof query!=='string'||query.length>64)throw error('Введите ID или игровой ник');
 query=query.trim();if(!query)throw error('Введите ID или игровой ник');
 if(/^(?:#)?\d+$/.test(query))return getPlayer(db,Number(query.replace('#','')));
 const term=query.replace(/^@/,'').toLowerCase();
 if(!/^[a-z0-9_]{1,28}$/.test(term))throw error('Некорректный ID или ник');
 const byLogin=db.prepare('SELECT id FROM players WHERE login=?').get(term);
 const byHandle=db.prepare('SELECT p.id FROM players p JOIN items i ON i.id=p.equipped_item_id AND i.owner_id=p.id WHERE i.handle=?').get(term);
 if(byHandle&&byLogin&&byHandle.id!==byLogin.id)throw error('Ник неоднозначен. Укажите ID игрока');
 return getPlayer(db,(byHandle||byLogin)?.id);
}
function transfer(db,fromId,toId,amount){return transaction(db,()=>{
 if(!Number.isSafeInteger(amount)||amount<10||amount>TRANSFER_LIMIT)throw error('Сумма от 10 до 500 000 000 ₽');
 if(!Number.isSafeInteger(toId)||toId===fromId)throw error('Нельзя перевести себе');
 const recipient=getPlayer(db,toId);if(!recipient)throw error('Игрок не найден',404);
 const sender=getPlayer(db,fromId);if(!sender||sender.balance<amount)throw error('Недостаточно средств');
 db.prepare('UPDATE players SET balance=balance-? WHERE id=?').run(amount,fromId);
 db.prepare('UPDATE players SET balance=balance+? WHERE id=?').run(amount,toId);
 log(db,'transfer_out',fromId,toId,-amount);
 log(db,'transfer_in',toId,fromId,amount);
 return {recipient:{id:recipient.id,display_name:recipient.display_name,login:recipient.login,equipped_handle:recipient.equipped_handle},amount,player:getPlayer(db,fromId)};
});}
function daily(db,playerId,now=Math.floor(Date.now()/1000)){return transaction(db,()=>{
 const p=getPlayer(db,playerId);if(!p)throw error('Игрок не найден',404);
 if(now-p.last_daily_at<DAILY_COOLDOWN)throw error('Награда уже получена. Приходите позже');
 db.prepare('UPDATE players SET balance=balance+?,last_daily_at=? WHERE id=?').run(DAILY_BONUS,now,playerId);
 log(db,'daily',playerId,null,DAILY_BONUS);
 return {amount:DAILY_BONUS,player:getPlayer(db,playerId)};
});}
function work(db,playerId,now=Math.floor(Date.now()/1000)){return transaction(db,()=>{
 const p=getPlayer(db,playerId);if(!p)throw error('Игрок не найден',404);
 const day=Math.floor(now/86400),count=p.work_day===day?p.work_count:0;
 if(count>=10)throw error('На сегодня все 10 контрактов выполнены');
 if(now-p.last_work_at<10*60)throw error('Новый контракт будет доступен через 10 минут после предыдущего');
 const amount=random(400,700);
 db.prepare('UPDATE players SET balance=balance+?,experience=experience+5,last_work_at=?,work_day=?,work_count=? WHERE id=?').run(amount,now,day,count+1,playerId);
 log(db,'work',playerId,null,amount);
 return {amount,player:getPlayer(db,playerId)};
});}
const CASINO_TABLE=[
 {percent:35,multiplier:0},{percent:39,multiplier:1},{percent:15,multiplier:1.5},
 {percent:8,multiplier:2},{percent:2.5,multiplier:4},{percent:0.5,multiplier:10}
]; // theoretical return = 92.5%; virtual-only, no deposit or cash out.
function casino(db,playerId,bet,now=Math.floor(Date.now()/1000)){return transaction(db,()=>{
 if(![100,500,2000,5000].includes(bet))throw error('Выберите ставку 100, 500, 2 000 или 5 000 ₽');
 const p=getPlayer(db,playerId);if(!p)throw error('Игрок не найден',401);
 if(now-p.last_casino_at<6)throw error('Между играми должно пройти 6 секунд');
 if(p.balance<bet)throw error('Недостаточно игровых рублей');
 let sample=crypto.randomInt(1000),m=0;
 for(const x of CASINO_TABLE){sample-=x.percent*10;if(sample<0){m=x.multiplier;break;}}
 const won=Math.floor(bet*m),net=won-bet;
 db.prepare('UPDATE players SET balance=balance+?,last_casino_at=? WHERE id=?').run(net,now,playerId);
 log(db,'casino',playerId,null,net);
 return {bet,won,net,multiplier:m,player:getPlayer(db,playerId)};
});}
function leaderboard(db,playerId){
 const cte=`WITH capitals AS (
  SELECT p.id,p.login,p.display_name,p.telegram_username,p.balance+COALESCE(SUM(i.buyback),0) AS capital,p.equipped_item_id,p.experience,COUNT(i.id) AS items
  FROM players p LEFT JOIN items i ON i.owner_id=p.id GROUP BY p.id
 ),ranked AS (SELECT *,ROW_NUMBER() OVER(ORDER BY capital DESC,id ASC) AS place FROM capitals)`;
 const all=db.prepare(`${cte} SELECT * FROM ranked ORDER BY place LIMIT 10`).all();
 const me=db.prepare(`${cte} SELECT * FROM ranked WHERE id=?`).get(playerId);
 const equip=(row)=>row?({...row,equipped_handle:row.equipped_item_id?db.prepare('SELECT handle FROM items WHERE id=?').get(row.equipped_item_id)?.handle:null}):null;
 return {top:all.map(equip),me:equip(me)};
}
function inventory(db,playerId){return db.prepare(`SELECT i.*,l.id AS listing_id,l.price AS listing_price FROM items i LEFT JOIN listings l ON l.item_id=i.id WHERE i.owner_id=? ORDER BY CASE i.tier WHEN 'legendary' THEN 5 WHEN 'epic' THEN 4 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 2 ELSE 1 END DESC,i.created_at DESC LIMIT 150`).all(playerId);}
function market(db,{search='',tier='',limit=60}={}){
 const clauses=['1=1'];const params=[];
 if(tier&&TIERS.some(t=>t.id===tier)){clauses.push('i.tier=?');params.push(tier);}
 if(search){clauses.push('i.handle LIKE ?');params.push('%'+search.slice(0,40).replace(/[%_]/g,'')+'%');}
 return db.prepare(`SELECT l.id AS listing_id,l.price,l.created_at AS listed_at,i.id AS item_id,i.handle,i.tier,i.appraisal,i.buyback,l.seller_id,p.display_name AS seller_name,p.login AS seller_login FROM listings l JOIN items i ON i.id=l.item_id JOIN players p ON p.id=l.seller_id WHERE ${clauses.join(' AND ')} ORDER BY l.created_at DESC,l.id DESC LIMIT ?`).all(...params,limit);
}
function recentSales(db){return db.prepare(`SELECT t.id,t.kind,t.item_handle,t.amount,t.created_at,p.display_name,p.telegram_username,p.id AS player_id FROM transactions_log t JOIN players p ON p.id=t.actor_id WHERE t.kind IN ('sell_game','market_sale','private_sale') ORDER BY t.id DESC LIMIT 35`).all();}
module.exports={specialFor,chatMessages,postChat,sendOffer,tradeOffers,updateOffer,COMMON_SPIN_ODDS,rollTier,SPIN_COST,START_BALANCE,DAILY_BONUS,DAILY_COOLDOWN,TIERS,CASINO_TABLE,MARKET_FEE_PERCENT,TRANSFER_LIMIT,makeHandle,newItem,spin,sellToGame,listItem,unlist,buy,equip,resolveRecipient,transfer,daily,work,casino,getPlayer,leaderboard,inventory,market,recentSales,transaction};
