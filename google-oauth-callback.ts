import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const GOOGLE_CLIENT_ID=Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET=Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY=Deno.env.get('SERVICE_ROLE_KEY')!;
const ENCRYPTION_KEY=Deno.env.get('ENCRYPTION_KEY')!;
const MAKE_API_TOKEN=Deno.env.get('MAKE_API_TOKEN');
const LANDING='https://walle-legal.vercel.app/listo';
function landing(params:Record<string,string>){return new Response(null,{status:302,headers:{Location:LANDING+'?'+new URLSearchParams(params),'Cache-Control':'no-store'}});}
async function encrypt(token:string){
 const raw=Uint8Array.from(ENCRYPTION_KEY.match(/../g)!.map(v=>parseInt(v,16)));
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(token));
 const all=new Uint8Array(iv.length+cipher.byteLength);all.set(iv);all.set(new Uint8Array(cipher),12);
 return btoa(String.fromCharCode(...all));
}
Deno.serve(async req=>{
 const url=new URL(req.url),code=url.searchParams.get('code'),phone=url.searchParams.get('state');
 if(url.searchParams.has('error'))return landing({error:'cancelado'});
 if(!code||!phone||!/^whatsapp:\+\d{8,15}$/.test(phone))return landing({error:'enlace_invalido'});
 try{
  const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,redirect_uri:'https://walle-legal.vercel.app/oauth/callback',grant_type:'authorization_code'})});
  const token=await tokenRes.json();if(!tokenRes.ok||!token.access_token)return landing({error:'token'});
  const sb=createClient(SUPABASE_URL,SERVICE_ROLE_KEY);
  const {data:existing,error:lookupError}=await sb.from('usuarios_google').select('spreadsheet_id,refresh_token_encrypted').eq('telefono',phone).maybeSingle();
  if(lookupError)return landing({error:'db'});
  const encrypted=token.refresh_token?await encrypt(token.refresh_token):existing?.refresh_token_encrypted;
  if(!encrypted)return landing({error:'token'});
  let spreadsheetId=existing?.spreadsheet_id;
  if(spreadsheetId){
   const accessCheck=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?fields=spreadsheetId',{headers:{Authorization:'Bearer '+token.access_token}});
   if(accessCheck.status===403||accessCheck.status===404)spreadsheetId=null;
   else if(!accessCheck.ok)return landing({error:'sheet'});
  }
  // Reuse accessible sheets; a different Google account receives its own new sheet.
  if(!spreadsheetId){
   const headers=['id_gasto','fecha','hora','valor','moneda','categoria','evento','comercio_lugar','descripcion','medio_pago','fuente'];
   const created=await fetch('https://sheets.googleapis.com/v4/spreadsheets',{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({properties:{title:`Matriz de ${phone.replace('whatsapp:','')}`,timeZone:'America/Bogota',locale:'es_CO'},sheets:[{properties:{title:'Gastos'},data:[{rowData:[{values:headers.map(stringValue=>({userEnteredValue:{stringValue}}))}]}]}]})});
   const result=await created.json();if(!created.ok||!result.spreadsheetId)return landing({error:'sheet'});spreadsheetId=result.spreadsheetId;
  }
  const {error}=await sb.from('usuarios_google').upsert({telefono:phone,spreadsheet_id:spreadsheetId,refresh_token_encrypted:encrypted,estado:'activo',actualizado_en:new Date().toISOString()},{onConflict:'telefono'});
  if(error)return landing({error:'db'});
  // Same internal secret as Make; creation and migration share the tested design.
  const layout=await fetch(`${SUPABASE_URL}/functions/v1/sheets-write`,{method:'POST',headers:{'Content-Type':'application/json','x-webhook-secret':Deno.env.get('WEBHOOK_SECRET')!},body:JSON.stringify({action:'migrate',phone})});
  if(!layout.ok){console.error('[walle] sheet layout failed',layout.status);return landing({error:'sheet'});}
  if(!MAKE_API_TOKEN)return landing({error:'sincronizacion'});
  const sync=await fetch(`https://us2.make.com/api/v2/data-stores/136614/data/${encodeURIComponent(phone)}`,{method:'PATCH',headers:{Authorization:`Token ${MAKE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({estado:'activo',spreadsheet_id:spreadsheetId,actualizado_en:new Date().toISOString()})});
  if(!sync.ok){console.error('[walle] Make sync failed',sync.status);return landing({error:'sincronizacion'});}
  return landing({sheet:spreadsheetId});
 }catch(e){console.error('[walle] callback failed');return landing({error:'conexion'});}
});
