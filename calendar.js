(function(){
  'use strict';
  var KINDS=[{k:'rehearsal',l:'Πρόβα',c:'--gel-decision'},{k:'meeting',l:'Συνάντηση',c:'--gel-scenario'},{k:'goal',l:'Στόχος',c:'--gel-idea'},{k:'todo',l:'Εκκρεμότητα',c:'--gel-task'},{k:'deadline',l:'Προθεσμία',c:'--gel-question'},{k:'away',l:'Απουσία',c:'--gel-reference'},{k:'event',l:'Άλλο',c:'--gel-theme'}];
  var KL={},KC={}; KINDS.forEach(function(k){KL[k.k]=k.l;KC[k.k]=k.c;});
  var WD=['Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ','Κυρ'];
  var A=null, sb=null, events=[], loaded=false, started=false, tab='archive';
  var now=new Date(), cur=new Date(now.getFullYear(),now.getMonth(),1);
  var sel='', editing=null, formOpen=false, prefill=null, people=[], confirmId=null, showDone=false;
  var $=function(id){return document.getElementById(id);};
  function pad(n){return n<10?'0'+n:''+n;}
  function iso(y,m,d){return y+'-'+pad(m+1)+'-'+pad(d);}
  function todayISO(){var d=new Date();return iso(d.getFullYear(),d.getMonth(),d.getDate());}
  function goalish(e){return e.kind==='goal'||e.kind==='todo';}
  function endOf(e){return e.ends_on&&e.ends_on>=e.starts_on?e.ends_on:e.starts_on;}
  function onDay(e,d){return !!e.starts_on&&e.starts_on<=d&&d<=endOf(e);}
  function key(e){return (e.starts_on||'9999-99-99')+(e.start_time||'00:00');}
  function cmp(a,b){var x=key(a),y=key(b);return x<y?-1:x>y?1:a.title.localeCompare(b.title,'el');}
  function timeStr(e){return e.start_time?(e.start_time+(e.end_time?'–'+e.end_time:'')):'';}
  function dateStr(e){
    if(!e.starts_on)return 'Χωρίς ημερομηνία';
    var s=A.fmtDate(e.starts_on); if(e.ends_on&&e.ends_on>e.starts_on)s+=' – '+A.fmtDate(e.ends_on);
    var t=timeStr(e); return t?s+' · '+t:s;
  }
  function gel(e){return '--gel:var('+(KC[e.kind]||'--gel-theme')+')';}

  /* ---------- data ---------- */
  async function load(){
    var r=await sb.from('events').select('*').limit(3000);
    var er=$('calErr');
    if(r.error){er.className='statusline warn';er.textContent='Δεν φορτώθηκε το ημερολόγιο: '+r.error.message;return;}
    er.className='statusline';er.textContent='';
    events=r.data.map(function(e){e.mentions=e.mentions||[];e.title=e.title||'';e.notes=e.notes||'';return e;});
    loaded=true; renderMain();
  }
  async function upd(id,patch){
    patch.updated_at=new Date().toISOString();
    var r=await sb.from('events').update(patch).eq('id',id);
    if(r.error)A.fail(r.error); else load();
  }
  async function del(id){
    var r=await sb.from('events').delete().eq('id',id); confirmId=null;
    if(r.error)A.fail(r.error); else{A.toast('Διαγράφηκε.');load();}
  }
  async function save(R){
    var title=R.title.value.trim();
    if(!title){A.toast('Γράψε έναν τίτλο.');R.title.focus();return;}
    var row={kind:R.kind.value,title:title,notes:R.notes.value.trim(),starts_on:R.date.value||null,ends_on:R.end.value||null,
      start_time:R.t1.value||'',end_time:R.t2.value||'',mentions:people.slice(),updated_at:new Date().toISOString()};
    if(!row.starts_on&&row.kind!=='goal'&&row.kind!=='todo'){A.toast('Διάλεξε ημερομηνία.');R.date.focus();return;}
    if(!row.starts_on)row.ends_on=null;
    if(row.ends_on&&row.ends_on<row.starts_on)row.ends_on=row.starts_on;
    var r=editing?await sb.from('events').update(row).eq('id',editing):await sb.from('events').insert(Object.assign(row,{author_id:A.me()}));
    if(r.error){A.fail(r.error);return;}
    A.toast(editing?'Οι αλλαγές αποθηκεύτηκαν.':'Προστέθηκε.');
    if(row.starts_on){sel=row.starts_on;cur=new Date(+sel.slice(0,4),+sel.slice(5,7)-1,1);}
    formOpen=false;editing=null;renderForm();load();
  }

  /* ---------- pieces ---------- */
  function itemEl(e){
    var h=A.h, gish=goalish(e), cs=[];
    var head=h('div',{class:'ci-head'},
      gish?h('input',{type:'checkbox',class:'ci-check','aria-label':'Ολοκληρώθηκε',checked:e.done?true:null,onchange:function(ev){upd(e.id,{done:ev.target.checked});}}):null,
      h('span',{class:'kind',style:gel(e)},h('i'),KL[e.kind]||e.kind),
      h('span',{text:dateStr(e)}));
    var foot=h('div',{class:'ci-foot'},
      e.mentions.length?h('span',{class:'tags'},e.mentions.map(A.chipEl)):null,
      e.author_id?h('span',{text:'από '+A.nameOf(e.author_id)}):null,
      h('span',{class:'sp'}),
      h('button',{type:'button',class:'textbtn muted',text:'Επεξεργασία',onclick:function(){openForm(e);}}));
    if(confirmId===e.id)foot.append(h('span',{class:'confirm'},'Διαγραφή;',
      h('button',{type:'button',class:'dangerbtn',text:'Ναι, διαγραφή',onclick:function(){del(e.id);}}),
      h('button',{type:'button',class:'textbtn muted',text:'Άκυρο',onclick:function(){confirmId=null;renderMain();}})));
    else foot.append(h('button',{type:'button',class:'textbtn muted',text:'Διαγραφή',onclick:function(){confirmId=e.id;renderMain();}}));
    return h('div',{class:'ci'+(gish&&e.done?' done':'')},head,h('h4',{text:e.title}),e.notes?h('p',{text:e.notes}):null,foot);
  }
  function listEl(list,empty){
    var h=A.h;
    if(!list.length)return h('p',{class:'note',text:empty});
    return h('ul',{class:'cal-list'},list.map(function(e){return h('li',null,itemEl(e));}));
  }
  function secEl(title,extra,body){
    var h=A.h;
    return h('section',{class:'cal-sec'},h('div',{class:'cal-sech'},h('h3',{text:title}),extra),body);
  }
  function gridEl(){
    var h=A.h, y=cur.getFullYear(), m=cur.getMonth(), first=(new Date(y,m,1).getDay()+6)%7;
    var rows=Math.ceil((first+new Date(y,m+1,0).getDate())/7), t=todayISO();
    var g=h('div',{class:'cal-grid'});
    WD.forEach(function(d){g.append(h('div',{class:'cal-wd',text:d}));});
    function cell(i){
      var d=new Date(y,m,1-first+i), ds=iso(d.getFullYear(),d.getMonth(),d.getDate());
      var list=events.filter(function(e){return onDay(e,ds);}).sort(cmp);
      return h('button',{type:'button','aria-label':A.fmtDate(ds)+(list.length?', '+list.length+' καταχωρήσεις':''),
        class:'cal-cell'+(d.getMonth()!==m?' out':'')+(ds===t?' today':'')+(ds===sel?' sel':''),
        onclick:function(){sel=ds;if(d.getMonth()!==m)cur=new Date(d.getFullYear(),d.getMonth(),1);renderMain();}},
        h('span',{class:'dn',text:String(d.getDate())}),
        h('span',{class:'dots'},list.slice(0,4).map(function(e){return h('i',{class:'dot',style:gel(e)});})),
        h('span',{class:'ctitles'},list.slice(0,2).map(function(e){return h('span',{class:'ct'+(goalish(e)&&e.done?' gdone':''),style:gel(e),text:(e.start_time?e.start_time+' ':'')+e.title});}),
          list.length>2?h('span',{class:'more',text:'+'+(list.length-2)}):null));
    }
    for(var i=0;i<rows*7;i++)g.append(cell(i));
    return g;
  }

  /* ---------- form ---------- */
  function formEl(){
    var h=A.h, e=editing?events.filter(function(x){return x.id===editing;})[0]:null, p=e||prefill||{}, R={};
    function fld(lbl,el,wide){return h('div',{class:'field'+(wide?' wide':'')},h('label',{text:lbl}),el);}
    R.kind=h('select',null,KINDS.map(function(k){return h('option',{value:k.k,text:k.l,selected:(p.kind||'rehearsal')===k.k?true:null});}));
    R.title=h('input',{type:'text',maxlength:'160',value:p.title||'',placeholder:'π.χ. Πρόβα στον χώρο'});
    R.date=h('input',{type:'date',value:p.starts_on||''});
    R.end=h('input',{type:'date',value:p.ends_on||''});
    R.t1=h('input',{type:'time',value:p.start_time||''});
    R.t2=h('input',{type:'time',value:p.end_time||''});
    R.notes=h('textarea',{maxlength:'2000',placeholder:'Λεπτομέρειες: ώρες, χώρος, τι χρειάζεται'}); R.notes.value=p.notes||'';
    return h('form',{class:'composer',novalidate:true,onsubmit:function(ev){ev.preventDefault();save(R);}},
      h('h2',{text:e?'Επεξεργασία':'Νέο στο ημερολόγιο'}),
      h('div',{class:'grid'},fld('Είδος',R.kind),fld('Τίτλος',R.title,true),fld('Ημερομηνία',R.date),fld('Έως (προαιρετικό)',R.end),
        fld('Από ώρα',R.t1),fld('Έως ώρα',R.t2),fld('Σημειώσεις',R.notes,true),
        h('div',{class:'field wide'},h('label',{text:'Tag μελών'}),A.tagPicker(people))),
      h('div',{class:'formrow'},h('button',{class:'btn',type:'submit',text:'Αποθήκευση'}),
        h('button',{class:'btn ghost',type:'button',text:'Ακύρωση',onclick:function(){formOpen=false;editing=null;renderForm();}})));
  }
  function openForm(e,pre){
    editing=e?e.id:null; prefill=pre||null; people=e?e.mentions.slice():[]; formOpen=true;
    renderForm(); var f=$('calForm'); if(f&&f.scrollIntoView)f.scrollIntoView({block:'nearest'});
  }
  function renderForm(){var f=$('calForm');f.textContent='';if(formOpen)f.append(formEl());}

  /* ---------- render ---------- */
  function renderMain(){
    if(!A)return;
    var h=A.h, t=todayISO(); if(!sel)sel=t;
    $('calTitle').textContent=cur.toLocaleDateString('el-GR',{month:'long',year:'numeric'});
    var g=$('calGrid'); g.textContent=''; g.append(gridEl());
    var lg=$('calLegend'); lg.textContent='';
    KINDS.forEach(function(k){lg.append(h('span',{class:'kind',style:'--gel:var('+k.c+')'},h('i'),k.l));});
    var day=events.filter(function(e){return onDay(e,sel);}).sort(cmp);
    var d=$('calDay'); d.textContent='';
    d.append(secEl(A.fmtDate(sel)+(sel===t?' · σήμερα':''),
      h('button',{type:'button',class:'btn ghost',text:'+ Σε αυτή τη μέρα',onclick:function(){openForm(null,{starts_on:sel});}}),
      loaded?listEl(day,'Τίποτα καταχωρημένο αυτή τη μέρα.'):h('p',{class:'note',text:'Φόρτωση…'})));
    var all=events.filter(goalish), open=all.filter(function(e){return !e.done;}).sort(cmp), done=all.filter(function(e){return e.done;}).sort(cmp);
    var gl=$('calGoals'); gl.textContent='';
    var body=h('div',null,listEl(open,'Κανένας ανοιχτός στόχος ή εκκρεμότητα.'));
    if(done.length){
      body.append(h('p',null,h('button',{type:'button',class:'textbtn',text:(showDone?'Απόκρυψη ολοκληρωμένων':'Ολοκληρωμένα ('+done.length+')'),onclick:function(){showDone=!showDone;renderMain();}})));
      if(showDone)body.append(listEl(done,''));
    }
    gl.append(secEl('Στόχοι και εκκρεμότητες'+(open.length?' ('+open.length+')':''),
      h('button',{type:'button',class:'btn ghost',text:'+ Στόχος',onclick:function(){openForm(null,{kind:'goal'});}}),body));
    var up=events.filter(function(e){return !goalish(e)&&e.starts_on&&endOf(e)>=t;}).sort(cmp).slice(0,10);
    var u=$('calUp'); u.textContent='';
    u.append(secEl('Επόμενα',null,listEl(up,'Δεν υπάρχει κάτι προγραμματισμένο.')));
  }
  function setTab(name){
    tab=name; document.body.dataset.tab=name;
    $('archiveView').hidden=name!=='archive'; $('calView').hidden=name!=='calendar';
    [].slice.call($('tabs').querySelectorAll('button')).forEach(function(b){
      if(b.dataset.tab===name)b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
    });
    try{history.replaceState(null,'',name==='calendar'?'#calendar':location.pathname+location.search);}catch(x){}
    window.scrollTo(0,0);
    if(name==='calendar')renderMain();
  }

  function start(){
    if(started||!window.ARCH)return;
    A=window.ARCH; sb=A.sb; started=true; sel=todayISO();
    $('tabs').addEventListener('click',function(ev){var b=ev.target.closest('button[data-tab]');if(b)setTab(b.dataset.tab);});
    $('calPrev').addEventListener('click',function(){cur=new Date(cur.getFullYear(),cur.getMonth()-1,1);renderMain();});
    $('calNext').addEventListener('click',function(){cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);renderMain();});
    $('calToday').addEventListener('click',function(){var n=new Date();cur=new Date(n.getFullYear(),n.getMonth(),1);sel=todayISO();renderMain();});
    $('calNew').addEventListener('click',function(){if(formOpen){formOpen=false;editing=null;renderForm();}else openForm(null,{starts_on:sel});});
    sb.channel('calendar').on('postgres_changes',{event:'*',schema:'public',table:'events'},function(){clearTimeout(start.t);start.t=setTimeout(load,300);}).subscribe();
    if(location.hash==='#calendar')setTab('calendar');
    load();
  }
  window.CAL={start:start,render:function(){if(started&&tab==='calendar')renderMain();}};
})();
