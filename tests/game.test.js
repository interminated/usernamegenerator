'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('../server');
const {verifyTelegram}=require('../lib/auth');
const {SPIN_COST}=require('../lib/game');
const temp=mkdtempSync(path.join(tmpdir(),'username-game-test-'));
const {server,db}=createServer({dbFile:path.join(temp,'test.sqlite')});
let base;
let started=false;
async function setup(){if(started)return;await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;started=true;}
after(async()=>{if(started)await new Promise(r=>server.close(r));db.close();rmSync(temp,{recursive:true,force:true});});
async function call(route,method='GET',body,who=null,extra={}){
 await setup();
 const res=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(who?{'Cookie':who.cookie,'X-CSRF-Token':who.csrf}:{}),...extra},body:body!==undefined?JSON.stringify(body):undefined});
 const data=await res.json();return {status:res.status,data,cookie:res.headers.get('set-cookie')};
}
async function register(login){const r=await call('/api/auth/register','POST',{login,password:'test-password-123',display_name:login});assert.equal(r.status,201);return {cookie:r.cookie.split(';')[0],csrf:r.data.csrf,id:r.data.player.id};}
let a,b,drop;
test('Регистрация создаёт два независимых аккаунта; гостю операции недоступны',async()=>{
 a=await register('tester_one');b=await register('tester_two');
 assert.notEqual(a.id,b.id);
 const r=await call('/api/inventory');assert.equal(r.status,401);
 const auth=await call('/api/bootstrap','GET',undefined,a);assert.equal(auth.data.authenticated,true);
 assert.equal(auth.data.player.balance,25000);
});
test('CSRF и источники запросов защищены',async()=>{
 const forged=await call('/api/spin','POST',{},null,{'Cookie':a.cookie});assert.equal(forged.status,403);
 const external=await call('/api/spin','POST',{},a,{'Origin':'https://attacker.example'});assert.equal(external.status,403);
});
test('Генерация списывает рубли, создаёт уникальную вещь и начисляет опыт',async()=>{
 const r=await call('/api/spin','POST',{},a);assert.equal(r.status,200);drop=r.data.item;
 assert.match(drop.handle,/^[a-z0-9_]+$/);assert.ok(drop.buyback>0);
 assert.equal(r.data.player.balance,25000-SPIN_COST);assert.equal(r.data.player.collection_size,1);
 const inventory=await call('/api/inventory','GET',undefined,a);assert.equal(inventory.data.items[0].id,drop.id);
});
test('Ник можно установить рядом с именем в игровом профиле',async()=>{
 const e=await call('/api/equip','POST',{item_id:drop.id},a);assert.equal(e.status,200);assert.equal(e.data.player.equipped_handle,drop.handle);
 const bad=await call('/api/equip','POST',{item_id:drop.id},b);assert.equal(bad.status,404);
});
test('Общий рынок: покупка передаёт предмет и платёж, комиссия не создаёт деньги',async()=>{
 const listed=await call(`/api/items/${drop.id}/list`,'POST',{price:3000},a);assert.equal(listed.status,200);
 const market=await call('/api/market','GET',undefined,b);assert.equal(market.data.items[0].handle,drop.handle);
 const purchase=await call(`/api/market/${listed.data.listing_id}/buy`,'POST',{},b);assert.equal(purchase.status,200);
 assert.equal(purchase.data.player.balance,22000);
 assert.equal(purchase.data.seller_receives,2850);assert.equal(purchase.data.fee,150);
 const ap=await call('/api/bootstrap','GET',undefined,a);assert.equal(ap.data.player.balance,27650);
 assert.equal(ap.data.player.equipped_handle,null);
 const again=await call(`/api/market/${listed.data.listing_id}/buy`,'POST',{},b);assert.equal(again.status,404);
 const aItems=await call('/api/inventory','GET',undefined,a);assert.equal(aItems.data.items.length,0);
 const bItems=await call('/api/inventory','GET',undefined,b);assert.equal(bItems.data.items[0].handle,drop.handle);
});
test('Переводы только на существующий ID, без возможности тратить больше баланса',async()=>{
 const found=await call('/api/players/resolve?q=tester_two','GET',undefined,a);assert.equal(found.data.player.id,b.id);
 const no=await call('/api/transfers','POST',{to_id:b.id,amount:99999999},a);assert.equal(no.status,400);
 const self=await call('/api/transfers','POST',{to_id:a.id,amount:100},a);assert.equal(self.status,400);
 const r=await call('/api/transfers','POST',{to_id:b.id,amount:1000},a);assert.equal(r.status,200);
 assert.equal(r.data.player.balance,26650);
 const afterB=await call('/api/bootstrap','GET',undefined,b);assert.equal(afterB.data.player.balance,23000);
});
test('Выставление, снятие и мгновенная продажа проходят транзакционно',async()=>{
 const r=await call('/api/spin','POST',{},b);const item=r.data.item;
 const list=await call(`/api/items/${item.id}/list`,'POST',{price:1600},b);assert.equal(list.status,200);
 const cannotSell=await call(`/api/items/${item.id}/sell`,'POST',{},b);assert.equal(cannotSell.status,400);
 assert.equal((await call(`/api/items/${item.id}/unlist`,'POST',{},b)).status,200);
 const sold=await call(`/api/items/${item.id}/sell`,'POST',{},b);assert.equal(sold.status,200);
 assert.equal(sold.data.amount,item.buyback);
 assert.equal((await call(`/api/items/${item.id}/sell`,'POST',{},b)).status,404);
});
test('Топ-10 учитывает баланс + выкупную стоимость ников, не цену на рынке',async()=>{
 const data=await call('/api/leaderboard','GET',undefined,a);assert.equal(data.status,200);
 assert.equal(data.data.top.length,2);assert.ok(data.data.me.place>=1);
 const everyone=new Map(data.data.top.map(x=>[x.id,x]));
 const p=await call('/api/bootstrap','GET',undefined,b);
 assert.equal(everyone.get(b.id).capital,p.data.player.capital);
});
test('Ежедневный бонус нельзя взять повторно сразу',async()=>{
 const first=await call('/api/daily','POST',{},a);assert.equal(first.status,200);
 assert.equal(first.data.amount,4000);
 const next=await call('/api/daily','POST',{},a);assert.equal(next.status,400);
});
test('Подпись Telegram и срок актуальности проверяются криптографически',()=>{
 const token='12345:private-test-token',t=1770000000;
 const data=new URLSearchParams({auth_date:String(t),user:JSON.stringify({id:345,first_name:'Test'})});
 const check=[...data.entries()].map(([k,v])=>`${k}=${v}`).sort().join('\n');
 const key=crypto.createHmac('sha256','WebAppData').update(token).digest();
 const hash=crypto.createHmac('sha256',key).update(check).digest('hex');
 data.set('hash',hash);
 assert.equal(verifyTelegram(data.toString(),token,t+20).id,345);
 data.set('auth_date',String(t+5));
 assert.throws(()=>verifyTelegram(data.toString(),token,t+20),/подпись/i);
});
test('Разрешение получателя по установленному @нику и место игрока вне топ-10',async()=>{
 const equipped=await call('/api/equip','POST',{item_id:drop.id},b);
 assert.equal(equipped.status,200);
 const lookup=await call('/api/players/resolve?q=@'+encodeURIComponent(drop.handle),'GET',undefined,a);
 assert.equal(lookup.status,200);assert.equal(lookup.data.player.id,b.id);
 const now=Math.floor(Date.now()/1000);
 for(let i=0;i<13;i++)db.prepare('INSERT INTO players(login,display_name,password_hash,balance,created_at) VALUES(?,?,?,?,?)').run('test_rich_'+i,'Тестовый игрок '+(i+1),null,150000+(13-i)*1000,now);
 const top=await call('/api/leaderboard','GET',undefined,a);
 assert.equal(top.data.top.length,10);
 assert.ok(top.data.me.place>10);
 assert.ok(top.data.top.every(row=>row.id!==a.id));
});
test('Выбор гарантированной редкости: формат ника и разные цены определяет сервер',async()=>{
 const samples=[['common',200,9,13],['uncommon',800,7,9],['rare',3000,6,7],['epic',12000,5,6],['legendary',65000,1,4]];
 db.prepare('UPDATE players SET balance=1000000 WHERE id=?').run(a.id);
 let old=1000000;
 for(const [tier,cost,min,max] of samples){
  const r=await call('/api/spin','POST',{tier},a);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.ok(tier==='common'?['common','uncommon','rare','epic'].includes(r.data.item.tier):r.data.item.tier===tier);
  const [actualMin,actualMax]=({common:[9,13],uncommon:[7,9],rare:[6,7],epic:[5,6],legendary:[1,4]})[r.data.item.tier];assert.ok(r.data.item.handle.length>=actualMin && r.data.item.handle.length<=actualMax);
  old-=cost;
  assert.equal(r.data.player.balance,old);
 }
 const bad=await call('/api/spin','POST',{tier:'admin-legendary'},a);
 assert.equal(bad.status,400);
 assert.equal((await call('/api/bootstrap','GET',undefined,a)).data.player.balance,old);
});
test('Прокрутки генерируют разные комбинации и не повторяют уже выданные имена',async()=>{
 const g=require('../lib/game');
 for(const [tier,min,max] of [['common',9,13],['uncommon',7,9],['rare',6,7],['epic',5,6],['legendary',1,4]]){
  const names=new Set(Array.from({length:100},()=>g.makeHandle(tier)));
  assert.ok(names.size>=15,`Нехватка вариативности ${tier}: ${names.size}`);
  assert.ok([...names].every(n=>n.length>=min&&n.length<=max));
 }
 const samples=db.prepare('SELECT handle FROM items').all();
 assert.equal(db.prepare('SELECT count(DISTINCT handle) AS n FROM generated_handles').get().n,db.prepare('SELECT count(*) AS n FROM generated_handles').get().n);
 for(const {handle} of samples)assert.ok(db.prepare('SELECT 1 FROM generated_handles WHERE handle=?').get(handle));
});
test('Бесплатная генерация не списывает рубли; 30-минутный интервал нельзя обойти',async()=>{
 const before=(await call('/api/bootstrap','GET',undefined,b)).data.player.balance;
 const r=await call('/api/free-spin','POST',{},b);
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.ok(['common','uncommon','rare','epic'].includes(r.data.item.tier));
 assert.equal(r.data.player.balance,before);
 assert.equal((await call('/api/free-spin','POST',{},b)).status,400);
});
test('Контракт зарабатывает игровые рубли и имеет ограничение по времени',async()=>{
 const before=(await call('/api/bootstrap','GET',undefined,b)).data.player.balance;
 const r=await call('/api/work','POST',{},b);
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.ok(r.data.amount>=400&&r.data.amount<=700);
 assert.equal(r.data.player.balance,before+r.data.amount);
 assert.equal((await call('/api/work','POST',{},b)).status,400);
});
test('Казино разрешает только допустимые ставки; выигрыш и баланс согласованы',async()=>{
 const before=(await call('/api/bootstrap','GET',undefined,b)).data.player.balance;
 assert.equal((await call('/api/casino','POST',{bet:99999},b)).status,400);
 const r=await call('/api/casino','POST',{bet:500},b);
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.ok([0,1,1.5,2,4,10].includes(r.data.multiplier));
 assert.equal(r.data.won,500*r.data.multiplier);
 assert.equal(r.data.player.balance,before+r.data.net);
 assert.equal((await call('/api/casino','POST',{bet:500},b)).status,400);
});
test('В рейтинге есть настоящий Telegram username при привязке (не игровой логин)',async()=>{
 db.prepare('UPDATE players SET telegram_username=? WHERE id=?').run('real_tag_123',b.id);
 const r=await call('/api/leaderboard','GET',undefined,b);
 assert.equal(r.status,200);
 assert.equal(r.data.me.telegram_username,'real_tag_123');
});
test('Таблица продаж содержит имя проданного игре предмета даже после удаления',async()=>{
 const r=await call('/api/sales','GET',undefined,a);
 assert.equal(r.status,200);
 const gameSale=r.data.items.find(x=>x.kind==='sell_game');
 assert.ok(gameSale);
 assert.match(gameSale.item_handle,/^[a-z0-9_]+$/);
 assert.ok(r.data.items.some(x=>x.kind==='market_sale'));
});
test('Переводы до 500 млн ₽ включительно, больше лимита запрещены',async()=>{
 db.prepare('UPDATE players SET balance=700000000 WHERE id=?').run(a.id);
 const tooLarge=await call('/api/transfers','POST',{to_id:b.id,amount:500000001},a);
 assert.equal(tooLarge.status,400);
 const yes=await call('/api/transfers','POST',{to_id:b.id,amount:500000000},a);
 assert.equal(yes.status,200,JSON.stringify(yes.data));
 assert.equal(yes.data.amount,500000000);
 assert.equal(yes.data.player.balance,200000000);
});

