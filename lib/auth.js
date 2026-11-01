'use strict';
const crypto = require('node:crypto');
const MAX_AUTH_AGE_SEC=86400;
const SESSION_SEC=60*60*24*14;
function error(message,status=400){const e=new Error(message);e.status=status;return e;}
function makePassword(password) {
  const salt=crypto.randomBytes(16).toString('hex');
  const key=crypto.scryptSync(password,salt,64).toString('hex');
  return `scrypt:${salt}:${key}`;
}
function checkPassword(password,hash) {
  if(!hash) return false;
  const p=hash.split(':');
  if(p.length!==3||p[0]!=='scrypt')return false;
  try {
    const actual=crypto.scryptSync(password,p[1],64);
    const expected=Buffer.from(p[2],'hex');
    return expected.length===actual.length && crypto.timingSafeEqual(actual,expected);
  } catch {return false;}
}
function verifyTelegram(initData, botToken, nowSec=Math.floor(Date.now()/1000)) {
  if(!botToken) throw error('Telegram-вход пока не настроен',503);
  if(typeof initData !== 'string'||initData.length>8192||!initData)throw error('Некорректные данные Telegram');
  const q=new URLSearchParams(initData);
  if([...q.keys()].length!==new Set(q.keys()).size) throw error('Неверная подпись Telegram',401);
  const given=q.get('hash');
  if(!given || !/^[0-9a-f]{64}$/i.test(given))throw error('Неверная подпись Telegram',401);
  const authDate=Number(q.get('auth_date'));
  if(!Number.isSafeInteger(authDate)||authDate>nowSec+60||nowSec-authDate>MAX_AUTH_AGE_SEC)throw error('Данные Telegram устарели',401);
  const data=[...q.entries()].filter(([k])=>k!=='hash'&&k!=='signature').map(([k,v])=>`${k}=${v}`).sort().join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  const calc=crypto.createHmac('sha256',secret).update(data).digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(given.toLowerCase()),Buffer.from(calc)))throw error('Неверная подпись Telegram',401);
  let user;
  try {user=JSON.parse(q.get('user')||'null');} catch { throw error('Данные пользователя Telegram повреждены',401);}
  if(!user||!Number.isSafeInteger(user.id)||user.id<=0)throw error('Нет Telegram ID',401);
  return user;
}
function createSession(db,playerId) {
 const token=crypto.randomBytes(32).toString('base64url');
 const hash=crypto.createHash('sha256').update(token).digest('hex');
 const csrf=crypto.randomBytes(24).toString('base64url');
 const expires=Math.floor(Date.now()/1000)+SESSION_SEC;
 db.prepare('INSERT INTO sessions(token_hash,csrf_token,player_id,expires_at) VALUES(?,?,?,?)').run(hash,csrf,playerId,expires);
 return {token,csrf,expires};
}
function readSession(db,token) {
 if(!token||!(/^[A-Za-z0-9_-]{30,100}$/.test(token)))return null;
 const hash=crypto.createHash('sha256').update(token).digest('hex');
 return db.prepare('SELECT s.*,p.id AS id,p.login,p.display_name,p.telegram_id,p.balance,p.experience,p.equipped_item_id,p.last_daily_at,p.created_at FROM sessions s JOIN players p ON s.player_id=p.id WHERE s.token_hash=? AND s.expires_at>?').get(hash,Math.floor(Date.now()/1000))||null;
}
module.exports={error,makePassword,checkPassword,verifyTelegram,createSession,readSession,SESSION_SEC};
