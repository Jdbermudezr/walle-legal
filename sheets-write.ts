// Walle product schema v2. Pure helpers are shared by both Edge Functions and tests.
const HEADERS = ['id_gasto','fecha','hora','valor','moneda','categoria','evento','comercio_lugar','descripcion','medio_pago','fuente','tipo_movimiento','registrado_en'];
const TZ = 'America/Bogota';
function isoDay(now = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10) === s; }
function serial(s) { if (!validDate(s)) throw new Error('Fecha inválida: '+s); return (Date.parse(s+'T00:00:00Z') - Date.UTC(1899,11,30))/86400000; }
function fromSerial(n) { return new Date(Date.UTC(1899,11,30)+n*86400000).toISOString().slice(0,10); }
function asDate(v) { if(typeof v==='number') return fromSerial(v); const s=String(v??'').trim(); if(validDate(s))return s; const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(m){const d=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(validDate(d))return d;} return ''; }
function norm(s) { return String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(); }
function parseAnalysis(value) { const a=typeof value==='string'?JSON.parse(value):value; if(!a||typeof a!=='object'||Array.isArray(a))throw new Error('Análisis inválido');return a; }
function recordRows(a, messageId, now=new Date()) {
  if(a.guardar!==true || a.intencion!=='confirmar_gastos' || !Array.isArray(a.gastos)||!a.gastos.length)throw new Error('Falta confirmación de movimientos');
  if(!messageId || !/^[A-Za-z0-9_-]{5,160}$/.test(messageId))throw new Error('Falta identificador de mensaje');
  return a.gastos.map((g,i)=>{
    if(!['ingreso','egreso'].includes(g.tipo_movimiento)) throw new Error('Falta tipo de movimiento');
    if(!validDate(g.fecha))throw new Error('Falta fecha exacta del movimiento');
    if(typeof g.valor!=='number'||!Number.isFinite(g.valor)||g.valor<=0||Math.abs(g.valor*100-Math.round(g.valor*100))>0.0001)throw new Error('Valor inválido');
    if(!/^[A-Z]{3}$/.test(g.moneda))throw new Error('Moneda inválida');
    if(!String(g.descripcion||g.comercio_lugar||'').trim())throw new Error('Falta concepto');
    if(g.hora && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(g.hora))throw new Error('Hora inválida');
    return [`${messageId}-${i+1}`,serial(g.fecha),g.hora||'',g.valor,g.moneda,g.categoria||'Otros',g.evento||'Diario',g.comercio_lugar||'',g.descripcion||'',g.medio_pago||'',g.fuente||'texto',g.tipo_movimiento,now.toISOString()];
  });
}
function summarize(rows, query={}) {
  const q=query||{}, start=q.fecha_inicio||'', end=q.fecha_fin||'';
  if((start&&!validDate(start))||(end&&!validDate(end))||(start&&end&&start>end))throw new Error('Período inválido');
  if(!['','ingreso','egreso','balance','todos'].includes(q.tipo_movimiento||''))throw new Error('Tipo de consulta inválido');
  const totals=new Map();let invalid=0;
  for(const r of rows){ if(r.every(x=>x===''||x==null))continue;
    const date=asDate(r[1]), amount=typeof r[3]==='number'?r[3]:Number(r[3]), currency=String(r[4]||'').trim().toUpperCase(), type=r[11]||'egreso';
    if(!date||!Number.isFinite(amount)||amount<=0||!['ingreso','egreso'].includes(type)||!/^[A-Z]{3}$/.test(currency)){invalid++;continue;}
    if(start&&date<start||end&&date>end)continue;
    if(q.moneda&&currency!==q.moneda.toUpperCase())continue;
    if(q.categoria&&norm(r[5])!==norm(q.categoria))continue;
    if(q.evento&&norm(r[6])!==norm(q.evento))continue;
    if(q.tipo_movimiento==='ingreso'&&type!=='ingreso'||q.tipo_movimiento==='egreso'&&type!=='egreso')continue;
    const t=totals.get(currency)||{moneda:currency,ingresos:0,egresos:0,movimientos:0};
    t[type==='ingreso'?'ingresos':'egresos']+=Math.round(amount*100);t.movimientos++;totals.set(currency,t);
  }
  return {fecha_inicio:start,fecha_fin:end,filas_invalidas:invalid,totales:[...totals.values()].sort((a,b)=>a.moneda.localeCompare(b.moneda)).map(t=>({...t,ingresos:t.ingresos/100,egresos:t.egresos/100,balance:(t.ingresos-t.egresos)/100}))};
}
function summaryText(result,q={}) {
  const period=result.fecha_inicio&&result.fecha_fin?`Del ${result.fecha_inicio} al ${result.fecha_fin}`:result.fecha_inicio?`Desde ${result.fecha_inicio}`:result.fecha_fin?`Hasta ${result.fecha_fin}`:'En todo tu historial';
  const fmt=n=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(n);
  let text=period+(q.categoria?` · ${q.categoria}`:'')+(q.evento?` · ${q.evento}`:'')+':\n';
  text+=result.totales.length?result.totales.map(t=>q.tipo_movimiento==='egreso'?`Egresos: ${fmt(t.egresos)} ${t.moneda} (${t.movimientos} movimientos).`:q.tipo_movimiento==='ingreso'?`Ingresos: ${fmt(t.ingresos)} ${t.moneda} (${t.movimientos} movimientos).`:`${t.moneda}\nIngresos: ${fmt(t.ingresos)}\nEgresos: ${fmt(t.egresos)}\nBalance registrado: ${fmt(t.balance)}`).join('\n\n'):'No hay movimientos que coincidan.';
  if(result.filas_invalidas)text+=`\nHay ${result.filas_invalidas} filas con datos inválidos que no se pudieron sumar. Revisa tu hoja.`;
  return text;
}
const color = hex => ({red:parseInt(hex.slice(1,3),16)/255,green:parseInt(hex.slice(3,5),16)/255,blue:parseInt(hex.slice(5,7),16)/255});
const C={ink:color('#183D3D'),green:color('#16805D'),red:color('#CF5060'),blue:color('#3574BA'),white:color('#FFFFFF'),mint:color('#EAF7EF'),rose:color('#FFF0F1'),pale:color('#F4F7F8')};
function cell(v){ return {userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}}; }
function writeCells(sheetId,row,col,values){return {updateCells:{start:{sheetId,rowIndex:row,columnIndex:col},rows:values.map(r=>({values:r.map(cell)})),fields:'userEnteredValue'}};}
function chartSpec(sheetId,col,title,colour,row){ return {addChart:{chart:{spec:{title,fontName:'Arial',backgroundColor:C.white,basicChart:{chartType:col===3?'LINE':'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS',title:'Mes'},{position:'LEFT_AXIS',title:'Valor en moneda seleccionada'}],domains:[{domain:{sourceRange:{sources:[{sheetId,startRowIndex:7,endRowIndex:20,startColumnIndex:0,endColumnIndex:1}]}}}],series:[{series:{sourceRange:{sources:[{sheetId,startRowIndex:7,endRowIndex:20,startColumnIndex:col,endColumnIndex:col+1}]}},targetAxis:'LEFT_AXIS',color:colour}]}},position:{overlayPosition:{anchorCell:{sheetId,rowIndex:row,columnIndex:5},widthPixels:720,heightPixels:260}}}}}; }
function designRequests(movId,graphId,name,existingRows=[],year=new Date().getFullYear()) {
 const req=[], format=(range,fmt)=>req.push({repeatCell:{range,cell:{userEnteredFormat:fmt},fields:'userEnteredFormat'}});
 req.push({updateSpreadsheetProperties:{properties:{title:`Matriz de ${name||'Walle'}`,timeZone:TZ,locale:'es_CO'},fields:'title,timeZone,locale'}});
 req.push({updateSheetProperties:{properties:{sheetId:movId,title:'Movimientos',gridProperties:{frozenRowCount:1,hideGridlines:true},tabColorStyle:{rgbColor:C.green}},fields:'title,gridProperties.frozenRowCount,gridProperties.hideGridlines,tabColorStyle'}});
 req.push(writeCells(movId,0,0,[HEADERS]));
 const rows=existingRows.map((r,i)=>{const x=[...r];while(x.length<13)x.push(''); if(x.every(v=>v===''))return x;const d=asDate(x[1]);if(d)x[1]=serial(d);if(typeof x[3]==='string'&&/^\d+(\.\d+)?$/.test(x[3]))x[3]=Number(x[3]);x[11]=x[11]||'egreso';return x;});
 if(rows.length)req.push(writeCells(movId,1,0,rows));
 format({sheetId:movId},{textFormat:{fontFamily:'Arial',fontSize:10,foregroundColor:C.ink},verticalAlignment:'MIDDLE'});
 format({sheetId:movId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:13},{backgroundColor:C.ink,textFormat:{fontFamily:'Arial',fontSize:10,bold:true,foregroundColor:C.white},verticalAlignment:'MIDDLE'});
 req.push({setBasicFilter:{filter:{range:{sheetId:movId,startRowIndex:0,startColumnIndex:0,endColumnIndex:13}}}});
 req.push({updateDimensionProperties:{range:{sheetId:movId,dimension:'COLUMNS',startIndex:0,endIndex:13},properties:{pixelSize:135},fields:'pixelSize'}});
 req.push({updateDimensionProperties:{range:{sheetId:movId,dimension:'COLUMNS',startIndex:8,endIndex:9},properties:{pixelSize:260},fields:'pixelSize'}});
 req.push({updateDimensionProperties:{range:{sheetId:movId,dimension:'COLUMNS',startIndex:0,endIndex:1},properties:{hiddenByUser:true},fields:'hiddenByUser'}});
 req.push({updateDimensionProperties:{range:{sheetId:movId,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:36},fields:'pixelSize'}});
 for(const [col,type,pattern] of [[1,'DATE','dd/mm/yyyy'],[3,'NUMBER','#,##0.00']])req.push({repeatCell:{range:{sheetId:movId,startRowIndex:1,startColumnIndex:col,endColumnIndex:col+1},cell:{userEnteredFormat:{numberFormat:{type,pattern}}},fields:'userEnteredFormat.numberFormat'}});
 for(const [type,bg,fg] of [['ingreso',C.mint,C.green],['egreso',C.rose,C.red]])req.push({addConditionalFormatRule:{index:0,rule:{ranges:[{sheetId:movId,startRowIndex:1,startColumnIndex:0,endColumnIndex:13}],booleanRule:{condition:{type:'CUSTOM_FORMULA',values:[{userEnteredValue:`=$L2="${type}"`}]},format:{backgroundColor:bg,textFormat:{foregroundColor:fg}}}}}});
 req.push({setDataValidation:{range:{sheetId:movId,startRowIndex:1,startColumnIndex:11,endColumnIndex:12},rule:{condition:{type:'ONE_OF_LIST',values:[{userEnteredValue:'ingreso'},{userEnteredValue:'egreso'}]},strict:true,showCustomUi:true}}});
 req.push({updateSheetProperties:{properties:{sheetId:graphId,gridProperties:{hideGridlines:true},tabColorStyle:{rgbColor:C.blue}},fields:'gridProperties.hideGridlines,tabColorStyle'}});
 format({sheetId:graphId,startRowIndex:0,endRowIndex:46,startColumnIndex:0,endColumnIndex:14},{textFormat:{fontFamily:'Arial',fontSize:10,foregroundColor:C.ink},verticalAlignment:'MIDDLE'});
 req.push(writeCells(graphId,1,0,[[`Matriz de ${name||'Walle'}`],['Creado por Juan Diego Bermúdez Rivera']]));
 for(const row of [1,2])req.push({mergeCells:{range:{sheetId:graphId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:0,endColumnIndex:12},mergeType:'MERGE_ALL'}});
 format({sheetId:graphId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:12},{textFormat:{fontFamily:'Arial',fontSize:16,bold:true,foregroundColor:C.ink}});
 req.push(writeCells(graphId,4,0,[['Año',year,'Moneda','COP'],['Elige el año y la moneda para ver tus resultados.']]));
 req.push({mergeCells:{range:{sheetId:graphId,startRowIndex:5,endRowIndex:6,startColumnIndex:0,endColumnIndex:12},mergeType:'MERGE_ALL'}});
 format({sheetId:graphId,startRowIndex:4,endRowIndex:5,startColumnIndex:1,endColumnIndex:2},{backgroundColor:color('#FFF3D3'),numberFormat:{type:'NUMBER',pattern:'0'}});
 format({sheetId:graphId,startRowIndex:4,endRowIndex:5,startColumnIndex:3,endColumnIndex:4},{backgroundColor:color('#FFF3D3')});
 const currencies=[...new Set(['COP','USD',...rows.map(r=>r[4]).filter(Boolean)])];
 req.push({setDataValidation:{range:{sheetId:graphId,startRowIndex:4,endRowIndex:5,startColumnIndex:3,endColumnIndex:4},rule:{condition:{type:'ONE_OF_LIST',values:currencies.map(v=>({userEnteredValue:v}))},strict:false,showCustomUi:true}}});
 req.push(writeCells(graphId,7,0,[['Mes','Ingresos','Egresos','Balance']]));
 const formulaRows=[];
 for(let row=9;row<=20;row++){
  const month=row-8;
  const sum=type=>`=SUMIFS('Movimientos'!D$2:D,'Movimientos'!L$2:L,"${type}",'Movimientos'!E$2:E,$D$5,'Movimientos'!B$2:B,">="&A${row},'Movimientos'!B$2:B,"<"&EDATE(A${row},1))`;
  formulaRows.push({values:[`=DATE($B$5,${month},1)`,sum('ingreso'),sum('egreso'),`=B${row}-C${row}`].map(formulaValue=>({userEnteredValue:{formulaValue}}))});
 }
 req.push({updateCells:{start:{sheetId:graphId,rowIndex:8,columnIndex:0},rows:formulaRows,fields:'userEnteredValue'}});
 req.push(writeCells(graphId,21,0,[['Total anual']]));
 req.push({updateCells:{start:{sheetId:graphId,rowIndex:21,columnIndex:1},rows:[{values:['=SUM(B9:B20)','=SUM(C9:C20)','=B22-C22'].map(formulaValue=>({userEnteredValue:{formulaValue}}))}],fields:'userEnteredValue'}});
 format({sheetId:graphId,startRowIndex:7,endRowIndex:8,startColumnIndex:0,endColumnIndex:4},{backgroundColor:C.ink,textFormat:{bold:true,foregroundColor:C.white}});
 req.push({repeatCell:{range:{sheetId:graphId,startRowIndex:8,endRowIndex:20,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'mmm'}}},fields:'userEnteredFormat.numberFormat'}});
 req.push({repeatCell:{range:{sheetId:graphId,startRowIndex:8,endRowIndex:22,startColumnIndex:1,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'#,##0.00'}}},fields:'userEnteredFormat.numberFormat'}});
 req.push({updateDimensionProperties:{range:{sheetId:graphId,dimension:'COLUMNS',startIndex:0,endIndex:4},properties:{pixelSize:135},fields:'pixelSize'}});
 req.push(chartSpec(graphId,2,'Egresos mensuales',C.red,7),chartSpec(graphId,1,'Ingresos mensuales',C.green,22),chartSpec(graphId,3,'Balance mensual',C.blue,37));
 req.push({createDeveloperMetadata:{developerMetadata:{metadataKey:'walle_schema',metadataValue:'2',location:{spreadsheet:true},visibility:'DOCUMENT'}}});
 return req;
}