// The rarity roll is deterministic at boundaries, but production uses crypto.randomInt.
test('Обычная прокрутка: документированные шансы дают правильные границы',()=>{
 const g=require('../lib/game');
 const expected=[['common',0],['common',889],['uncommon',890],['uncommon',989],['rare',990],['rare',998],['epic',999]];
 for(const [tier,n] of expected)assert.equal(g.rollTier('common',n).id,tier);
 for(const forced of ['uncommon','rare','epic','legendary'])assert.equal(g.rollTier(forced,999).id,forced);
 assert.equal(g.COMMON_SPIN_ODDS.reduce((sum,x)=>sum+x.weight,0),1000);
});
test('Новый генератор создаёт читаемые ники без длинной случайной абракадабры',()=>{
 const g=require('../lib/game');
 for(const [tier,min,max] of [['common',9,13],['uncommon',7,9],['rare',6,7],['epic',5,6],['legendary',1,4]]){
  const names=Array.from({length:200},()=>g.makeHandle(tier));
  assert.ok(new Set(names).size>15,`Недостаточно разнообразия: ${tier}`);
  for(const n of names){
   assert.match(n,/^[a-z0-9_]+$/);
   assert.ok(n.length>=min&&n.length<=max,`${tier} ${n}`);
   if(tier!=='legendary')assert.match(n,/[aeiouy]/,`Нечитаемый ник: ${n}`);
  }
 }
});

