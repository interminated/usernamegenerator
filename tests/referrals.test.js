'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('../server');
const {referralUrl,validatedMiniAppBase,REFERRAL_BONUS}=require('../lib/referrals');
const dir=mkdtempSync(path.join(tmpdir(),'referrals-game-'));
const BOT_TOKEN='123456:test_secret_token';
const {server,db}=createServer({dbFile:path.join(dir,'test.sqlite'),botToken:BOT_TOKEN,miniAppUrl:'https://t.me/SomeGameBot/UsernameGame',secureCookies:false});
let host;
async function req(route,method='GET',body,who){
 if(!host){await new Promise(r=>server.listen(0,'127.0.0.1',r));host='http://127.0.0.1:'+server.address().port;}
 const response=await fetch(host+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(who?{'cookie':who.cookie,'x-csrf-token':who.csrf}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
}
function session(r){return {cookie:r.cookie.split(';')[0],csrf:r.data.csrf,id:r.data.player.id};}
function signTelegram(id,startParam=''){
 const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Игрок'+id,username:'nick'+id})});
 if(startParam)params.set('start_param',startParam);
 const payload=[...params.entries()].map(([k,v])=>`${k}=${v}`).sort().join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 params.set('hash',crypto.createHmac('sha256',secret).update(payload).digest('hex'));
 return params.toString();
}
after(async()=>{if(host)await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});});
let inviter,code;
test('Создание реферальной ссылки и постоянного личного кода',async()=>{
 const r=await req('/api/auth/register','POST',{login:'referrer',display_name:'Пригласивший',password:'password123'});
 assert.equal(r.status,201);inviter=session(r);
 const data=await req('/api/referrals','GET',undefined,inviter);
 assert.equal(data.status,200);
 assert.equal(data.data.bonus,100000);
 assert.match(data.data.code,/^[A-Za-z0-9_-]{16}$/);
 assert.equal(data.data.link,`https://t.me/SomeGameBot/UsernameGame?startapp=ref_${data.data.code}`);
 code=data.data.code;
 assert.equal(data.data.invited,0);
 assert.equal((await req('/api/referrals','GET',undefined,inviter)).data.code,code);
 assert.equal((await req('/api/referrals')).status,401);
});
test('Поддельный код в обычной регистрации не начисляет награду',async()=>{
 const fake=await req('/api/auth/register','POST',{login:'local_fake',display_name:'Local',password:'password123',referral_code:code});
 assert.equal(fake.status,201);
 const info=await req('/api/referrals','GET',undefined,inviter);
 assert.equal(info.data.earned,0);
});
test('Новый Telegram-пользователь по ПОДПИСАННОЙ ссылке приносит 100 000 ₽ единожды',async()=>{
 const signed=signTelegram(800001,'ref_'+code);
 const r=await req('/api/auth/telegram','POST',{initData:signed});
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.player.balance,25000);
 const info=await req('/api/referrals','GET',undefined,inviter);
 assert.equal(info.data.invited,1);assert.equal(info.data.earned,REFERRAL_BONUS);
 assert.equal(info.data.recent[0].telegram_username,'nick800001');
 assert.equal((await req('/api/bootstrap','GET',undefined,inviter)).data.player.balance,125000);
 const again=await req('/api/auth/telegram','POST',{initData:signed});
 assert.equal(again.status,200);
 assert.equal((await req('/api/referrals','GET',undefined,inviter)).data.invited,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions_log WHERE kind='referral'").get().n,1);
});
test('Telegram hash с подменённым кодом отклоняется',async()=>{
 const signed=new URLSearchParams(signTelegram(800002,'ref_'+code));
 signed.set('start_param','ref_'+code.replace(/^./,code[0]==='a'?'b':'a'));
 const r=await req('/api/auth/telegram','POST',{initData:signed.toString()});
 assert.equal(r.status,401);
 assert.equal((await req('/api/referrals','GET',undefined,inviter)).data.invited,1);
});
test('Существующий Telegram-пользователь не может получить бонус задним числом',async()=>{
 assert.equal((await req('/api/auth/telegram','POST',{initData:signTelegram(800003)})).status,200);
 assert.equal((await req('/api/auth/telegram','POST',{initData:signTelegram(800003,'ref_'+code)})).status,200);
 assert.equal((await req('/api/referrals','GET',undefined,inviter)).data.invited,1);
});
test('Каждый следующий новый Telegram-игрок начисляет ещё 100 000 ₽, неверный код не даёт бонус',async()=>{
 const r=await req('/api/auth/telegram','POST',{initData:signTelegram(800004,'ref_'+code)});
 assert.equal(r.status,200);
 assert.equal((await req('/api/referrals','GET',undefined,inviter)).data.earned,200000);
 assert.equal((await req('/api/auth/telegram','POST',{initData:signTelegram(800005,'ref_badbadbadbadbadb')})).status,200);
 assert.equal((await req('/api/referrals','GET',undefined,inviter)).data.earned,200000);
 assert.equal((await req('/api/bootstrap','GET',undefined,inviter)).data.player.balance,225000);
});
test('Реферал не начисляется по неподтверждённому URL и чужим доменам',()=>{
 assert.equal(referralUrl('https://example.com/bot','AbCdEfGhIjKlMnOp'),null);
 assert.equal(referralUrl('http://t.me/gamebot','AbCdEfGhIjKlMnOp'),null);
 assert.equal(validatedMiniAppBase('https://t.me.evil.org/gamebot'),null);
 assert.equal(referralUrl('https://t.me/valid_bot','AbCdEfGhIjKlMnOp'),'https://t.me/valid_bot?startapp=ref_AbCdEfGhIjKlMnOp');
});
