(function(){
  'use strict';
  var TYPES=[{k:'summary',l:'Σύνοψη'},{k:'decision',l:'Απόφαση'},{k:'question',l:'Ερώτημα'},{k:'scenario',l:'Σενάριο'},{k:'idea',l:'Ιδέα'},{k:'theme',l:'Θέμα'},{k:'task',l:'Ενέργεια'},{k:'reference',l:'Αναφορά'},{k:'photo',l:'Φωτογραφίες'}];
  var AREAS=[{k:'plot',l:'Πλοκή & χαρακτήρες'},{k:'form',l:'Μορφή & σκηνοθεσία'},{k:'sound',l:'Μουσική & ήχος'},{k:'meaning',l:'Νόημα & θέματα'},{k:'production',l:'Παραγωγή & πρόγραμμα'},{k:'team',l:'Ομάδα'}];
  var STATUSES=[{k:'open',l:'Ανοιχτό'},{k:'leaning',l:'Κλίση'},{k:'decided',l:'Αποφασίστηκε'},{k:'parked',l:'Παρκαρισμένο'},{k:'done',l:'Ολοκληρώθηκε'}];
  var TYPE_L={},AREA_L={},STATUS_L={},TYPE_RANK={};
  TYPES.forEach(function(t,i){TYPE_L[t.k]=t.l;TYPE_RANK[t.k]=i;});
  AREAS.forEach(function(a){AREA_L[a.k]=a.l;});
  STATUSES.forEach(function(s){STATUS_L[s.k]=s.l;});
  function hasStatus(type){return type!=='reference'&&type!=='summary'&&type!=='photo';}
  function statusesFor(type){return type==='task'?['open','done','parked']:['open','leaning','decided','parked'];}

  var $=function(id){return document.getElementById(id);};
  function h(tag,props){
    var el=document.createElement(tag);
    if(props)Object.keys(props).forEach(function(k){
      var v=props[k]; if(v==null||v===false)return;
      if(k==='class')el.className=v; else if(k==='text')el.textContent=v; else if(k==='style')el.style.cssText=v;
      else if(k.indexOf('on')===0)el.addEventListener(k.slice(2),v); else el.setAttribute(k,v===true?'':v);
    });
    for(var i=2;i<arguments.length;i++){[].concat(arguments[i]).forEach(function(c){if(c==null||c===false)return;el.append(c.nodeType?c:document.createTextNode(c));});}
    return el;
  }
  function norm(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/ς/g,'σ');}
  function todayISO(){try{return new Date().toLocaleDateString('sv-SE');}catch(e){return new Date().toISOString().slice(0,10);}}
  function fmtDate(iso){try{return new Date(iso+'T12:00:00').toLocaleDateString('el-GR',{day:'numeric',month:'short',year:'numeric'});}catch(e){return iso;}}
  function fmtDT(iso){try{return new Date(iso).toLocaleString('el-GR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}catch(e){return '';}}

  var sb=null, myId='', myEmail='', started=false;
  var entries=[], comments=[], profiles={}, cText={}, loaded=false;
  var expanded={}, openComments={}, drafts={}, composerTags=[], editingId=null, confirmId=null, showAllTags=false;
  var F={q:'',type:null,area:null,status:null,session:null,tag:null,mine:null};

  function show(view){['authView','noAccessView','configView','appView'].forEach(function(v){$(v).hidden=(v!==view);});}
  function nameOf(id){var p=profiles[id];return (p&&p.name)||'Κάποιος';}
  function myName(){return (profiles[myId]&&profiles[myId].name)||'';}

  /* ---------- data ---------- */
  function prep(r){
    var e={id:r.id,type:r.type||'idea',area:r.area||'meaning',status:r.status||'',title:r.title||'',body:r.body||'',
      tags:r.tags||[],mentions:r.mentions||[],images:r.images||[],authorId:r.author_id||'',session:r.meeting_date||'',check:!!r.needs_check,by:r.by_name||'',ord:Number(r.ord)||0};
    e.hay=norm([e.title,e.body,e.tags.join(' '),TYPE_L[e.type],AREA_L[e.area],STATUS_L[e.status]].join(' '));
    return e;
  }
  async function loadAll(){
    var rs=await Promise.all([sb.from('entries').select('*').limit(5000),sb.from('comments').select('*').order('created_at').limit(5000),sb.from('profiles').select('id,name,email')]);
    var bad=rs.filter(function(r){return r.error;})[0];
    if(bad){var el=$('statusline');el.className='statusline warn';el.textContent='Δεν ήταν δυνατή η φόρτωση: '+bad.error.message;return;}
    entries=rs[0].data.filter(function(r){return r.type!=='ai';}).map(prep);
    comments=rs[1].data.map(function(c){return {id:c.id,entryId:c.entry_id,text:c.body,mentions:c.mentions||[],authorId:c.author_id,createdAt:c.created_at};});
    profiles={}; rs[2].data.forEach(function(p){profiles[p.id]=p;});
    cText={}; comments.forEach(function(c){cText[c.entryId]=(cText[c.entryId]||'')+' '+norm(c.text);});
    loaded=true; render(); signThumbs();
  }
  var reloadT;
  function scheduleReload(){clearTimeout(reloadT);reloadT=setTimeout(loadAll,300);}

  /* ---------- photos ---------- */
  var BUCKET='photos', urlC={}, pending=[], kept=[], gone=[], upl=[], lb=null, lbList=[], lbI=0;
  function thumbPath(p){return p.replace(/\.jpg$/,'_t.jpg');}
  async function signPaths(paths){
    var need=paths.filter(function(p){var c=urlC[p];return !c||c.exp<Date.now()+60000;});
    if(!need.length)return;
    var r=await sb.storage.from(BUCKET).createSignedUrls(need,3600);
    if(r.error||!r.data)return;
    r.data.forEach(function(d){if(d.signedUrl&&d.path)urlC[d.path]={url:d.signedUrl,exp:Date.now()+3500000};});
  }
  async function signThumbs(){
    var ps=[]; entries.forEach(function(e){e.images.forEach(function(p){ps.push(thumbPath(p));});});
    if(!ps.length)return;
    await signPaths(ps); renderList();
  }
  function viaImg(file){return new Promise(function(res,rej){var u=URL.createObjectURL(file),i=new Image();i.onload=function(){URL.revokeObjectURL(u);res(i);};i.onerror=function(){URL.revokeObjectURL(u);rej(new Error('Δεν διαβάζεται η εικόνα '+file.name));};i.src=u;});}
  function loadBitmap(file){
    if(window.createImageBitmap)return createImageBitmap(file,{imageOrientation:'from-image'}).catch(function(){return viaImg(file);});
    return viaImg(file);
  }
  function scaled(img,max,q){
    var w=img.width||img.naturalWidth,hh=img.height||img.naturalHeight,k=Math.min(1,max/Math.max(w,hh));
    var c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w*k)); c.height=Math.max(1,Math.round(hh*k));
    var x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
    return new Promise(function(res,rej){c.toBlob(function(b){b?res(b):rej(new Error('Αποτυχία μετατροπής της εικόνας'));},'image/jpeg',q);});
  }
  async function uploadPhotos(entryId){
    var out=[];
    for(var i=0;i<pending.length;i++){
      var img=await loadBitmap(pending[i]);
      var big=await scaled(img,1600,0.82), small=await scaled(img,480,0.78);
      var base=myId+'/'+entryId+'/'+Date.now().toString(36)+i;
      var a=await sb.storage.from(BUCKET).upload(base+'.jpg',big,{contentType:'image/jpeg'});
      if(a.error)throw a.error; upl.push(base+'.jpg');
      var b=await sb.storage.from(BUCKET).upload(base+'_t.jpg',small,{contentType:'image/jpeg'});
      if(b.error)throw b.error; upl.push(base+'_t.jpg');
      out.push(base+'.jpg');
    }
    return out;
  }
  function pv(src,onrm){
    return h('div',{class:'pv'},src?h('img',{src:src,alt:''}):h('span',{class:'ph'}),h('button',{type:'button',class:'rm','aria-label':'Αφαίρεση φωτογραφίας',text:'×',onclick:onrm}));
  }
  function drawPreviews(){
    var box=$('f-previews'); box.textContent='';
    kept.forEach(function(p,i){var c=urlC[thumbPath(p)];box.append(pv(c&&c.url,function(){gone.push(kept.splice(i,1)[0]);drawPreviews();}));});
    pending.forEach(function(f,i){box.append(pv(URL.createObjectURL(f),function(){pending.splice(i,1);drawPreviews();}));});
  }
  function closeLB(){if(lb){lb.remove();lb=null;document.removeEventListener('keydown',lbKey);}}
  function lbKey(ev){if(ev.key==='Escape')closeLB();else if(ev.key==='ArrowRight')lbGo(1);else if(ev.key==='ArrowLeft')lbGo(-1);}
  async function showLB(){
    var p=lbList[lbI]; await signPaths([p]); if(!lb)return;
    var c=urlC[p]; lb.querySelector('img').src=c?c.url:''; lb.querySelector('.cnt').textContent=(lbI+1)+' / '+lbList.length;
  }
  function lbGo(d){if(!lb||lbList.length<2)return;lbI=(lbI+d+lbList.length)%lbList.length;showLB();}
  function openLB(id,i){
    var e=entries.filter(function(x){return x.id===id;})[0]; if(!e||!e.images.length)return;
    closeLB(); lbList=e.images; lbI=Math.min(i||0,lbList.length-1);
    var multi=lbList.length>1;
    lb=h('div',{class:'lightbox',role:'dialog','aria-label':'Φωτογραφία',onclick:function(ev){if(ev.target===lb||ev.target.dataset.x)closeLB();}},
      h('img',{alt:e.title}),
      h('div',{class:'lbbar'},h('span',{class:'cnt'}),
        multi?h('button',{type:'button',class:'lbbtn','aria-label':'Προηγούμενη',text:'‹',onclick:function(){lbGo(-1);}}):null,
        multi?h('button',{type:'button',class:'lbbtn','aria-label':'Επόμενη',text:'›',onclick:function(){lbGo(1);}}):null,
        h('button',{type:'button',class:'lbbtn','aria-label':'Κλείσιμο',text:'×','data-x':'1'})));
    document.body.append(lb); document.addEventListener('keydown',lbKey); showLB();
  }

  /* ---------- filtering ---------- */
  function commentsFor(id){return comments.filter(function(c){return c.entryId===id;});}
  function mentionsMe(e){
    if(!myId)return false;
    if(e.mentions.indexOf(myId)>=0)return true;
    return comments.some(function(c){return c.entryId===e.id&&c.mentions.indexOf(myId)>=0;});
  }
  function sessions(){
    var s={}; entries.forEach(function(e){if(e.session)s[e.session]=1;});
    return Object.keys(s).sort().map(function(d,i){return {k:d,l:'Συνάντηση '+(i+1)+' · '+fmtDate(d)};});
  }
  function match(e,skip){
    if(F.q){var terms=norm(F.q).split(/\s+/).filter(Boolean);for(var i=0;i<terms.length;i++){if((e.hay+' '+(cText[e.id]||'')).indexOf(terms[i])<0)return false;}}
    if(skip!=='type'&&F.type&&e.type!==F.type)return false;
    if(skip!=='area'&&F.area&&e.area!==F.area)return false;
    if(skip!=='status'&&F.status&&e.status!==F.status)return false;
    if(skip!=='session'&&F.session&&e.session!==F.session)return false;
    if(skip!=='tag'&&F.tag&&e.tags.indexOf(F.tag)<0)return false;
    if(skip!=='mine'&&F.mine&&!mentionsMe(e))return false;
    return true;
  }
  function count(facet,val){var n=0;entries.forEach(function(e){if(match(e,facet)){if(facet==='tag'?e.tags.indexOf(val)>=0:e[facet]===val)n++;}});return n;}
  function sorted(list){
    return list.slice().sort(function(a,b){
      if(a.session!==b.session)return a.session<b.session?1:-1;
      var ra=TYPE_RANK[a.type]==null?99:TYPE_RANK[a.type], rb=TYPE_RANK[b.type]==null?99:TYPE_RANK[b.type];
      if(ra!==rb)return ra-rb;
      return a.ord-b.ord;
    });
  }
  function activeCount(){return ['type','area','status','session','tag','mine'].filter(function(k){return F[k];}).length+(F.q?1:0);}

  /* ---------- render ---------- */
  function renderHeader(){
    var ss=sessions();
    if(loaded&&entries.length)$('lede').textContent=entries.length+' καταχωρήσεις από '+ss.length+(ss.length===1?' συνάντηση':' συναντήσεις')+'. Οι αλλαγές εμφανίζονται σε όλους.';
    var bar=$('gelbar'); bar.textContent='';
    TYPES.forEach(function(t){var n=entries.filter(function(e){return e.type===t.k;}).length;if(n)bar.append(h('span',{style:'--gel:var(--gel-'+t.k+');flex-grow:'+n,title:t.l+': '+n}));});
  }
  function optBtn(facet,val,label,n,gel){
    var pressed=F[facet]===val;
    return h('button',{type:'button',class:'opt'+(n===0&&!pressed?' zero':''),'aria-pressed':pressed?'true':'false','data-facet':facet,'data-val':val},
      h('span',{class:'lab',style:gel?'--gel:var(--gel-'+gel+')':null},gel?h('i',{class:'sw'}):null,h('span',{text:label})),
      h('span',{class:'n',text:String(n)}));
  }
  function group(title,kids){return h('div',{class:'group'},h('h2',{text:title}),kids);}
  function renderRail(){
    var body=$('railBody'); body.textContent='';
    var mn=entries.filter(function(e){return match(e,'mine')&&mentionsMe(e);}).length;
    body.append(group('Για μένα',h('div',{class:'opts'},optBtn('mine','yes','Όπου με έχουν tag',mn))));
    body.append(group('Είδος',h('div',{class:'opts'},TYPES.map(function(t){return optBtn('type',t.k,t.l,count('type',t.k),t.k);}))));
    body.append(group('Τομέας',h('div',{class:'opts'},AREAS.map(function(a){return optBtn('area',a.k,a.l,count('area',a.k));}))));
    body.append(group('Κατάσταση',h('div',{class:'opts'},STATUSES.map(function(s){return optBtn('status',s.k,s.l,count('status',s.k));}))));
    var ss=sessions();
    if(ss.length)body.append(group('Συνάντηση',h('div',{class:'opts'},ss.slice().reverse().map(function(s){return optBtn('session',s.k,s.l,count('session',s.k));}))));
    var tm={}; entries.forEach(function(e){if(match(e,'tag'))e.tags.forEach(function(t){tm[t]=(tm[t]||0)+1;});});
    if(F.tag&&!tm[F.tag])tm[F.tag]=0;
    var tl=Object.keys(tm).sort(function(a,b){return tm[b]-tm[a]||a.localeCompare(b,'el');});
    if(tl.length){
      var shown=showAllTags?tl:tl.slice(0,16);
      var wrap=h('div',null,h('div',{class:'chips'},shown.map(function(t){return h('button',{type:'button',class:'chip','aria-pressed':F.tag===t?'true':'false','data-facet':'tag','data-val':t,text:t+' '+tm[t]});})));
      if(tl.length>16)wrap.append(h('p',{style:'margin:10px 0 0'},h('button',{type:'button',class:'textbtn',id:'moreTags',text:showAllTags?'Λιγότερες ετικέτες':'Όλες οι ετικέτες ('+tl.length+')'})));
      body.append(group('Ετικέτες',wrap));
    }
    var n=activeCount();
    if(n)body.append(h('button',{type:'button',class:'textbtn',id:'clearBtn',text:'Καθαρισμός φίλτρων'}));
    $('railSummary').textContent=n?'Φίλτρα ('+n+' ενεργά)':'Φίλτρα';
  }
  function chipEl(id){return h('span',{class:'mention'+(id===myId?' me':'')},'@'+nameOf(id));}
  function entryEl(e){
    var long=e.body.length>260, open=!!expanded[e.id];
    var meta=h('div',{class:'meta'},
      h('span',{class:'kind',style:'--gel:var(--gel-'+e.type+')'},h('i'),TYPE_L[e.type]||e.type),
      h('span',{text:AREA_L[e.area]||e.area}),
      e.status&&hasStatus(e.type)?h('span',{class:'st '+e.status,text:STATUS_L[e.status]||e.status}):null,
      e.check?h('span',{class:'chk',title:'Η ανάλυση προέρχεται από αυτόματη μεταγραφή και χρειάζεται έλεγχο',text:'προς έλεγχο'}):null);
    var body=h('p',{class:'body'+(long&&!open?' clamp':''),text:e.body});
    var more=long?h('button',{type:'button',class:'textbtn',style:'justify-self:start','data-act':'more','data-id':e.id,text:open?'Λιγότερα':'Περισσότερα'}):null;
    var tags=h('div',{class:'tags'},e.tags.map(function(t){return h('button',{type:'button',class:'tag'+(F.tag===t?' on':''),'data-facet':'tag','data-val':t,text:'#'+t});}),e.mentions.map(chipEl));
    var who=e.by||(e.authorId?nameOf(e.authorId):'');
    var foot=h('div',{class:'foot'},tags,h('span',{class:'sp'}),h('span',{text:(e.session?fmtDate(e.session):'')+(who?' · '+who:'')}));
    if(hasStatus(e.type)){
      var sel=h('select',{class:'mini','aria-label':'Κατάσταση','data-act':'status','data-id':e.id});
      var keys=statusesFor(e.type); if(e.status&&keys.indexOf(e.status)<0)keys.push(e.status);
      keys.forEach(function(s){var o=h('option',{value:s,text:STATUS_L[s]||s});if(s===e.status)o.selected=true;sel.append(o);});
      foot.append(sel);
    }
    if(confirmId===e.id){
      foot.append(h('span',{class:'confirm'},'Διαγραφή της καταχώρησης;',
        h('button',{type:'button',class:'dangerbtn','data-act':'delyes','data-id':e.id,text:'Ναι, διαγραφή'}),
        h('button',{type:'button',class:'textbtn muted','data-act':'delno','data-id':e.id,text:'Άκυρο'})));
    }else{
      foot.append(h('button',{type:'button',class:'textbtn muted','data-act':'edit','data-id':e.id,text:'Επεξεργασία'}),
        h('button',{type:'button',class:'textbtn muted','data-act':'del','data-id':e.id,text:'Διαγραφή'}));
    }
    var cs=commentsFor(e.id), openC=!!openComments[e.id];
    var gal=e.images.length?h('div',{class:'gallery'},e.images.map(function(p,i){var c=urlC[thumbPath(p)];return h('button',{type:'button',class:'ph','data-act':'photo','data-id':e.id,'data-i':String(i),'aria-label':'Άνοιγμα φωτογραφίας '+(i+1)},c?h('img',{src:c.url,alt:e.title+' ('+(i+1)+')',loading:'lazy'}):null);})):null;
    foot.append(h('button',{type:'button',class:'textbtn','data-act':'comments','data-id':e.id,text:(openC?'Κλείσιμο σχολίων':'Σχόλια')+(cs.length?' ('+cs.length+')':'')}));
    return h('li',{class:'entry','data-entry':e.id},meta,h('h3',{text:e.title}),body,more,gal,foot,openC?threadEl(e,cs):null);
  }
  function threadEl(e,cs){
    var t=h('div',{class:'thread'});
    if(!cs.length)t.append(h('p',{style:'margin:0;color:var(--muted)',text:'Κανένα σχόλιο ακόμα.'}));
    cs.forEach(function(c){
      var who=h('div',{class:'who'},h('b',{text:nameOf(c.authorId)}),h('span',{text:fmtDT(c.createdAt)}));
      if(c.authorId===myId){
        if(confirmId==='c:'+c.id)who.append(h('button',{type:'button',class:'dangerbtn','data-act':'cdelyes','data-id':c.id,text:'Ναι, διαγραφή'}),h('button',{type:'button',class:'textbtn muted','data-act':'cdelno','data-id':c.id,text:'Άκυρο'}));
        else who.append(h('button',{type:'button',class:'textbtn muted','data-act':'cdel','data-id':c.id,text:'Διαγραφή'}));
      }
      t.append(h('div',{class:'cm'},who,h('p',{text:c.text}),c.mentions.length?h('div',{class:'mentions'},c.mentions.map(chipEl)):null));
    });
    var d=drafts[e.id]||(drafts[e.id]={text:'',tags:[]});
    var ta=h('textarea',{'aria-label':'Νέο σχόλιο',placeholder:'Γράψε ένα σχόλιο',maxlength:'2000','data-draft':e.id});
    ta.value=d.text; ta.addEventListener('input',function(){d.text=ta.value;});
    t.append(h('div',{class:'cform'},ta,tagPicker(d.tags),h('div',null,h('button',{type:'button',class:'btn','data-act':'csend','data-id':e.id,text:'Δημοσίευση σχολίου'}))));
    return t;
  }
  function tagPicker(arr){
    var chips=h('span',{class:'tagrow'});
    var inp=h('input',{type:'text',placeholder:'Tag κάποιον…','aria-label':'Tag μέλους της ομάδας',autocomplete:'off'});
    var menu=h('div',{class:'menu',hidden:true});
    function drawChips(){
      chips.textContent='';
      arr.forEach(function(id,i){chips.append(h('span',{class:'mention'+(id===myId?' me':'')},'@'+nameOf(id),h('button',{type:'button',class:'rm','aria-label':'Αφαίρεση tag',text:'×',onclick:function(){arr.splice(i,1);drawChips();}})));});
    }
    function find(){
      var q=norm(inp.value.trim());
      var hits=Object.keys(profiles).map(function(k){return profiles[k];}).filter(function(p){return arr.indexOf(p.id)<0&&(!q||norm(p.name+' '+(p.email||'')).indexOf(q)>=0);}).slice(0,8);
      menu.textContent='';
      if(!hits.length)menu.append(h('span',{class:'none',text:'Κανένα αποτέλεσμα. Ο άλλος πρέπει να έχει μπει τουλάχιστον μία φορά.'}));
      hits.forEach(function(p){menu.append(h('button',{type:'button',onmousedown:function(ev){ev.preventDefault();},onclick:function(){arr.push(p.id);inp.value='';menu.hidden=true;drawChips();}},p.name||p.email));});
      menu.hidden=false;
    }
    inp.addEventListener('input',find); inp.addEventListener('focus',find);
    inp.addEventListener('blur',function(){setTimeout(function(){menu.hidden=true;},150);});
    drawChips();
    return h('div',{class:'tagrow'},chips,h('div',{class:'tagpick'},inp,menu));
  }
  function renderStatusLine(shown){
    var el=$('statusline'); el.className='statusline';
    el.textContent=loaded?shown+' από '+entries.length+' καταχωρήσεις':'';
  }
  function renderList(){
    var list=$('list');
    var ae=document.activeElement, keep=(ae&&ae.dataset&&ae.dataset.draft)?{id:ae.dataset.draft,pos:ae.selectionStart}:null;
    list.textContent='';
    if(!loaded){list.append(h('li',{class:'note',text:'Φόρτωση καταχωρήσεων…'}));renderStatusLine(0);return;}
    if(!entries.length){list.append(h('li',{class:'note'},h('strong',{text:'Η βάση είναι άδεια.'}),' Πάτα «Νέα καταχώρηση» για να προσθέσεις την πρώτη.'));renderStatusLine(0);return;}
    var rows=sorted(entries.filter(function(e){return match(e);}));
    if(!rows.length)list.append(h('li',{class:'note'},h('strong',{text:'Καμία καταχώρηση δεν ταιριάζει.'}),' Δοκίμασε λιγότερες λέξεις ή καθάρισε τα φίλτρα.'));
    else rows.forEach(function(e){list.append(entryEl(e));});
    renderStatusLine(rows.length);
    if(keep)[].slice.call(list.querySelectorAll('textarea[data-draft]')).forEach(function(t){if(t.dataset.draft===keep.id){t.focus();try{t.setSelectionRange(keep.pos,keep.pos);}catch(x){}}});
  }
  function render(){
    renderHeader();renderRail();renderList();
    $('whoami').textContent='Συνδεδεμένος ως '+(myName()||myEmail);
    if(window.CAL)window.CAL.render();
  }

  var toastT;
  function toast(msg){var t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true;},4500);}
  function fail(err){toast('Η αλλαγή δεν αποθηκεύτηκε: '+((err&&err.message)||'άγνωστο σφάλμα'));}

  /* ---------- composer ---------- */
  function fillSelect(sel,items,val){sel.textContent='';items.forEach(function(i){var o=h('option',{value:i.k,text:i.l});if(i.k===val)o.selected=true;sel.append(o);});}
  function syncStatusSelect(type,val){
    var st=$('f-status'),fld=st.parentNode;
    if(!hasStatus(type)){fld.hidden=true;st.textContent='';return;}
    fld.hidden=false; var keys=statusesFor(type); if(val&&keys.indexOf(val)<0)keys.push(val);
    fillSelect(st,keys.map(function(k){return {k:k,l:STATUS_L[k]};}),val||'open');
  }
  function openForm(e){
    editingId=e?e.id:null;
    $('formTitle').textContent=e?'Επεξεργασία καταχώρησης':'Νέα καταχώρηση';
    $('saveBtn').textContent=e?'Αποθήκευση αλλαγών':'Αποθήκευση';
    fillSelect($('f-type'),TYPES,e?e.type:'idea'); fillSelect($('f-area'),AREAS,e?e.area:'plot');
    syncStatusSelect(e?e.type:'idea',e?e.status:'open');
    $('f-title').value=e?e.title:''; $('f-body').value=e?e.body:''; $('f-tags').value=e?e.tags.join(', '):'';
    $('f-session').value=e&&e.session?e.session:todayISO();
    $('f-check').checked=e?e.check:false;
    $('f-by').value=e?(e.by||''):myName();
    composerTags.length=0; if(e)e.mentions.forEach(function(id){composerTags.push(id);});
    var ps=$('f-people'); ps.textContent=''; ps.append(tagPicker(composerTags));
    pending=[];gone=[];kept=e?e.images.slice():[];$('f-files').value='';drawPreviews();
    if(e&&kept.length)signPaths(kept.map(thumbPath)).then(drawPreviews);
    $('composer').hidden=false; $('newBtn').textContent='Κλείσιμο φόρμας';
    $('composer').scrollIntoView({block:'nearest'}); $('f-title').focus();
  }
  function closeForm(){editingId=null;pending=[];kept=[];gone=[];$('composer').hidden=true;$('newBtn').textContent='Νέα καταχώρηση';}
  async function save(ev){
    ev.preventDefault();
    var title=$('f-title').value.trim();
    if(!title){toast('Γράψε έναν τίτλο.');$('f-title').focus();return;}
    var type=$('f-type').value;
    var row={type:type,area:$('f-area').value,status:hasStatus(type)?$('f-status').value:'',title:title,body:$('f-body').value.trim(),
      tags:$('f-tags').value.split(',').map(function(t){return t.trim();}).filter(Boolean).slice(0,12),
      meeting_date:$('f-session').value||todayISO(),needs_check:$('f-check').checked,by_name:$('f-by').value.trim(),
      mentions:composerTags.slice(),updated_at:new Date().toISOString()};
    $('saveBtn').disabled=true;
    var r, rid=editingId||((window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2));
    var lbl=editingId?'Αποθήκευση αλλαγών':'Αποθήκευση';
    upl=[];
    try{
      if(pending.length)$('saveBtn').textContent='Ανεβάζω φωτογραφίες…';
      var added=pending.length?await uploadPhotos(rid):[];
      row.images=kept.concat(added);
    }catch(err){
      if(upl.length)sb.storage.from(BUCKET).remove(upl);
      $('saveBtn').disabled=false; $('saveBtn').textContent=lbl;
      fail(err);return;
    }
    if(editingId)r=await sb.from('entries').update(row).eq('id',editingId);
    else{row.id=rid;row.ord=Date.now();row.author_id=myId;r=await sb.from('entries').insert(row);}
    $('saveBtn').disabled=false; $('saveBtn').textContent=lbl;
    if(!r.error&&gone.length)sb.storage.from(BUCKET).remove(gone.concat(gone.map(thumbPath)));
    if(r.error&&upl.length)sb.storage.from(BUCKET).remove(upl);
    if(r.error){fail(r.error);return;}
    toast(editingId?'Οι αλλαγές αποθηκεύτηκαν.':'Η καταχώρηση προστέθηκε.');
    closeForm(); loadAll();
  }
  async function sendComment(id){
    var d=drafts[id], text=d&&d.text.trim();
    if(!text){toast('Γράψε κάτι πρώτα.');return;}
    var r=await sb.from('comments').insert({entry_id:id,body:text,mentions:d.tags.slice(),author_id:myId});
    if(r.error){fail(r.error);return;}
    drafts[id]={text:'',tags:[]}; loadAll();
  }

  /* ---------- events ---------- */
  function wire(){
    $('q').addEventListener('input',function(ev){F.q=ev.target.value;renderRail();renderList();});
    $('newBtn').addEventListener('click',function(){if($('composer').hidden)openForm(null);else closeForm();});
    $('cancelBtn').addEventListener('click',closeForm);
    $('form').addEventListener('submit',save);
    $('f-files').addEventListener('change',function(ev){
      var fs=[].slice.call(ev.target.files), room=Math.max(0,12-kept.length-pending.length);
      fs.filter(function(f){return /^image\//.test(f.type)||/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name);}).slice(0,room).forEach(function(f){pending.push(f);});
      if(fs.length>room)toast('Το πολύ 12 φωτογραφίες ανά ποστ.');
      ev.target.value=''; drawPreviews();
    });
    $('f-type').addEventListener('change',function(ev){syncStatusSelect(ev.target.value,'open');});
    $('signOutBtn').addEventListener('click',function(){sb.auth.signOut();});
    $('noAccessOut').addEventListener('click',function(){sb.auth.signOut();});
    $('renameBtn').addEventListener('click',function(){$('renameInput').value=myName();$('renameBox').hidden=false;$('renameBtn').hidden=true;$('renameInput').focus();});
    $('renameSave').addEventListener('click',async function(){
      var n=$('renameInput').value.trim(); if(!n)return;
      var r=await sb.from('profiles').update({name:n}).eq('id',myId);
      if(r.error){fail(r.error);return;}
      $('renameBox').hidden=true;$('renameBtn').hidden=false; loadAll();
    });
    document.addEventListener('click',function(ev){
      var t=ev.target.closest('[data-facet],[data-act],#clearBtn,#moreTags'); if(!t)return;
      if(t.id==='clearBtn'){F={q:'',type:null,area:null,status:null,session:null,tag:null,mine:null};$('q').value='';render();return;}
      if(t.id==='moreTags'){showAllTags=!showAllTags;renderRail();return;}
      if(t.dataset.facet){var f=t.dataset.facet,v=t.dataset.val;F[f]=F[f]===v?null:v;render();return;}
      var act=t.dataset.act,id=t.dataset.id;
      var e=entries.filter(function(x){return x.id===id;})[0];
      if(act==='comments'){openComments[id]=!openComments[id];renderList();}
      else if(act==='csend')sendComment(id);
      else if(act==='cdel'){confirmId='c:'+id;renderList();}
      else if(act==='cdelno'||act==='delno'){confirmId=null;renderList();}
      else if(act==='cdelyes'){confirmId=null;sb.from('comments').delete().eq('id',id).then(function(r){if(r.error)fail(r.error);else{toast('Το σχόλιο διαγράφηκε.');loadAll();}});}
      else if(act==='photo'){openLB(id,Number(t.dataset.i)||0);}
      else if(act==='more'){expanded[id]=!expanded[id];renderList();}
      else if(act==='edit'&&e)openForm(e);
      else if(act==='del'){confirmId=id;renderList();}
      else if(act==='delyes'){confirmId=null;sb.from('entries').delete().eq('id',id).then(function(r){if(r.error)fail(r.error);else{if(e&&e.images.length)sb.storage.from(BUCKET).remove(e.images.concat(e.images.map(thumbPath)));toast('Η καταχώρηση διαγράφηκε.');loadAll();}});}
    });
    document.addEventListener('change',function(ev){
      var t=ev.target;
      if(t.dataset&&t.dataset.act==='status')sb.from('entries').update({status:t.value,updated_at:new Date().toISOString()}).eq('id',t.dataset.id).then(function(r){if(r.error){fail(r.error);}loadAll();});
    });
    var mq=window.matchMedia('(max-width:860px)');
    function syncRail(){$('rail').open=!mq.matches;}
    syncRail(); (mq.addEventListener?mq.addEventListener('change',syncRail):mq.addListener(syncRail));
    $('loginForm').addEventListener('submit',async function(ev){
      ev.preventDefault();
      var email=$('loginEmail').value.trim(), pw=$('loginPw').value; if(!email||!pw)return;
      $('loginBtn').disabled=true; $('loginMsg').textContent='Σύνδεση…';
      var r=await sb.auth.signInWithPassword({email:email,password:pw});
      if(r.error){
        /* πρώτη φορά: δημιουργία λογαριασμού με το ίδιο email και κωδικό */
        var s=await sb.auth.signUp({email:email,password:pw});
        if(s.error){r={error:s.error};}
        else if(!s.data.session){r={error:{message:'Λάθος κωδικός, ή ο λογαριασμός περιμένει επιβεβαίωση email.'}};}
        else r={};
      }
      $('loginBtn').disabled=false;
      $('loginMsg').textContent=r.error?'Δεν έγινε είσοδος: '+r.error.message:'';
    });
  }

  /* ---------- session ---------- */
  async function onSession(session){
    if(!session){started=false;myId='';show('authView');return;}
    if(started&&session.user.id===myId)return;
    myId=session.user.id; myEmail=session.user.email||''; started=true;
    var m=await sb.from('members').select('email').limit(1);
    if(m.error||!m.data||!m.data.length){
      $('noAccessMsg').textContent='Το email '+myEmail+' δεν είναι στη λίστα της ομάδας. Ζήτα από τον διαχειριστή να το προσθέσει.';
      show('noAccessView');return;
    }
    show('appView'); render();
    await loadAll();
    if(window.CAL)window.CAL.start();
    sb.channel('archive').on('postgres_changes',{event:'*',schema:'public'},scheduleReload).subscribe();
  }

  function boot(){
    var cfg=window.APP_CONFIG||{};
    if(!cfg.SUPABASE_URL||/PASTE_/.test(cfg.SUPABASE_URL)||!cfg.SUPABASE_ANON_KEY||/PASTE_/.test(cfg.SUPABASE_ANON_KEY)||!window.supabase){show('configView');return;}
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    window.ARCH={sb:sb,h:h,tagPicker:tagPicker,chipEl:chipEl,nameOf:nameOf,toast:toast,fail:fail,fmtDate:fmtDate,me:function(){return myId;}};
    wire();
    sb.auth.onAuthStateChange(function(ev,session){setTimeout(function(){onSession(session);},0);});
  }
  boot();
})();