test('Особые комбинации распознаются, не меняя редкость самой генерации',()=>{
 const {specialFor}=require('../lib/game');
 assert.equal(specialFor('777'),'Культовый ник');
 assert.equal(specialFor('king'),'Культовый ник');
 assert.equal(specialFor('x'),'Один символ');
 assert.equal(specialFor('aa'),'Два символа');
 assert.equal(specialFor('king777'),'Красивое сочетание');
 assert.equal(specialFor('realneon123'),null);
});

test('Общий чат доступен только игрокам, очищает управляющие символы и ограничивает частоту',async()=>{
 const guest=await call('/api/chat');assert.equal(guest.status,401);
 const guestPost=await call('/api/chat','POST',{message:'hello'});assert.equal(guestPost.status,401);
 const empty=await call('/api/chat','POST',{message:'   '},a);assert.equal(empty.status,400);
 const huge=await call('/api/chat','POST',{message:'a'.repeat(281)},a);assert.equal(huge.status,400);
 const xss=await call('/api/chat','POST',{message:'<img src=x onerror=alert(1)>\u0002'},a);
 assert.equal(xss.status,201);
 const list=await call('/api/chat','GET',undefined,b);assert.equal(list.status,200);
 assert.equal(list.data.messages.at(-1).message,'<img src=x onerror=alert(1)>');
 assert.equal(list.data.messages.at(-1).player_id,a.id);
 const flood=await call('/api/chat','POST',{message:'again'},a);assert.equal(flood.status,429);
});

