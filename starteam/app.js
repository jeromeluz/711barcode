import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getDatabase, ref, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
const app=initializeApp(firebaseConfig), db=getDatabase(app);
const root=ref(db,'inventory');
let unsubscribe=null;
function response(status,payload){return {ok:status>=200&&status<300,status,json:async()=>payload}}
function validNumber(n){return Number.isSafeInteger(n)&&n>=0}
// 舊資料沒有好壞欄位時，預設全部為良品；不會直接改寫 Firebase 舊庫存。
function condition(stock){
 const expected=validNumber(stock?.expected)?stock.expected:null;
 const bad=validNumber(stock?.bad)?stock.bad:0;
 const good=validNumber(stock?.good)?stock.good:(expected===null?null:Math.max(0,expected-bad));
 return {good,bad,borrowable:Math.max(0,stock?.remaining??0)};
}

// 以實際取用／歸還紀錄計算尚未歸還數量；盤點紀錄不影響借用差額。
function outstandingFromHistory(d,store,itemName){
 let net=0;
 for(const h of d.history||[]){
  if(h.store!==store||h.item!==itemName)continue;
  const n=Number(h.quantity);
  if(!Number.isSafeInteger(n)||n<0)continue;
  if(h.type==='take')net+=n;
  else if(h.type==='restock')net-=n;
 }
 return Math.max(0,net);
}
function availableGood(stock,outstanding){
 const c=condition(stock);
 return Math.max(0,stock.remaining??0);
}

