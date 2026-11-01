'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase,transaction}=require('./lib/database');
const referrals=require('./lib/referrals');
const {error,makePassword,checkPassword,verifyTelegram,createSession,readSession,SESSION_SEC}=require('./lib/auth');
const g=require('./lib/game');

// Tiny .env reader so deployment needs no npm install; host env takes precedence.
const envFile=path.join(__dirname,'.env');
if(fs.existsSync(envFile))for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
 const m=line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/);
 if(m && !Object.prototype.hasOwnProperty.call(process.env,m[1]))process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const PUBLIC=path.join(__dirname,'public');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
const LOGIN=/^[a-z][a-z0-9_]{2,19}$/;
const counters=new Map();
function throttle(key,limit=12,windowMs=60_000){
 const now=Date.now(),state=counters.get(key);
 if(!state||state.until<now){counters.set(key,{hits:1,until:now+windowMs});return;}
 if(++state.hits>limit)throw error('Слишком много попыток. Попробуйте позже',429);
 if(counters.size>4000)for(const [k,v] of counters)if(v.until<now)counters.delete(k);
}
function send(res,status,obj,extra={}){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});
 res.end(JSON.stringify(obj));
}
function cookies(req){const out={};for(const pair of (req.headers.cookie||'').split(';')){
 const idx=pair.indexOf('=');if(idx>0)out[pair.slice(0,idx).trim()]=pair.slice(idx+1).trim();
}return out;}
function cookieHeader(token,secure){return `sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SEC}${secure?'; Secure':''}`;}
function clearCookie(secure){return `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`;}
async function readJSON(req){
 let n=0,blocks=[];
 for await(const chunk of req){n+=chunk.length;if(n>65536)throw error('Слишком большой запрос',413);blocks.push(chunk);}
 try {const b=Buffer.concat(blocks).toString('utf8');const data=b?JSON.parse(b):{};if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid');return data;}
 catch {throw error('Некорректный JSON');}
}
function requireString(v,max=80){if(typeof v!=='string'||v.length>max)throw error('Некорректное поле');return v.trim();}
function safePublicPlayer(p){if(!p)return null;return {id:p.id,login:p.login,display_name:p.display_name,equipped_handle:p.equipped_handle,capital:p.capital};}
function createServer({dbFile=process.env.DB_PATH||path.join(__dirname,'data','game.sqlite'),botToken=process.env.BOT_TOKEN||'',secureCookies=process.env.NODE_ENV==='production',miniAppUrl=process.env.MINI_APP_URL||''}={}){
 const db=openDatabase(dbFile);
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'");
  try {
   const u=new URL(req.url||'/', 'http://localhost');
   const pathname=u.pathname;
   if(!pathname.startsWith('/api/')){
     if(req.method!=='GET'&&req.method!=='HEAD')throw error('Метод не поддерживается',405);
     const relative=pathname==='/'?'index.html':decodeURIComponent(pathname.replace(/^\//,''));
     const file=path.resolve(PUBLIC,relative);
     if(!file.startsWith(PUBLIC+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw error('Файл не найден',404);
     const mime=MIME[path.extname(file)];if(!mime)throw error('Файл не найден',404);
     res.writeHead(200,{'Content-Type':mime,'Cache-Control':path.extname(file)==='.html'?'no-store':'public, max-age=120'});
     if(req.method==='HEAD')return res.end();
     return fs.createReadStream(file).pipe(res);
   }
   if(req.method==='POST'){
    const origin=req.headers.origin;
    // Prevent cross-site writes even if a browser sends cookies.
    if(origin){
      let check;try{check=new URL(origin);}catch{throw error('Запрещённый источник запроса',403);}
      const valid=check.host===req.headers.host || (process.env.SERVER_PUBLIC_URL&&check.origin===new URL(process.env.SERVER_PUBLIC_URL).origin);
      if(!valid)throw error('Запрещённый источник запроса',403);
    }
   }
   const sess=readSession(db,cookies(req).sid);
   const signedIn=!!sess;
   const csrf=()=>{if(!signedIn)throw error('Нужна авторизация',401);
    const incoming=req.headers['x-csrf-token'];
    if(typeof incoming!=='string'||!crypto.timingSafeEqual(Buffer.from(incoming.padEnd(sess.csrf_token.length,'#').slice(0,sess.csrf_token.length)),Buffer.from(sess.csrf_token))||incoming.length!==sess.csrf_token.length)throw error('Сессия устарела. Обновите страницу',403);
   };
   const playerId=()=>{if(!signedIn)throw error('Нужна авторизация',401);return sess.player_id;};
   const body=req.method==='POST'?await readJSON(req):{};
   if(pathname==='/api/bootstrap'&&req.method==='GET')return send(res,200,signedIn?{authenticated:true,player:g.getPlayer(db,playerId()),csrf:sess.csrf_token,spin_cost:g.SPIN_COST,daily_bonus:g.DAILY_BONUS,common_spin_odds:g.COMMON_SPIN_ODDS.map(({tier,label,percent})=>({tier,label,percent})),tiers:g.TIERS.map(t=>({id:t.id,label:t.label,cost:t.cost,lengths:t.lengths})),casino_table:g.CASINO_TABLE}:{authenticated:false,telegram_enabled:!!botToken});
   if(pathname==='/api/auth/register'&&req.method==='POST'){
    throttle('register:'+req.socket.remoteAddress,8,10*60_000);
    const login=requireString(body.login,20).toLowerCase();
    const name=requireString(body.display_name||login,30);
    const password=body.password;
    if(!LOGIN.test(login))throw error('Логин: 3–20 латинских букв, цифр и _; начинается с буквы');
    if(name.length<2||name.length>28)throw error('Имя: от 2 до 28 символов');
    if(typeof password!=='string'||password.length<8||password.length>128)throw error('Пароль должен содержать 8–128 символов');
    if(db.prepare('SELECT 1 FROM players WHERE login=?').get(login))throw error('Этот логин уже занят',409);
    const created=db.prepare('INSERT INTO players(login,display_name,password_hash,balance,created_at) VALUES(?,?,?,?,?)').run(login,name,makePassword(password),g.START_BALANCE,Math.floor(Date.now()/1000));
    const session=createSession(db,Number(created.lastInsertRowid));
    return send(res,201,{authenticated:true,player:g.getPlayer(db,Number(created.lastInsertRowid)),csrf:session.csrf},{'Set-Cookie':cookieHeader(session.token,secureCookies)});
   }
   if(pathname==='/api/auth/login'&&req.method==='POST'){
    throttle('login:'+req.socket.remoteAddress,20,5*60_000);
    const login=requireString(body.login,30).toLowerCase(),password=body.password;
    if(typeof password!=='string'||password.length>128)throw error('Неверный логин или пароль',401);
    const p=db.prepare('SELECT id,password_hash FROM players WHERE login=?').get(login);
    if(!p||!checkPassword(password,p.password_hash))throw error('Неверный логин или пароль',401);
    const session=createSession(db,p.id);
    return send(res,200,{authenticated:true,player:g.getPlayer(db,p.id),csrf:session.csrf},{'Set-Cookie':cookieHeader(session.token,secureCookies)});
   }
   if(pathname==='/api/auth/telegram'&&req.method==='POST'){
    throttle('telegram:'+req.socket.remoteAddress,30,60_000);
    const tg=verifyTelegram(body.initData,botToken);
    const tgId=String(tg.id);
    const tgUsername=typeof tg.username==='string'&&/^[a-z0-9_]{5,32}$/i.test(tg.username)?tg.username:null;
    let p=db.prepare('SELECT id FROM players WHERE telegram_id=?').get(tgId);
    if(!p){
      const base=`tg_${tgId}`;
      const name=String(tg.first_name||tg.username||'Игрок').replace(/[<>]/g,'').slice(0,28)||'Игрок';
      // Telegram ID is unique, but login might have been registered outside Telegram.
      let login=base;
      while(db.prepare('SELECT 1 FROM players WHERE login=?').get(login))login=`${base}_${crypto.randomInt(10000)}`;
      // start_param is inside Telegram's verified signed initData. Never trust a
      // plain client-supplied referral code or URL query parameter.
      const signedStartParam=new URLSearchParams(body.initData).get('start_param');
      p=transaction(db,()=>{
        const result=db.prepare('INSERT INTO players(login,display_name,telegram_id,telegram_username,balance,created_at) VALUES(?,?,?,?,?,?)').run(login,name,tgId,tgUsername,g.START_BALANCE,Math.floor(Date.now()/1000));
        const invitedId=Number(result.lastInsertRowid);
        referrals.awardNewTelegramUser(db,invitedId,signedStartParam);
        return {id:invitedId};
      });
    }
    db.prepare('UPDATE players SET display_name=?,telegram_username=? WHERE id=?').run(String(tg.first_name||tg.username||'Игрок').replace(/[<>]/g,'').slice(0,28)||'Игрок',tgUsername,p.id);
    const session=createSession(db,p.id);
    return send(res,200,{authenticated:true,player:g.getPlayer(db,p.id),csrf:session.csrf},{'Set-Cookie':cookieHeader(session.token,secureCookies)});
   }
   if(pathname==='/api/auth/logout'&&req.method==='POST'){
    csrf();db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sess.token_hash);
    return send(res,200,{ok:true},{'Set-Cookie':clearCookie(secureCookies)});
   }
   if(req.method==='GET'){
    const id=playerId();
    if(pathname==='/api/inventory')return send(res,200,{items:g.inventory(db,id)});
    if(pathname==='/api/market')return send(res,200,{items:g.market(db,{search:u.searchParams.get('q')||'',tier:u.searchParams.get('tier')||''}),fee_percent:g.MARKET_FEE_PERCENT});
    if(pathname==='/api/leaderboard')return send(res,200,g.leaderboard(db,id));
    if(pathname==='/api/chat')return send(res,200,{messages:g.chatMessages(db)});
    if(pathname==='/api/offers')return send(res,200,{offers:g.tradeOffers(db,id)});
    if(pathname==='/api/sales')return send(res,200,{items:g.recentSales(db)});
    if(pathname==='/api/referrals')return send(res,200,referrals.overview(db,id,miniAppUrl));
    if(pathname==='/api/players/resolve'){
     const p=g.resolveRecipient(db,u.searchParams.get('q')||'');
     if(!p)throw error('Игрок не найден',404);
     return send(res,200,{player:safePublicPlayer(p)});
    }
    if(pathname==='/api/history'){
      const rows=db.prepare(`SELECT t.kind,t.amount,t.item_id,t.created_at,t.other_id,p.display_name AS other_name FROM transactions_log t LEFT JOIN players p ON p.id=t.other_id WHERE t.actor_id=? ORDER BY t.id DESC LIMIT 35`).all(id);
      return send(res,200,{items:rows});
    }
   }
   if(req.method==='POST'){
    csrf();const id=playerId();
    if(pathname==='/api/spin'){throttle('spin:'+id,60,60_000);return send(res,200,g.spin(db,id,body.tier===undefined?'common':body.tier));}
    if(pathname==='/api/free-spin')return send(res,200,g.spin(db,id,'common',true));
    if(pathname==='/api/work')return send(res,200,g.work(db,id));
    if(pathname==='/api/casino'){throttle('casino:'+id,30,60_000);return send(res,200,g.casino(db,id,Number(body.bet)));}
    if(pathname==='/api/daily')return send(res,200,g.daily(db,id));
    if(pathname==='/api/equip'){
     const itemId=body.item_id===null?null:Number(body.item_id);
     if(itemId!==null&&(!Number.isSafeInteger(itemId)||itemId<=0))throw error('Некорректный предмет');
     return send(res,200,{player:g.equip(db,id,itemId)});
    }
    if(pathname==='/api/chat'){throttle('chat:'+id,15,60_000);return send(res,201,g.postChat(db,id,body.message));}
    if(pathname==='/api/offers'){throttle('offers:'+id,12,60_000);return send(res,201,g.sendOffer(db,id,Number(body.buyer_id),Number(body.item_id),Number(body.price)));}
    const offerMatch=pathname.match(/^\/api\/offers\/(\d+)\/(accept|decline|cancel)$/);
    if(offerMatch){throttle('offer-response:'+id,45,60_000);return send(res,200,g.updateOffer(db,id,Number(offerMatch[1]),offerMatch[2]));}
    if(pathname==='/api/transfers'){
     const toId=Number(body.to_id),amount=Number(body.amount);
     return send(res,200,g.transfer(db,id,toId,amount));
    }
    const itemMatch=pathname.match(/^\/api\/items\/(\d+)\/(sell|list|unlist)$/);
    if(itemMatch){
      const itemId=Number(itemMatch[1]);if(!Number.isSafeInteger(itemId))throw error('Некорректный предмет');
      if(itemMatch[2]==='sell')return send(res,200,g.sellToGame(db,id,itemId));
      if(itemMatch[2]==='list')return send(res,200,g.listItem(db,id,itemId,Number(body.price)));
      if(itemMatch[2]==='unlist')return send(res,200,g.unlist(db,id,itemId));
    }
    const buyMatch=pathname.match(/^\/api\/market\/(\d+)\/buy$/);
    if(buyMatch)return send(res,200,g.buy(db,id,Number(buyMatch[1])));
   }
   throw error('Маршрут не найден',404);
  }catch(e){
    const status=e.status||((e.code==='SQLITE_CONSTRAINT_UNIQUE')?409:500);
    if(status===500)console.error('SERVER ERROR',e);
    send(res,status,{error:status===500?'Внутренняя ошибка сервера':e.message});
  }
 });
 return {server,db,close:()=>{server.close();db.close();}};
}
if(require.main===module){
 const {server}=createServer();const port=Number(process.env.PORT)||3000;
 server.listen(port,'0.0.0.0',()=>console.log(`Username Generator | Game http://localhost:${port}`));
}
module.exports={createServer};