test('Личное предложение по ID: получатель подтверждает, продавцу начисляются ₽ минус 5%',async()=>{
 const newDrop=(await call('/api/spin','POST',{tier:'common'},a)).data.item;
 const invalidPrice=await call('/api/offers','POST',{buyer_id:b.id,item_id:newDrop.id,price:0},a);assert.equal(invalidPrice.status,400);
 const tooMuch=await call('/api/offers','POST',{buyer_id:b.id,item_id:newDrop.id,price:1000000001},a);assert.equal(tooMuch.status,400);
 const self=await call('/api/offers','POST',{buyer_id:a.id,item_id:newDrop.id,price:100},a);assert.equal(self.status,400);
 const stranger=await call('/api/offers','POST',{buyer_id:a.id,item_id:newDrop.id,price:100},b);assert.equal(stranger.status,404);
 const sent=await call('/api/offers','POST',{buyer_id:b.id,item_id:newDrop.id,price:1234},a);assert.equal(sent.status,201);
 const id=sent.data.offer_id;
 const duplicate=await call('/api/offers','POST',{buyer_id:b.id,item_id:newDrop.id,price:1234},a);assert.equal(duplicate.status,409);
 const locked=await call(`/api/items/${newDrop.id}/list`,'POST',{price:1200},a);assert.equal(locked.status,400);
 const cannotSell=await call(`/api/items/${newDrop.id}/sell`,'POST',{},a);assert.equal(cannotSell.status,400);
 const received=await call('/api/offers','GET',undefined,b);assert.equal(received.status,200);
 assert.equal(received.data.offers[0].item_id,newDrop.id);
 const wrong=await call(`/api/offers/${id}/accept`,'POST',{},a);assert.equal(wrong.status,403);
 const beforeSeller=(await call('/api/bootstrap','GET',undefined,a)).data.player.balance;
 const beforeBuyer=(await call('/api/bootstrap','GET',undefined,b)).data.player.balance;
 const ok=await call(`/api/offers/${id}/accept`,'POST',{},b);assert.equal(ok.status,200);
 assert.equal(ok.data.fee,61);assert.equal(ok.data.seller_receives,1173);
 assert.equal((await call('/api/bootstrap','GET',undefined,a)).data.player.balance,beforeSeller+1173);
 assert.equal((await call('/api/bootstrap','GET',undefined,b)).data.player.balance,beforeBuyer-1234);
 const collection=await call('/api/inventory','GET',undefined,b);
 assert.ok(collection.data.items.some(x=>x.id===newDrop.id));
 const repeat=await call(`/api/offers/${id}/accept`,'POST',{},b);assert.equal(repeat.status,409);
 const sales=await call('/api/sales','GET',undefined,b);assert.ok(sales.data.items.some(x=>x.kind==='private_sale'&&x.item_handle===newDrop.handle));
});

