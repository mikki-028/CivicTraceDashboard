const KEY='sb_publishable_i2Ptz6IejRvjInnuU1vMOQ_scn-CTtU';
const HOST='kzeibmyavxmxjgxvpote.supabase.co';
const url=`wss://${HOST}/realtime/v1/websocket?apikey=${KEY}&vsn=1.0.0`;
const ws=new WebSocket(url);
const ref='probe1';
let joinPayload={config:{broadcast:{ack:false,self:false},presence:{key:''},postgres_changes:[{event:'*',schema:'public',table:'events'}]},access_token:null};
const t=setTimeout(()=>{console.log('TIMEOUT: no decisive result');ws.close();process.exit(3)},20000);
ws.addEventListener('open',()=>{
  console.log('WS OPEN');
  ws.send(JSON.stringify({topic:`realtime:${ref}`,event:'phx_join',payload:joinPayload,ref:'1'}));
});
ws.addEventListener('message',async(ev)=>{
  const m=JSON.parse(ev.data);
  if(m.event==='phx_reply'){
    console.log('JOIN REPLY:',JSON.stringify(m.payload).slice(0,600));
    if(m.payload?.status==='ok'){
      console.log('--- inserting a row via REST to test delivery ---');
      const r=await fetch(`https://${HOST}/rest/v1/events`,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json',Prefer:'return=representation'},
        body:JSON.stringify({entity_id:'BIN-0037',event_type:'inspection',audit_result:'Needs attention',note:'REALTIME PROBE - safe to delete',source:'website_2_dashboard',environment:'official_dashboard'})});
      const body=await r.text();console.log('INSERT',r.status,body.slice(0,200));
    }
  } else if(m.event==='postgres_changes'){
    console.log('*** REALTIME EVENT RECEIVED ***',JSON.stringify(m.payload).slice(0,400));
    clearTimeout(t);ws.close();process.exit(0);
  } else { console.log('EVENT',m.event, JSON.stringify(m.payload).slice(0,300)); }
});
ws.addEventListener('error',(e)=>{console.log('WS ERROR',e.message??String(e))});
ws.addEventListener('close',(e)=>{console.log('WS CLOSE',e.code,e.reason);});
