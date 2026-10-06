/* Plain script: no module imports, fetch, server, or network required on file://. */
(()=>{
  'use strict';const p=window.PRODUCTION;const byId=id=>document.getElementById(id);let docs=p.documents,index=0;
  byId('name').textContent=p.name;byId('matter').textContent=p.matter;byId('snapshot').textContent='Snapshot created '+new Date(p.at).toLocaleString();
  for(const t of p.tags){const option=document.createElement('option');option.value=t.id;option.textContent=t.name;byId('tag').append(option)}
  function matches(d,q){if(!q)return true;const tags=p.tags.filter(t=>d.tagIds.includes(t.id)).map(t=>t.name);if([d.displayName,d.description,d.firstBates,d.lastBates,...tags].join(' ').toLowerCase().includes(q))return true;const m=(d.firstBates||'').match(/^(.*?)(\d+)(\D*)$/);if(!m||!q.startsWith(m[1].toLowerCase())||!q.endsWith(m[3].toLowerCase()))return false;const value=q.slice(m[1].length,m[3]?-m[3].length:undefined);return /^\d+$/.test(value)&&value.length===m[2].length&&Number(value)>=d.firstNumber&&Number(value)<=d.lastNumber}
  const viewer=byId('viewer'),divider=byId('divider');let ratio=28,collapsed=false;
  try{const saved=Number(localStorage.getItem('sdf-viewer-index-width'));if(saved>=15&&saved<=90)ratio=saved}catch{}
  function resize(value,save=false){const width=viewer.clientWidth||1200,min=Math.min(220,width*.4)/width*100,max=Math.max(width*.5,width-320)/width*100;const actual=Math.min(max,Math.max(min,value));if(save){ratio=actual;try{localStorage.setItem('sdf-viewer-index-width',String(ratio))}catch{}}viewer.style.gridTemplateColumns=collapsed?'minmax(0,1fr)':`minmax(0,${actual}fr) 8px minmax(0,${100-actual}fr)`;divider.setAttribute('aria-valuemin',String(Math.round(min)));divider.setAttribute('aria-valuemax',String(Math.round(max)));divider.setAttribute('aria-valuenow',String(Math.round(actual)))}
  new ResizeObserver(()=>resize(ratio)).observe(viewer);
  divider.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();divider.setPointerCapture(e.pointerId);viewer.classList.add('resizing')};
  divider.onpointermove=e=>{if(divider.hasPointerCapture(e.pointerId)){const box=viewer.getBoundingClientRect();resize((e.clientX-box.left)/box.width*100,true)}};
  divider.onpointerup=e=>{if(divider.hasPointerCapture(e.pointerId))divider.releasePointerCapture(e.pointerId)};divider.onlostpointercapture=()=>viewer.classList.remove('resizing');
  divider.ondblclick=()=>resize(28,true);divider.onkeydown=e=>{const actual=Number(divider.getAttribute('aria-valuenow'));const next=e.key==='ArrowLeft'?actual-2:e.key==='ArrowRight'?actual+2:e.key==='Home'?0:e.key==='End'?100:undefined;if(next!==undefined){e.preventDefault();resize(next,true)}};
  byId('toggle-index').onclick=()=>{collapsed=!collapsed;byId('index').hidden=collapsed;divider.hidden=collapsed;byId('toggle-index').textContent=collapsed?'Show index':'Hide index';byId('toggle-index').setAttribute('aria-label',collapsed?'Show document index':'Hide document index');resize(ratio)};
  function preview(){const d=docs[index];if(d)byId('preview').src=d.path+(byId('fit').value==='width'?'#view=FitH':'#view=Fit');else byId('preview').removeAttribute('src')}
  byId('fit').onchange=preview;
  byId('totals').textContent=p.documents.length+' documents · '+p.documents.reduce((n,d)=>n+d.pageCount,0)+' pages';
  function render(){
    const target=byId('documents');target.replaceChildren();byId('count').textContent=String(docs.length);
    docs.forEach((d,i)=>{const button=document.createElement('button');button.className='doc'+(i===index?' selected':'');const range=document.createElement('small');range.textContent=d.firstBates+' – '+d.lastBates;const name=document.createElement('strong');name.textContent=d.displayName;const detail=document.createElement('p');detail.textContent=[d.documentDate,d.description].filter(Boolean).join(' · ');const tags=document.createElement('small');tags.textContent=p.tags.filter(t=>d.tagIds.includes(t.id)).map(t=>t.name).join(' · ');button.append(range,name,detail,tags);button.onclick=()=>{index=i;render()};target.append(button)});
    const d=docs[index];byId('previous').disabled=index<=0;byId('next').disabled=index>=docs.length-1;byId('copy').disabled=!d;byId('range').textContent=d?d.firstBates+' – '+d.lastBates:'No matching documents';
    for(const key of ['open','download']){const a=byId(key);if(d){a.href=d.path;a.hidden=false;if(key==='download')a.download=decodeURIComponent(d.path.split('/').pop())}else{a.removeAttribute('href');a.hidden=true}}
    byId('position').textContent=(d?index+1:0)+' / '+docs.length;preview();
  }
  function filter(){const q=byId('search').value.trim().toLowerCase(),tag=byId('tag').value;docs=p.documents.filter(d=>(!tag||d.tagIds.includes(tag))&&matches(d,q));index=0;render()}
  byId('search').oninput=filter;byId('tag').onchange=filter;byId('previous').onclick=()=>{if(index>0){index--;render()}};byId('next').onclick=()=>{if(index<docs.length-1){index++;render()}};
  byId('copy').onclick=async()=>{const d=docs[index];if(!d)return;const text=d.firstBates+' – '+d.lastBates;try{await navigator.clipboard.writeText(text);byId('message').textContent='Bates range copied.'}catch{byId('message').textContent='Select and copy this range: '+text}};
  render();
})();