test('Личные предложения можно отклонить и отменить; границы 1 ₽ и 1 млрд ₽',async()=>{
 const first=(await call('/api/spin','POST',{tier:'common'},a)).data.item;
 const sent=await call('/api/offers','POST',{buyer_id:b.id,item_id:first.id,price:1000000000},a);
 assert.equal(sent.status,201);
 const buyerPoor=await call(`/api/offers/${sent.data.offer_id}/accept`,'POST',{},b);assert.equal(buyerPoor.status,400);
 const decline=await call(`/api/offers/${sent.data.offer_id}/decline`,'POST',{},b);assert.equal(decline.status,200);
 const second=await call('/api/offers','POST',{buyer_id:b.id,item_id:first.id,price:1},a);assert.equal(second.status,201);
 const cancelUnauthorized=await call(`/api/offers/${second.data.offer_id}/cancel`,'POST',{},b);assert.equal(cancelUnauthorized.status,403);
 const cancel=await call(`/api/offers/${second.data.offer_id}/cancel`,'POST',{},a);assert.equal(cancel.status,200);
 const list=await call(`/api/items/${first.id}/list`,'POST',{price:350},a);assert.equal(list.status,200);
 const listed=await call('/api/offers','POST',{buyer_id:b.id,item_id:first.id,price:200},a);assert.equal(listed.status,400);
});

test('Истёкшее предложение нельзя принять, база при обновлении сохраняет чат и сделки',async()=>{
 const {openDatabase}=require('../lib/database');
 const {sendOffer,updateOffer}=require('../lib/game');
 const item=(await call('/api/spin','POST',{tier:'common'},a)).data.item;
 const now=Math.floor(Date.now()/1000)-86410;
 const offer=sendOffer(db,a.id,b.id,item.id,100,now);
 assert.throws(()=>updateOffer(db,b.id,offer.offer_id,'accept'),/завершено/);
 const reloaded=openDatabase(path.join(temp,'test.sqlite'));
 try{
  assert.ok(reloaded.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n>=1);
  assert.equal(reloaded.prepare('SELECT status FROM trade_offers WHERE id=?').get(offer.offer_id).status,'expired');
  assert.ok(reloaded.prepare('PRAGMA table_info(items)').all().some(c=>c.name==='special'));
 } finally{reloaded.close();}
});


test('Личная продажа за 1 ₽ действительно возможна без скрытого минимального сбора',async()=>{
 const item=(await call('/api/spin','POST',{tier:'common'},a)).data.item;
 const o=await call('/api/offers','POST',{buyer_id:b.id,item_id:item.id,price:1},a);
 assert.equal(o.status,201);
 const result=await call(`/api/offers/${o.data.offer_id}/accept`,'POST',{},b);
 assert.equal(result.status,200);assert.equal(result.data.seller_receives,1);assert.equal(result.data.fee,0);
});
