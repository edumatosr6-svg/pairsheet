import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,statSync,createReadStream} from 'node:fs';
import {resolve,dirname,extname,sep} from 'node:path';
import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {z} from 'zod';
import {act} from '../lib/actions';
import {blankState,type State} from '../lib/domain';

const scrypt=promisify(scryptCallback);
const production=process.env.NODE_ENV==='production';
const port=Number(process.env.PORT??3000);
const origin=new URL(process.env.APP_ORIGIN??`http://localhost:${port}`).origin;
if(production&&(!process.env.APP_ORIGIN||!origin.startsWith('https://')))throw Error('Configure APP_ORIGIN com o endereço HTTPS do site.');
const dbFile=resolve(process.env.DATABASE_PATH??'data/simas.sqlite');
mkdirSync(dirname(dbFile),{recursive:true});
const db=new DatabaseSync(dbFile);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','viewer')),password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,message TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);`);
db.prepare('INSERT OR IGNORE INTO workspace(id,data) VALUES (?,?)').run('simas',JSON.stringify(blankState()));
const setupToken=process.env.SETUP_TOKEN??'';
if(!db.prepare('SELECT id FROM users LIMIT 1').get()&&setupToken.length<24)throw Error('Primeira instalação: defina SETUP_TOKEN com pelo menos 24 caracteres aleatórios.');
type User={id:string;email:string;name:string;role:string};
const userFields='id,email,name,role';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const credentials=z.object({email:z.string().trim().email().max(200).transform(x=>x.toLowerCase()),password:z.string().min(12).max(128)});
async function passwordHash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64) as Buffer).toString('hex');}
async function passwordMatches(password:string,stored:string){const [salt,value]=stored.split(':');const computed=await scrypt(password,salt,64) as Buffer;const expected=Buffer.from(value,'hex');return expected.length===computed.length&&timingSafeEqual(computed,expected);}
function cookies(req:IncomingMessage){return Object.fromEntries((req.headers.cookie??'').split(';').map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1)];}));}
function identity(req:IncomingMessage):User|undefined{const token=cookies(req).simas_session;if(!token)return;return db.prepare(`SELECT ${userFields.split(',').map(x=>'u.'+x).join(',')} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?`).get(hash(token),Date.now()) as User|undefined;}
function cookie(token:string,maxAge:number){return `simas_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${production?'; Secure':''}`;}
function session(res:ServerResponse,user:User){const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),user.id,Date.now()+12*60*60*1000);res.setHeader('Set-Cookie',cookie(token,12*60*60));}
function json(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function readState(){return db.prepare('SELECT revision,data FROM workspace WHERE id=?').get('simas') as {revision:number;data:string};}
function snapshot(user:User){const row=readState();return {state:JSON.parse(row.data),revision:row.revision,user,users:user.role==='admin'?db.prepare(`SELECT ${userFields} FROM users ORDER BY name`).all():[]};}
async function body(req:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>256_000)throw Error('Envie menos informações por vez.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function transaction<T>(fn:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function audit(actor:string,message:string){db.prepare('INSERT INTO security_audit(actor,message,at) VALUES (?,?,?)').run(actor,message,new Date().toISOString());}
function allowedAttempt(key:string){db.prepare('DELETE FROM login_limits WHERE reset_at<?').run(Date.now());const row=db.prepare('SELECT attempts FROM login_limits WHERE key=?').get(key) as {attempts:number}|undefined;if((row?.attempts??0)>=10)return false;db.prepare('INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key,Date.now()+15*60*1000);return true;}
const labels:Record<string,string>={employee:'Cadastro de funcionário atualizado',unavailable:'Indisponibilidade cadastrada','remove-unavailable':'Indisponibilidade removida',generate:'Escala recalculada',fix:'Conflitos corrigidos',publish:'Escala publicada',rule:'Regra de dupla atualizada',confirm:'Presenças confirmadas',absence:'Falta registrada',substitute:'Funcionário substituído',kind:'Tipo de dia alterado',demo:'Exemplo demonstrativo carregado'};
function stateChanges(previous:State,state:State){return ['employees','unavailable','days','rules','published'].flatMap(collection=>{const key=(item:unknown)=>{if(typeof item==='string')return item;const r=item as Record<string,unknown>;return String(r.id??r.date??[r.a,r.b].sort().join('|'));};const before=new Map((previous[collection as keyof State] as unknown[]).map(item=>[key(item),item]));const after=new Map((state[collection as keyof State] as unknown[]).map(item=>[key(item),item]));return [...new Set([...before.keys(),...after.keys()])].flatMap(id=>JSON.stringify(before.get(id))===JSON.stringify(after.get(id))?[]:[{collection,before:before.get(id)??null,after:after.get(id)??null}]);});}
const publicDir=resolve('dist/web');
const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
 if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
 try{
 const path=new URL(req.url??'/',origin).pathname;
 if(path==='/healthz')return json(res,200,{status:'ok'});
 if(path.startsWith('/api/')){
  if(req.method!=='GET'&&(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json')))return json(res,403,{error:'Origem não permitida.'});
  if(path==='/api/auth/status'&&req.method==='GET')return json(res,200,{needsSetup:!db.prepare('SELECT id FROM users LIMIT 1').get()});
  if(['/api/auth/login','/api/auth/setup'].includes(path)&&req.method==='POST'){
   const input=await body(req);const parsed=credentials.parse(input);const peer=process.env.TRUST_PROXY==='true'?String(req.headers['x-forwarded-for']??req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress;
   const key=hash('email:'+parsed.email);if(!allowedAttempt(key)||!allowedAttempt(hash('ip:'+peer)))return json(res,429,{error:'Muitas tentativas. Aguarde 15 minutos e tente novamente.'});
   if(path.endsWith('/setup')){
    if(!setupToken||hash(String(input.token??''))!==hash(setupToken))return json(res,403,{error:'Código de instalação inválido.'});
    const name=z.string().trim().min(2).max(100).parse(input.name);const password=await passwordHash(parsed.password);
    const user=transaction(()=>{if(db.prepare('SELECT id FROM users LIMIT 1').get())throw Error('A instalação já foi concluída. Entre com sua conta.');const user={id:randomUUID(),email:parsed.email,name,role:'admin'};db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(user.id,user.email,user.name,user.role,password);audit(user.id,'Administrador inicial criado');return user;});session(res,user);return json(res,201,{ok:true});
   }
   const user=db.prepare('SELECT * FROM users WHERE email=?').get(parsed.email) as (User&{password_hash:string})|undefined;
   const valid=await passwordMatches(parsed.password,user?.password_hash??'00000000000000000000000000000000:'+('00'.repeat(64)));
   if(!user||!valid)return json(res,401,{error:'E-mail ou senha incorretos.'});db.prepare('DELETE FROM login_limits WHERE key=?').run(key);session(res,user);return json(res,200,{ok:true});
  }
  const user=identity(req);if(!user)return json(res,401,{error:'Entre na sua conta para acessar o SIMAS.'});
  if(path==='/api/auth/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(cookies(req).simas_session??''));res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
  if(path==='/api/state'&&req.method==='GET')return json(res,200,snapshot(user));
  if(req.method!=='POST')return json(res,404,{error:'Página não encontrada.'});
  if(user.role!=='admin')return json(res,403,{error:'Somente administradores podem alterar a escala.'});
  if(path==='/api/users'){
   const input=await body(req);const parsed=credentials.extend({name:z.string().trim().min(2).max(100),role:z.enum(['admin','viewer'])}).parse(input);const pw=await passwordHash(parsed.password);
   transaction(()=>{if(db.prepare('SELECT id FROM users WHERE email=?').get(parsed.email))throw Error('Já existe uma conta com esse e-mail.');db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(randomUUID(),parsed.email,parsed.name,parsed.role,pw);audit(user.id,'Conta criada: '+parsed.email);});return json(res,201,snapshot(user));
  }
  if(path==='/api/users/password'){
   const input=z.object({id:z.string(),password:z.string().min(12).max(128)}).parse(await body(req));const pw=await passwordHash(input.password);
   transaction(()=>{if(!db.prepare('SELECT id FROM users WHERE id=?').get(input.id))throw Error('Conta não encontrada.');db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(pw,input.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(input.id);audit(user.id,'Senha redefinida: '+input.id);});return json(res,200,{ok:true});
  }
  if(path==='/api/state'){
   const input=z.object({action:z.string(),revision:z.number().int()}).passthrough().parse(await body(req));
   const row=readState();if(row.revision!==input.revision)return json(res,409,{error:'Outra pessoa alterou os dados. Atualize a página antes de continuar.'});
   if(input.action==='user-role'){const v=z.object({id:z.string(),role:z.enum(['admin','viewer'])}).parse(input);if(v.id===user.id)throw Error('Você não pode alterar seu próprio perfil.');transaction(()=>{db.prepare('UPDATE users SET role=? WHERE id=?').run(v.role,v.id);audit(user.id,'Perfil alterado: '+v.id+' → '+v.role);db.prepare('UPDATE workspace SET revision=revision+1 WHERE id=?').run('simas');});return json(res,200,snapshot(user));}
   const previous=JSON.parse(row.data) as State;const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const state=act(previous,input,today);state.audit.unshift({at:new Date().toISOString(),actor:user.name,message:`${labels[input.action]??input.action}${input.date?' · '+input.date:''}${input.month?' · '+input.month:''}`,changes:stateChanges(previous,state)});
   const result=db.prepare('UPDATE workspace SET data=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(state),'simas',row.revision);if(!result.changes)return json(res,409,{error:'Os dados mudaram em outra sessão. Atualize a página.'});return json(res,200,snapshot(user));
  }
  return json(res,404,{error:'Página não encontrada.'});
 }
 if(!['GET','HEAD'].includes(req.method??''))return json(res,405,{error:'Método não permitido.'});
 let file=resolve(publicDir,'.'+decodeURIComponent(path));if(!file.startsWith(publicDir+sep))file=resolve(publicDir,'index.html');
 if(!existsSync(file)||!statSync(file).isFile()){if(extname(path))return json(res,404,{error:'Arquivo não encontrado.'});file=resolve(publicDir,'index.html');}
 if(!existsSync(file))return json(res,503,{error:'Execute npm run build antes de iniciar.'});
 const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
 res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':file.endsWith('.html')?'no-cache':'public, max-age=86400'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
 }catch(e){if(res.headersSent){res.end();return;}json(res,400,{error:e instanceof z.ZodError?'Confira os campos. Use e-mail válido e senha com pelo menos 12 caracteres.':e instanceof Error&& !e.message.includes('SQLITE')?e.message:'Não foi possível concluir a operação.'});}
});
server.listen(port,process.env.HOST??'0.0.0.0',()=>console.log(`SIMAS: ${origin}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