function validatePerson(d,p){if(typeof p.person!=='string'||!d.people?.includes(p.person.trim()))throw Error('請從人員清單選擇姓名');if(!d.stores.includes(p.store))throw Error('門市不存在')}
// 兼容門市改名：stores 清單已更名，但物品庫存仍以舊名稱為鍵。
// 僅在能明確辨識單一舊鍵時搬移，不會憑空建立 0 庫存。
function repairStoreKeys(d){
 if(!Array.isArray(d?.stores)||!Array.isArray(d?.items))return false;
 let changed=false;
 for(const item of d.items){
  if(!item.stores||typeof item.stores!=='object')throw Error(`物品「${item.name}」沒有門市庫存資料`);
  for(const name of d.stores){
   if(item.stores[name])continue;
   const oldKeys=Object.keys(item.stores).filter(k=>!d.stores.includes(k));
   const old=oldKeys.includes('大村村中')&&name==='順風'?'大村村中':oldKeys.length===1?oldKeys[0]:null;
   if(!old||!item.stores[old])throw Error(`「${item.name}」找不到「${name}」的庫存，請檢查 Firebase items/stores 的門市名稱`);
   item.stores[name]=item.stores[old];delete item.stores[old];changed=true;
  }
 }
 return changed;
}
function mutate(d,path,p){
 if(!d||!Array.isArray(d.items)||!Array.isArray(d.stores))throw Error('資料庫結構不完整，請檢查 inventory/stores 和 inventory/items');
 repairStoreKeys(d);
 if(!Array.isArray(d.history))d.history=[];
 if(!Array.isArray(d.people))d.people=[];
 if(path==='/api/stores'){
  const action=p.action, oldName=typeof p.oldName==='string'?p.oldName.trim():'', newName=typeof p.newName==='string'?p.newName.trim():'';
  if(action==='add'){
   if(!newName||newName.length>40||/[\/\\.#$\[\]]/.test(newName))throw Error('門市名稱需為 1 至 40 字，不可包含 / \u005c . # $ [ ]');
   if(d.stores.includes(newName)||d.items.some(i=>Object.hasOwn(i.stores,newName)))throw Error('門市名稱已存在');
   d.stores.push(newName);
   for(const item of d.items)item.stores[newName]={expected:0,remaining:0,good:0,bad:0};
   if(!Array.isArray(d.storeChanges))d.storeChanges=[];
   d.storeChanges.unshift({action:'add',newName,time:new Date().toISOString()});
   return;
  }
  if(!d.stores.includes(oldName))throw Error('門市不存在或已被其他人修改，請重新整理');
  if(action==='rename'){
   if(!newName||newName.length>40||newName.includes('/')||newName.includes('\\'))throw Error('門市名稱不正確，請使用 1 至 40 字且不可包含斜線');
   if(newName===oldName)throw Error('新舊門市名稱相同');
   if(d.stores.includes(newName)||d.items.some(i=>Object.hasOwn(i.stores,newName)))throw Error('新門市名稱已存在，不能覆蓋');
   for(const item of d.items){if(!Object.hasOwn(item.stores,oldName))throw Error('部分物品缺少舊門市庫存，已取消更名')}
   d.stores=d.stores.map(n=>n===oldName?newName:n);
   for(const item of d.items){item.stores[newName]=item.stores[oldName];delete item.stores[oldName]}
   for(const h of d.history){if(h.store===oldName)h.store=newName}
   if(!Array.isArray(d.storeChanges))d.storeChanges=[];
   d.storeChanges.unshift({action:'rename',oldName,newName,time:new Date().toISOString()});
   return;
  }
  if(action==='delete'){
   if(d.stores.length<=1)throw Error('至少需要保留一間門市');
   if(p.confirmName!==oldName||p.confirmPhrase!=='確認永久刪除')throw Error('刪除確認內容不正確');
   // 先封存門市庫存與完整歷史紀錄，再從使用中的清單移除。
   if(!d.deletedStores||typeof d.deletedStores!=='object')d.deletedStores={};
   const archiveId='deleted_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);
   d.deletedStores[archiveId]={name:oldName,deletedAt:new Date().toISOString(),items:d.items.map(i=>({name:i.name,stock:i.stores[oldName]})),history:d.history.filter(h=>h.store===oldName)};
   d.stores=d.stores.filter(n=>n!==oldName);
   for(const item of d.items)delete item.stores[oldName];
   d.history=d.history.filter(h=>h.store!==oldName);
   if(!Array.isArray(d.storeChanges))d.storeChanges=[];
   d.storeChanges.unshift({action:'delete',oldName,time:new Date().toISOString(),archiveId});
   return;
  }
  throw Error('未知門市操作');
 }
 if(path==='/api/personnel'){
  if(!Array.isArray(p.people)||p.people.length>200)throw Error('人員清單格式錯誤');
  const names=p.people.map(x=>typeof x==='string'?x.trim():'');
  if(names.some(x=>!x||x.length>40)||new Set(names).size!==names.length)throw Error('姓名不可空白、重複或超過40字');
  d.people=names;return;
 }
 validatePerson(d,p);
 if(!Array.isArray(p.items)||!p.items.length||p.items.length>d.items.length)throw Error('物品清單不正確');
 if(path==='/api/audit'&&p.items.length!==d.items.length)throw Error('盤點必須包含全部物品');
 if(path==='/api/transactions'&&!['take','restock'].includes(p.type))throw Error('操作類型錯誤');
 const seen=new Set(),changes=[];
 for(const x of p.items){
  if(!x||seen.has(x.name)||!validNumber(x.quantity))throw Error('物品或數量不正確');
  seen.add(x.name);
  const item=d.items.find(i=>i.name===x.name);if(!item)throw Error('找不到物品 '+x.name);
  if(path==='/api/transactions'&&x.quantity===0)throw Error('取用或歸還數量必須大於零');
  const stock=item.stores[p.store];if(!stock)throw Error(`${x.name} 缺少 ${p.store} 的庫存資料`);
  const expected=stock.expected;
  if(path==='/api/audit'){
   if(!validNumber(x.good)||!validNumber(x.bad)||x.good+x.bad!==x.quantity)throw Error(`${x.name} 的良品＋損壞或舊品必須等於應有數量`);
  }
  const before=path==='/api/audit'?(expected??null):item.stores[p.store].remaining;
  if(path==='/api/transactions'&&!validNumber(before))throw Error(`${x.name} 的剩餘數量不正確，請檢查資料庫`);
  if(path==='/api/transactions'&&p.type==='restock'&&validNumber(expected)&&before+x.quantity>expected&&!p.confirmOverLimit)throw Error(`${x.name} 歸還後 ${before+x.quantity} 件，超過應有數量 ${expected} 件，請先確認超量歸還`);
  if(path==='/api/transactions'&&p.type==='take'&&x.quantity>availableGood(stock,outstandingFromHistory(d,p.store,x.name)))throw Error(`${x.name} 可借用庫存只有 ${availableGood(stock,outstandingFromHistory(d,p.store,x.name))} 個`);
  const after=path==='/api/audit'?x.quantity:p.type==='take'?before-x.quantity:before+x.quantity;
  if(!validNumber(after))throw Error('數量超出範圍');
  changes.push({item,quantity:x.quantity,before:before??null,after,borrowed:path==='/api/audit'?outstandingFromHistory(d,p.store,x.name):null,beforeRemaining:stock.remaining,beforeGood:condition(stock).good,beforeBad:condition(stock).bad,good:x.good,bad:x.bad});
 }
 if(path==='/api/audit'&&d.items.some(i=>!seen.has(i.name)))throw Error('盤點項目不完整');
 const overLimitReturns=path==='/api/transactions'&&p.type==='restock'?changes.filter(c=>validNumber(c.item.stores[p.store].expected)&&c.after>c.item.stores[p.store].expected):[];
 const batchId=crypto.randomUUID(),time=new Date().toISOString(),type=path==='/api/audit'?'audit':p.type;
 for(const [index,c] of changes.entries()){
  if(type==='audit'){if(c.borrowed>c.after)throw Error(`${c.item.name} 尚未歸還 ${c.borrowed} 件，超過盤點應有 ${c.after} 件，請先核對借用紀錄`);c.item.stores[p.store].expected=c.after;c.item.stores[p.store].good=c.good;c.item.stores[p.store].bad=c.bad;c.item.stores[p.store].remaining=c.after-c.borrowed;}
  else c.item.stores[p.store].remaining=c.after;
  d.history.unshift({id:batchId+'-'+index,batchId,time,type,person:p.person.trim(),store:p.store,item:c.item.name,quantity:c.quantity,before:c.before??null,after:c.after,beforeRemaining:type==='audit'?c.beforeRemaining:null,afterRemaining:type==='audit'?c.after-c.borrowed:null,outstanding:type==='audit'?c.borrowed:null,beforeGood:type==='audit'?c.beforeGood:null,afterGood:type==='audit'?c.good:null,beforeBad:type==='audit'?c.beforeBad:null,afterBad:type==='audit'?c.bad:null,overLimit:type==='restock'&&validNumber(c.item.stores[p.store].expected)&&c.after>c.item.stores[p.store].expected});
 }
}
async function apiFetch(path,options={}){
 if(path==='/api/data')return response(data?200:503,data||{error:'尚未載入'});
 let payload;try{payload=JSON.parse(options.body||'{}')}catch{return response(400,{error:'資料格式錯誤'})}
 let failure=null;
 try{
  const result=await runTransaction(root,current=>{
   if(current===null){failure='資料庫尚未初始化';return;}
   try{mutate(current,path,payload);failure=null;return current}
   catch(e){failure=e.message;return}
  },{applyLocally:false});
  if(!result.committed)return response(409,{error:failure||'資料已變更，請重新操作'});
  return response(200,{ok:true});
 }catch(e){return response(500,{error:e.message||'寫入失敗，請檢查 Firebase 權限'})}
}

const $=id=>document.getElementById(id);let data=null;let store='';let mode='take';const labels={take:'取用',restock:'歸還',set:'盤點設定',audit:'應有數量盤點'};function td(text){let el=document.createElement('td');el.textContent=String(text);return el}function row(parent,values){let tr=document.createElement('tr');values.forEach(v=>tr.append(td(v)));parent.append(tr)}function draw(){if(!data)return;const selections=Object.fromEntries([...document.querySelectorAll('.item-choice')].map(el=>[el.dataset.name,{checked:el.querySelector('[type=checkbox]').checked,quantity:el.querySelector('[type=number]').value}]));$('store').replaceChildren(...data.stores.map(s=>{let o=new Option(s,s);return o}));if(!data.stores.includes(store))store=data.stores[0];$('store').value=store;renderChoices(selections);$('inventory').replaceChildren();let total=0;data.items.forEach(i=>{let st=i.stores[store];total+=st.remaining;row($('inventory'),[i.name,st.expected??'未設定',`良品 ${condition(st).good??'未設定'} / 損壞或舊品 ${condition(st).bad}`,availableGood(st,outstandingFromHistory(data,store,i.name)),st.expected===null?'—':st.expected-st.remaining])});renderStoreEditor();$('inventory-summary').textContent=`${data.items.length} 種物品 · 可借用共 ${total} 件 · 取用 ${data.history.filter(h=>h.store===store&&h.type==='take').length} 筆紀錄`;renderPeople();renderHistory();$('status').textContent='資料已同步'}function renderPeople(){for(const id of ['person','audit-person']){const el=$(id),old=el.value;el.replaceChildren(new Option('請選擇人員',''),...(data.people||[]).map(n=>new Option(n,n)));if((data.people||[]).includes(old))el.value=old}}
function localDate(time){const d=new Date(time);return Number.isNaN(d.getTime())?'未知日期':new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function localTime(time){const d=new Date(time);return Number.isNaN(d.getTime())?'時間不明':d.toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'})}
// 每個紀錄區塊獨立分頁，每次顯示最多 10 筆操作（同次多物品算 1 筆）。
const historyLimit={'take-history':10,'audit-history':10};
function renderHistory(){
 renderHistoryType('take-history',data.history.filter(h=>h.store===store&&h.type!=='audit'&&h.type!=='set'));
 renderHistoryType('audit-history',data.history.filter(h=>h.store===store&&(h.type==='audit'||h.type==='set')));
}
function renderHistoryType(target,records){
 const host=$(target);
 // 即時更新時，盡可能保留使用者已展開的日期及明細。
 const openDates=new Set([...host.querySelectorAll('.history-date[open]')].map(el=>el.dataset.day));
 const openBatches=new Set([...host.querySelectorAll('.history-batch[open]')].map(el=>el.dataset.batch));
 host.replaceChildren();
 if(!records.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent='目前沒有紀錄';host.append(empty);return}
 const batches=new Map();
 for(const h of records){
  const key=String(h.batchId||h.id||`${h.time}-${h.person}-${h.item}`);
  if(!batches.has(key))batches.set(key,[]);
  batches.get(key).push(h);
 }
 const ordered=[...batches.entries()].sort((a,b)=>new Date(b[1][0].time)-new Date(a[1][0].time));
 const visible=ordered.slice(0,historyLimit[target]);
 const days=new Map();
 for(const [key,batch] of visible){const day=localDate(batch[0].time);if(!days.has(day))days.set(day,[]);days.get(day).push([key,batch])}
 for(const [day,entries] of days){
  const group=document.createElement('details');group.className='history-date';group.dataset.day=day;group.open=openDates.has(day);
  const summary=document.createElement('summary');const dayName=document.createElement('span');dayName.textContent=day;
  const count=document.createElement('span');count.className='history-count';count.textContent=`${entries.length} 筆`;
  summary.append(dayName,count);group.append(summary);
  const body=document.createElement('div');body.className='date-body';
  for(const [key,batch] of entries){
   const first=batch[0];const card=document.createElement('details');card.className='history-batch';card.dataset.batch=key;card.open=openBatches.has(key);
   const head=document.createElement('summary');const title=document.createElement('div');title.textContent=`${localTime(first.time)}　${first.person||'未填姓名'}　${labels[first.type]||first.type}`;
   const sub=document.createElement('div');sub.className='history-meta';sub.textContent=`${first.store} · ${batch.length} 項物品`;
   head.append(title,sub);card.append(head);
   const scroll=document.createElement('div');scroll.className='scroll';const table=document.createElement('table');const thead=document.createElement('thead');const tr=document.createElement('tr');
   for(const label of (target==='audit-history'?['物品','應有數量','調整前','調整後','良品前→後','損壞或舊品前→後','剩餘前→後','未歸還']:['物品','數量','調整前','調整後'])){const th=document.createElement('th');th.textContent=label;tr.append(th)}
   thead.append(tr);table.append(thead);const tbody=document.createElement('tbody');
   for(const h of batch)row(tbody,target==='audit-history'?[h.item,h.quantity,h.before??'—',h.after??'—',`${h.beforeGood??'—'} → ${h.afterGood??'—'}`,`${h.beforeBad??'—'} → ${h.afterBad??'—'}`,`${h.beforeRemaining??'—'} → ${h.afterRemaining??'—'}`,h.outstanding??'—']:[h.item,h.quantity,h.before??'—',h.after??'—']);
   table.append(tbody);scroll.append(table);card.append(scroll);body.append(card);
  }
  group.append(body);host.append(group);
 }
 if(ordered.length>visible.length){
  const footer=document.createElement('div');footer.className='history-more-wrap';
  const more=document.createElement('button');more.type='button';more.className='secondary history-more';more.textContent=`查看更多（尚有 ${ordered.length-visible.length} 筆）`;
  more.onclick=()=>{historyLimit[target]+=10;renderHistoryType(target,records)};
  footer.append(more);host.append(footer);
 }else{
  const footer=document.createElement('p');footer.className='history-end';footer.textContent=`共 ${ordered.length} 筆紀錄`;
  host.append(footer);
 }
}
async function load(){if(data)draw();else $('status').textContent='等待雲端資料…'}$('open-audit').onclick=()=>{if(!data)return;const d=$('audit-dialog');$('audit-store').textContent='盤點門市：'+store;$('audit-message').textContent='';const list=$('audit-items');list.replaceChildren();data.items.forEach(item=>{
 const st=item.stores[store], before=st.expected, cond=condition(st);
 const card=document.createElement('div');card.className='audit-item';card.dataset.name=item.name;card.dataset.before=before??'';
 const name=document.createElement('span');name.textContent=item.name;const hint=document.createElement('small');hint.textContent=`目前應有 ${before??'未設定'}｜剩餘 ${st.remaining}｜未歸還 ${outstandingFromHistory(data,store,item.name)}`;name.append(hint);
 const fields=document.createElement('div');fields.className='condition-inputs';
 function field(label,value,kind){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.required=true;input.value=value??'';input.dataset.kind=kind;wrap.append(input);fields.append(wrap);return input}
 const total=field('應有總數',before,'expected'),good=field('良品',cond.good,'good'),bad=field('損壞或舊品',cond.bad,'bad');
 total.addEventListener('input',()=>{const n=Number(total.value),b=Number(bad.value);if(total.value!==''&&validNumber(n)&&validNumber(b)&&n>=b)good.value=String(n-b)});
 for(const el of [total,good,bad])el.addEventListener('input',()=>{const valid=total.value!==''&&good.value!==''&&bad.value!==''&&Number(good.value)+Number(bad.value)===Number(total.value);card.classList.toggle('changed',total.value!==String(before??'')||good.value!==String(cond.good??'')||bad.value!==String(cond.bad));card.classList.toggle('invalid-condition',!valid)});
 card.append(name,fields);list.append(card)
 });d.showModal()};
$('close-audit').onclick=()=>$('audit-dialog').close();$('open-people').onclick=()=>{$('settings-dropdown').classList.add('hidden');$('settings-toggle').setAttribute('aria-expanded','false');$('people-list').value=(data.people||[]).join('\n');$('people-message').textContent='';$('people-dialog').showModal()};$('close-people').onclick=()=>$('people-dialog').close();$('people-form').addEventListener('submit',async e=>{e.preventDefault();const people=$('people-list').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(new Set(people).size!==people.length){$('people-message').textContent='人員姓名不可重複';return}const btn=$('people-submit');btn.disabled=true;try{const r=await apiFetch('/api/personnel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({people})});const out=await r.json();if(!r.ok)throw Error(out.error||'儲存失敗');$('people-dialog').close();await load()}catch(err){$('people-message').textContent=err.message}finally{btn.disabled=false}});
$('audit-form').addEventListener('submit',async e=>{e.preventDefault();
 const cards=[...$('audit-items').querySelectorAll('.audit-item')];
 const items=cards.map(c=>({name:c.dataset.name,quantity:Number(c.querySelector('[data-kind=expected]').value),good:Number(c.querySelector('[data-kind=good]').value),bad:Number(c.querySelector('[data-kind=bad]').value)}));
 if(cards.some(c=>[...c.querySelectorAll('input')].some(x=>x.value===''||!validNumber(Number(x.value))))||items.some(i=>i.good+i.bad!==i.quantity)){$('audit-message').textContent='請填寫正確數量，且每項「良品＋損壞或舊品」必須等於「應有總數」';return}
 const person=$('audit-person').value.trim();if(!person){$('audit-message').textContent='請選擇盤點人姓名';return}
 const changed=items.filter(i=>{const st=data.items.find(x=>x.name===i.name).stores[store],c=condition(st);return i.quantity!==st.expected||i.good!==c.good||i.bad!==c.bad});
 const conflicts=items.filter(i=>outstandingFromHistory(data,store,i.name)>i.quantity);if(conflicts.length){$('audit-message').textContent='未歸還數量超過應有總數，請先核對：'+conflicts.map(i=>i.name).join('、');return;}
 if(!confirm(`確認 ${person} 盤點 ${store} 全部 ${items.length} 項物品？\n其中 ${changed.length} 項應有數量或好壞狀態有異動。\n系統會依照歷史取用與歸還紀錄，重新計算每項剩餘數量＝應有總數－未歸還數量。\n盤點後會留下完整紀錄。`))return;
 const btn=$('audit-submit');btn.disabled=true;
 try{const r=await apiFetch('/api/audit',{method:'POST',body:JSON.stringify({person,store,items})});const result=await r.json();if(!r.ok)throw Error(result.error||'盤點失敗');$('audit-dialog').close();msg('盤點完成，已更新應有總數、良品／損壞或舊品，並扣除未歸還數量重新計算剩餘數量',true);await load()}catch(err){$('audit-message').textContent=err.message}finally{btn.disabled=false}
});
$('store').addEventListener('change',e=>{store=e.target.value;draw()});$('refresh').onclick=load;function setMode(value){mode=value;$('mode-take').classList.toggle('active',mode==='take');$('mode-return').classList.toggle('active',mode==='restock');$('mode-take').setAttribute('aria-pressed',String(mode==='take'));$('mode-return').setAttribute('aria-pressed',String(mode==='restock'));$('hint').textContent=mode==='take'?'取用後會扣除該門市庫存':'歸還後會增加該門市庫存'}$('mode-take').onclick=()=>setMode('take');$('mode-return').onclick=()=>setMode('restock');function updateSelected(){const cards=[...document.querySelectorAll('.item-choice')];let count=0;cards.forEach(el=>{const c=el.querySelector('[type=checkbox]'),q=el.querySelector('[type=number]');q.disabled=!c.checked;el.classList.toggle('selected',c.checked);if(c.checked)count++});$('selected-count').textContent=`已選 ${count} 項物品`;$('toggle-all').textContent=count===cards.length?'取消全選':'全選'}
function renderChoices(selections={}){const list=$('item-list');list.replaceChildren();data.items.forEach(item=>{const stock=item.stores[store];const card=document.createElement('div');card.className='item-choice';card.dataset.name=item.name;const check=document.createElement('input');check.type='checkbox';check.checked=!!selections[item.name]?.checked;check.setAttribute('aria-label','選擇 '+item.name);const name=document.createElement('div');name.className='item-name';name.textContent=item.name;const small=document.createElement('small');small.textContent=`可借用 ${availableGood(stock,outstandingFromHistory(data,store,item.name))}`;name.append(small);const qty=document.createElement('input');qty.type='number';qty.min='1';qty.step='1';qty.placeholder='數量';qty.value=selections[item.name]?.quantity??'';qty.setAttribute('aria-label',item.name+'數量');check.onchange=updateSelected;qty.onfocus=()=>{if(!check.checked){check.checked=true;updateSelected()}};card.append(check,name,qty);list.append(card)});updateSelected()}
$('toggle-all').onclick=()=>{const cards=[...document.querySelectorAll('.item-choice')];const all=cards.every(c=>c.querySelector('[type=checkbox]').checked);cards.forEach(c=>c.querySelector('[type=checkbox]').checked=!all);updateSelected()};
$('form').addEventListener('submit',async e=>{e.preventDefault();const items=[...document.querySelectorAll('.item-choice')].filter(el=>el.querySelector('[type=checkbox]').checked).map(el=>({name:el.dataset.name,quantity:Number(el.querySelector('[type=number]').value),raw:el.querySelector('[type=number]').value}));const p={store,person:$('person').value.trim(),type:mode,items:items.map(({name,quantity})=>({name,quantity}))};if(!items.length){msg('請至少選擇一項物品',false);return}if(items.some(i=>i.raw===''||!Number.isSafeInteger(i.quantity)||i.quantity<0||(p.type!=='set'&&i.quantity===0))){msg('請為每個已選物品輸入正確的整數數量',false);return}if(!p.person){msg('請選擇夥伴姓名',false);return}
if(p.type==='take'){
 const insufficient=items.filter(x=>{const st=data.items.find(i=>i.name===x.name)?.stores?.[store];return st&&x.quantity>condition(st).borrowable});
 if(insufficient.length){msg('可借用庫存不足：'+insufficient.map(x=>x.name).join('、'),false);return}
}
if(p.type==='restock'){
 const excess=items.flatMap(x=>{const stock=data.items.find(i=>i.name===x.name)?.stores?.[store];if(!stock||!Number.isSafeInteger(stock.expected)||stock.expected<0)return [];const after=stock.remaining+x.quantity;return after>stock.expected?[`${x.name}：目前 ${stock.remaining} + 歸還 ${x.quantity} = ${after}（應有 ${stock.expected}，超出 ${after-stock.expected}）`]:[]});
 if(excess.length){
  if(!confirm('以下物品歸還後將超過該門市應有數量：\n\n'+excess.join('\n')+'\n\n確定仍要歸還這些數量嗎？'))return;
  if(!confirm('再次確認：超量歸還後，請到「盤點庫存」將實際庫存修正為正確數量。\n\n確定繼續？'))return;
  p.confirmOverLimit=true;
 }
}if(!confirm(`確認由 ${p.person} 在 ${p.store} ${labels[p.type]}以下物品？\n`+items.map(i=>`${i.name}：${i.quantity}`).join('\n')))return;$('submit').disabled=true;try{let r=await apiFetch('/api/transactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}),result=await r.json();if(!r.ok)throw Error(result.error||'操作失敗');msg(`成功登記 ${items.length} 項物品，庫存已更新`+(p.confirmOverLimit?'。本次歸還超過應有數量，請到「盤點庫存」更新應有數量。':''),true);document.querySelectorAll('.item-choice').forEach(el=>{el.querySelector('[type=checkbox]').checked=false;el.querySelector('[type=number]').value=''});await load()}catch(err){msg(err.message,false);await load()}finally{$('submit').disabled=false}});
function msg(t,ok){$('message').textContent=t;$('message').className='message '+(ok?'ok':'err')}/* Firebase onValue handles realtime refresh; initialized after login. */

// 公開讀寫版本：不需要帳號登入，所有訪客均可操作。
unsubscribe=onValue(root,snapshot=>{
 const value=snapshot.val();
 if(!value){$('status').textContent='尚未匯入庫存初始資料';return}
 try {
  if(!Array.isArray(value.stores)||!Array.isArray(value.items))throw Error('資料結構不完整，inventory 需要 stores 和 items 陣列');
  const needsRepair=repairStoreKeys(value);
  if(needsRepair){
   $('status').textContent='偵測到門市更名，正在同步修復庫存…';
   runTransaction(root,current=>{if(!current)return;repairStoreKeys(current);return current},{applyLocally:false}).catch(e=>{$('status').textContent='門市名稱修復失敗：'+e.message});
  }
  value.history=Array.isArray(value.history)?value.history:[];
  value.people=Array.isArray(value.people)?value.people:[];
  data=value;draw();
 } catch(e) { $('status').textContent='資料處理失敗：'+e.message;console.error('資料處理失敗',e); }
},err=>{$('status').textContent='Firebase 讀取失敗：'+(err.code||err.message||'請檢查網路及規則');console.error('Firebase 讀取失敗',err)});


// 門市編輯：每次儲存都透過 Firebase transaction 原子性更名或封存刪除。
function renderStoreEditor(){
 const sel=$('edit-store');if(!sel)return;
 const old=sel.value;sel.replaceChildren(...data.stores.map(n=>new Option(n,n)));
 sel.value=data.stores.includes(old)?old:(data.stores.includes(store)?store:data.stores[0]);
}
$('open-stores').onclick=()=>{$('settings-dropdown').classList.add('hidden');$('settings-toggle').setAttribute('aria-expanded','false');if(!data)return;renderStoreEditor();$('store-edit-message').textContent='';$('new-store-name').value='';$('store-dialog').showModal()};
$('close-stores').onclick=()=>$('store-dialog').close();
$('add-store').onclick=async()=>{
 const newName=$('add-store-name').value.trim();
 if(!newName){$('store-edit-message').textContent='請輸入要新增的門市名稱';return}
 if(!confirm(`確定新增「${newName}」門市？\n所有物品的應有數量及剩餘數量將從 0 開始，可再進入盤點庫存設定應有數量。`))return;
 const btn=$('add-store');btn.disabled=true;
 try{const r=await apiFetch('/api/stores',{method:'POST',body:JSON.stringify({action:'add',newName})});const v=await r.json();if(!r.ok)throw Error(v.error||'新增門市失敗');store=newName;$('store-dialog').close();msg('已新增門市，請使用盤點庫存設定應有數量',true);$('add-store-name').value=''}catch(e){$('store-edit-message').textContent=e.message}finally{btn.disabled=false}
};

$('rename-store').onclick=async()=>{
 const oldName=$('edit-store').value,newName=$('new-store-name').value.trim();
 if(!newName){$('store-edit-message').textContent='請輸入新門市名稱';return}
 if(!confirm(`確認將「${oldName}」更名為「${newName}」？\n所有物品庫存與歷史紀錄都會一起更名。`))return;
 const btn=$('rename-store');btn.disabled=true;
 try{const r=await apiFetch('/api/stores',{method:'POST',body:JSON.stringify({action:'rename',oldName,newName})});const v=await r.json();if(!r.ok)throw Error(v.error||'更名失敗');store=newName;$('store-dialog').close();msg('門市已更名，庫存與紀錄完整保留',true)}catch(e){$('store-edit-message').textContent=e.message}finally{btn.disabled=false}
};
$('delete-store').onclick=async()=>{
 const oldName=$('edit-store').value;
 if(!confirm(`第一道確認：確定要刪除「${oldName}」？\n刪除後這間門市不再出現在庫存與操作清單。`))return;
 if(!confirm(`第二道確認：請再次確認刪除「${oldName}」。\n該門市的庫存與紀錄將封存於 Firebase deletedStores，不能從網頁直接還原。`))return;
 const typed=prompt(`第三道確認：請完整輸入門市名稱「${oldName}」`);
 if(typed!==oldName){$('store-edit-message').textContent='門市名稱不一致，已取消刪除';return}
 const phrase=prompt('第四道確認：請輸入「確認永久刪除」');
 if(phrase!=='確認永久刪除'){$('store-edit-message').textContent='確認文字不一致，已取消刪除';return}
 const btn=$('delete-store');btn.disabled=true;
 try{const r=await apiFetch('/api/stores',{method:'POST',body:JSON.stringify({action:'delete',oldName,confirmName:typed,confirmPhrase:phrase})});const v=await r.json();if(!r.ok)throw Error(v.error||'刪除失敗');store='';$('store-dialog').close();msg('門市已移除，原始庫存及紀錄已封存於 Firebase',true)}catch(e){$('store-edit-message').textContent=e.message}finally{btn.disabled=false}
};

// 更多設定：人員及門市編輯收進同一個選單。
$('settings-toggle').addEventListener('click',e=>{
 e.stopPropagation();
 const menu=$('settings-dropdown');const open=menu.classList.toggle('hidden')===false;
 $('settings-toggle').setAttribute('aria-expanded',String(open));
});
document.addEventListener('click',e=>{if(!e.target.closest('.settings-menu')){$('settings-dropdown').classList.add('hidden');$('settings-toggle').setAttribute('aria-expanded','false')}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('settings-dropdown').classList.add('hidden');$('settings-toggle').setAttribute('aria-expanded','false')}});

// 匯出目前選取門市的完整紀錄，不受畫面每次顯示 10 筆的限制。
function excelSafe(value){
 if(value===null||value===undefined)return '';
 if(typeof value==='number'&&Number.isFinite(value))return value;
 const text=String(value);
 return /^[=+@\-\t\r]/.test(text)?"'"+text:text;
}
function excelTime(value){
 const date=new Date(value);
 return Number.isNaN(date.getTime())?'':date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
}
function exportExcel(){
 if(!data||!store){alert('請等待資料同步完成');return}
 if(!window.XLSX){alert('Excel 匯出套件尚未載入，請確認網路後重新整理');return}
 const X=window.XLSX,wb=X.utils.book_new();
 const inventory=[['門市','物品','應有數量','良品','損壞或舊品','可借用','已取用']];
 for(const item of data.items){
  const stock=item.stores?.[store];if(!stock)continue;
  const available=availableGood(stock,outstandingFromHistory(data,store,item.name));
  inventory.push([store,item.name,stock.expected??'',condition(stock).good??'',condition(stock).bad,available,Number.isSafeInteger(stock.expected)?stock.expected-available:'']);
 }
 const borrow=[['時間','門市','夥伴姓名','操作','物品','數量','操作前可借用','操作後可借用','批次編號']];
 const audits=[['時間','門市','盤點人','物品','應有調整前','應有調整後','良品調整前','良品調整後','損壞或舊品調整前','損壞或舊品調整後','可借用調整前','可借用調整後','未歸還','批次編號']];
 const records=(data.history||[]).filter(h=>h&&h.store===store).sort((a,b)=>new Date(b.time)-new Date(a.time));
 for(const h of records){
  if(h.type==='take'||h.type==='restock')borrow.push([excelTime(h.time),h.store,h.person||'',h.type==='take'?'取用':'歸還',h.item||'',h.quantity??'',h.before??'',h.after??'',h.batchId||'']);
  else if(h.type==='audit'||h.type==='set')audits.push([excelTime(h.time),h.store,h.person||'',h.item||'',h.before??'',h.after??'',h.beforeGood??'',h.afterGood??'',h.beforeBad??'',h.afterBad??'',h.beforeRemaining??'',h.afterRemaining??'',h.outstanding??'',h.batchId||'']);
 }
 for(const [name,rows,widths] of [
  ['門市物品庫存',inventory,[14,18,14,12,18,14,12]],
  ['借用歸還紀錄',borrow,[23,14,16,12,18,12,18,18,40]],
  ['盤點紀錄',audits,[23,14,16,18,18,18,16,16,22,22,20,20,14,40]]
 ]){
  const safeRows=rows.map((r,i)=>i===0?r:r.map(excelSafe));
  const sheet=X.utils.aoa_to_sheet(safeRows);
  sheet['!cols']=widths.map(w=>({wch:w}));
  sheet['!autofilter']={ref:X.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(0,rows.length-1),c:rows[0].length-1}})};
  X.utils.book_append_sheet(wb,sheet,name);
 }
 const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
 const filename=store.replace(/[\\/:*?"<>|]/g,'_')+'_造勢物品管理_'+date+'.xlsx';
 X.writeFile(wb,filename);
}
$('export-excel').addEventListener('click',exportExcel);