// Runtime appended to core.mjs by build.mjs; secrets remain in Supabase.
const SB_URL=Deno.env.get('SUPABASE_URL');
const SB_KEY=Deno.env.get('SERVICE_ROLE_KEY');
const HOOK_SECRET=Deno.env.get('WEBHOOK_SECRET');
const locks=new Map();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function readUser(phone){
 const r=await fetch(`${SB_URL}/rest/v1/usuarios_google?telefono=eq.${encodeURIComponent(phone)}&select=spreadsheet_id,refresh_token_encrypted`,{headers:{apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`}});
 if(!r.ok)throw new Error('No se pudo consultar el usuario');const a=await r.json();if(a.length!==1||!a[0].refresh_token_encrypted)throw new Error('Usuario sin conexión Google');return a[0];
}
async function accessFor(user){
 const keyHex=Deno.env.get('ENCRYPTION_KEY');const keyBytes=Uint8Array.from(keyHex.match(/../g).map(v=>parseInt(v,16)));
 const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);
 const cipher=Uint8Array.from(atob(user.refresh_token_encrypted),c=>c.charCodeAt(0));
 const refresh=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:cipher.slice(0,12)},key,cipher.slice(12)));
 const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:Deno.env.get('GOOGLE_CLIENT_ID'),client_secret:Deno.env.get('GOOGLE_CLIENT_SECRET'),refresh_token:refresh,grant_type:'refresh_token'})});
 const token=await res.json();if(!res.ok||!token.access_token)throw new Error('No se pudo renovar el acceso Google');return token.access_token;
}
function googleClient(id,token){return async(path='',method='GET',body)=>{
 const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw new Error(`Google Sheets ${r.status}: ${data.error?.message||'operación fallida'}`);return data;
};}
async function ensureSchema(g,name){
 const meta=await g('?fields=spreadsheetId,properties(title),sheets(properties,charts(chartId)),developerMetadata');
 if(meta.developerMetadata?.some(m=>m.metadataKey==='walle_schema'&&m.metadataValue==='2')){
  const mov=meta.sheets.find(s=>s.properties.title==='Movimientos');if(!mov)throw new Error('No existe la pestaña Movimientos');return mov.properties.sheetId;
 }
 const mov=meta.sheets.find(s=>s.properties.title==='Gastos')||meta.sheets.find(s=>s.properties.title==='Movimientos');
 if(!mov)throw new Error('No se encontró la hoja de movimientos original');
 const existing=await g(`/values/${encodeURIComponent("'"+mov.properties.title+"'!A:Z")}?valueRenderOption=UNFORMATTED_VALUE`);
 const values=existing.values||[];
 if(values.length&&HEADERS.slice(0,11).some((h,i)=>values[0][i]!==h))throw new Error('Encabezados distintos al esquema Walle; migración detenida');
 if(values.some(r=>r.slice(13).some(v=>v!==''&&v!=null)))throw new Error('Hay columnas adicionales; migración detenida para conservarlas');
 if(meta.sheets.some(s=>s.properties.title==='Gráficos'))throw new Error('Ya existe Gráficos sin marca de versión; revisar antes de migrar');
 const graphId=Math.max(...meta.sheets.map(s=>s.properties.sheetId))+1;
 const batch=[{addSheet:{properties:{sheetId:graphId,title:'Gráficos',gridProperties:{rowCount:1000,columnCount:26}}}},...designRequests(mov.properties.sheetId,graphId,name,values.slice(1),Number(isoDay().slice(0,4)))];
 await g(':batchUpdate','POST',{requests:batch});return mov.properties.sheetId;
}
async function processRequest(body){
 const phone=body.phone;if(typeof phone!=='string'||!/^whatsapp:\+\d{8,15}$/.test(phone))throw new Error('Teléfono inválido');
 const action=body.action||'legacy';
 if(!['legacy','record','query','migrate','inspect'].includes(action))throw new Error('Acción inválida');
 const analysis=body.analysis?parseAnalysis(body.analysis):null;
 let pending;
 if(action==='record')pending=recordRows(analysis,body.message_id);
 const user=await readUser(phone), token=await accessFor(user), g=googleClient(user.spreadsheet_id,token);
 if(action==='inspect')return {ok:true,metadata:await g('?fields=spreadsheetId,properties,sheets(properties,charts(chartId,spec(title))),developerMetadata'),values:await g(`/values/${encodeURIComponent("'Movimientos'!A:M")}?valueRenderOption=UNFORMATTED_VALUE`),graphs:await g(`/values/${encodeURIComponent("'Gráficos'!A1:D22")}?valueRenderOption=UNFORMATTED_VALUE`)};
 let ownerName=body.name;
 if(!ownerName){const about=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName)',{headers:{Authorization:`Bearer ${token}`}});if(about.ok)ownerName=(await about.json()).user?.displayName;}
 const movId=await ensureSchema(g,ownerName||phone.replace('whatsapp:',''));
 if(action==='migrate')return {ok:true,spreadsheet_id:user.spreadsheet_id,schema:2};
 if(action==='legacy'){
  if(!Array.isArray(body.values)||body.values.length<11)throw new Error('Faltan values');
  const v=body.values.slice(0,11), d=asDate(v[1]);
  if(!d)throw new Error('Fecha de origen inválida');v[1]=serial(d);v[3]=Number(v[3]);if(!Number.isFinite(v[3])||v[3]<=0)throw new Error('Valor inválido');
  pending=[[...v,'egreso',new Date().toISOString()]];
 }
 const data=await g(`/values/${encodeURIComponent("'Movimientos'!A2:M")}?valueRenderOption=UNFORMATTED_VALUE`);const rows=data.values||[];
 if(action==='query'){
  const q=analysis?.consulta||body.query;if(!q||typeof q!=='object')throw new Error('Falta período de consulta');
  const result=summarize(rows,q);return {ok:true,...result,respuesta_bot:summaryText(result,q)};
 }
 const ids=new Set(rows.map(r=>String(r[0])));const append=pending.filter(r=>!ids.has(String(r[0])));
 if(append.length)await g(`/values/${encodeURIComponent("'Movimientos'!A:M")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,'POST',{values:append});
 return {ok:true,registrados:append.length,duplicados:pending.length-append.length,respuesta_bot:append.length?`Registrado ✅ ${append.length} movimiento${append.length===1?'':'s'} en tu hoja.`:'Estos movimientos ya estaban registrados ✅'};
}
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 if(!HOOK_SECRET||req.headers.get('x-webhook-secret')!==HOOK_SECRET)return json({error:'unauthorized'},401);
 let body;try{body=await req.json();}catch{return json({error:'JSON inválido'},400);}
 const key=String(body.phone||'');const previous=locks.get(key)||Promise.resolve();
 const work=previous.catch(()=>{}).then(()=>processRequest(body));locks.set(key,work);
 try{return json(await work);}catch(e){console.error('[walle]',String(e.message));return json({error:e.message},400);}finally{if(locks.get(key)===work)locks.delete(key);}
});
