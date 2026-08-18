(() => {
"use strict";
const $ = id => document.getElementById(id);
const SERVER_URL = String(window.ALGO_CONFIG?.SERVER_URL || "").replace(/\/+$/, "");
const WS_URL = SERVER_URL.replace(/^http/i,"ws");
const sessionKey="algo_online_session_v03", nameKey="algo_online_name_v03";
const sessionId=localStorage.getItem(sessionKey)||crypto.randomUUID();
localStorage.setItem(sessionKey,sessionId);

let socket=null,currentRoom=null,roomView=null,gameView=null;
let selectedTarget=null,logs=[],memos={},resultShownFor=null,reconnectTimer=null,intentionalClose=false,cpuTimer=null;

const els={
 titleScreen:$("titleScreen"),roomScreen:$("roomScreen"),gameScreen:$("gameScreen"),nameInput:$("nameInput"),roomGrid:$("roomGrid"),serverState:$("serverState"),
 roomTitle:$("roomTitle"),hostLabel:$("hostLabel"),waitingPlayers:$("waitingPlayers"),waitingText:$("waitingText"),readyBtn:$("readyBtn"),
 addCpuBtn:$("addCpuBtn"),removeCpuBtn:$("removeCpuBtn"),modeButtons:$("modeButtons"),
 gameRoomLabel:$("gameRoomLabel"),modeChip:$("modeChip"),turnText:$("turnText"),deckCount:$("deckCount"),deckLabel:$("deckLabel"),
 othersGrid:$("othersGrid"),selfName:$("selfName"),selfTeam:$("selfTeam"),selfCards:$("selfCards"),selfOpen:$("selfOpen"),selfTotal:$("selfTotal"),
 actionTitle:$("actionTitle"),actionHelp:$("actionHelp"),guessPanel:$("guessPanel"),targetLabel:$("targetLabel"),numberPad:$("numberPad"),
 decisionPanel:$("decisionPanel"),drawCard:$("drawCard"),drawLabel:$("drawLabel"),tossReveal:$("tossReveal"),skipTossBtn:$("skipTossBtn"),
 memoNumbers:$("memoNumbers"),memoTargetText:$("memoTargetText"),clearMemoBtn:$("clearMemoBtn"),toastLayer:$("toastLayer"),
 logList:$("logList"),logDrawer:$("logDrawer"),drawerShade:$("drawerShade"),resultOverlay:$("resultOverlay"),resultTitle:$("resultTitle"),resultText:$("resultText")
};

const MODE_LABEL={2:"2人戦",3:"3人戦",4:"4人戦",pair:"ペア戦"};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const teamOf=i=>i%2===0?"A":"B";

els.nameInput.value=localStorage.getItem(nameKey)||"";
els.nameInput.addEventListener("input",()=>localStorage.setItem(nameKey,els.nameInput.value.trim()));
$("refreshRoomsBtn").addEventListener("click",refreshRooms);
$("rulesBtn").addEventListener("click",()=>$("rulesModal").classList.remove("hidden"));
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).classList.add("hidden")));
$("rulesModal").addEventListener("click",e=>{if(e.target.id==="rulesModal")$("rulesModal").classList.add("hidden")});
$("logBtn").addEventListener("click",()=>{els.logDrawer.classList.add("open");els.drawerShade.classList.remove("hidden")});
$("closeLogBtn").addEventListener("click",closeLog);els.drawerShade.addEventListener("click",closeLog);
$("leaveBtn").addEventListener("click",leaveRoom);
els.readyBtn.addEventListener("click",()=>send({type:"ready"}));
els.addCpuBtn.addEventListener("click",()=>send({type:"add_cpu"}));
els.removeCpuBtn.addEventListener("click",()=>send({type:"remove_cpu"}));
els.modeButtons.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>send({type:"set_mode",mode:b.dataset.mode})));
$("continueBtn").addEventListener("click",()=>send({type:"continue"}));
$("stayBtn").addEventListener("click",()=>send({type:"stay"}));
els.skipTossBtn.addEventListener("click",()=>send({type:"skip_toss"}));
$("viewBoardBtn").addEventListener("click",()=>els.resultOverlay.classList.add("hidden"));
$("rematchBtn").addEventListener("click",()=>{els.resultOverlay.classList.add("hidden");send({type:"ready"})});
els.clearMemoBtn.addEventListener("click",()=>{if(!selectedTarget)return;memos[selectedTarget.cardId]=new Set();renderMemo();renderNumberPad()});

function closeLog(){els.logDrawer.classList.remove("open");els.drawerShade.classList.add("hidden")}
function setScreen(name){
 els.titleScreen.classList.toggle("hidden",name!=="title");els.roomScreen.classList.toggle("hidden",name!=="room");els.gameScreen.classList.toggle("hidden",name!=="game");
 document.querySelectorAll(".game-only").forEach(x=>x.classList.toggle("hidden",name==="title"));
}
function playerName(){const n=els.nameInput.value.trim();if(!n){toast("プレイヤー名を入力してください",false);return null}localStorage.setItem(nameKey,n);return n}
async function refreshRooms(){
 try{
  const r=await fetch(`${SERVER_URL}/rooms`,{cache:"no-store"});if(!r.ok)throw new Error();
  const d=await r.json();setServerOnline(true);renderRooms(d.rooms||[]);
 }catch{setServerOnline(false);els.roomGrid.innerHTML=`<div class="room-card" style="grid-column:1/-1"><div class="seat-list">Cloudflare Workersへ接続できません。</div></div>`}
}
function setServerOnline(ok){els.serverState.classList.toggle("online",ok);els.serverState.classList.toggle("offline",!ok);els.serverState.querySelector("span:last-child").textContent=ok?"サーバー接続OK":"サーバー未接続"}
function renderRooms(rooms){
 els.roomGrid.innerHTML="";
 for(const room of rooms){
  const req=room.requiredPlayers||2,occ=room.players?.length||0,full=occ>=req;
  const card=document.createElement("div");card.className="room-card"+(full?" full":"");
  const names=(room.players||[]).map(p=>`${esc(p.name)}${p.isCpu?" [CPU]":p.connected?"":" (OFFLINE)"}`).join("<br>")||"空室";
  card.innerHTML=`<div class="room-top"><div><div class="room-name">ROOM ${esc(room.room)}</div><div class="room-mode">${MODE_LABEL[room.mode]||"2人戦"}</div></div><div class="room-status">${occ}/${req}</div></div><div class="seat-list">${names}</div><div class="room-actions"><button class="enter-btn" ${full?"disabled":""}>入室</button><button class="reset-btn">初期化</button></div>`;
  card.querySelector(".enter-btn").addEventListener("click",()=>joinRoom(room.room));
  card.querySelector(".reset-btn").addEventListener("click",()=>resetRoom(room.room));els.roomGrid.appendChild(card);
 }
}
async function resetRoom(room){
 if(!confirm(`ROOM ${room} を初期化しますか？`))return;
 try{const r=await fetch(`${SERVER_URL}/reset?room=${encodeURIComponent(room)}`,{method:"POST"});if(!r.ok)throw new Error();toast("部屋を初期化しました",true);if(currentRoom===String(room))returnToTitle(false);setTimeout(refreshRooms,250)}catch{toast("初期化に失敗しました",false)}
}
function joinRoom(room){const name=playerName();if(!name)return;currentRoom=String(room);intentionalClose=false;setScreen("room");connect(name)}
function connect(name){
 if(socket){try{socket.close()}catch{}}
 const u=`${WS_URL}/ws?room=${encodeURIComponent(currentRoom)}&session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}`;
 socket=new WebSocket(u);
 socket.addEventListener("message",ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}handleMessage(m)});
 socket.addEventListener("close",()=>{if(intentionalClose)return;if(currentRoom){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>connect(playerName()||"PLAYER"),1200)}});
}
function send(data){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data))}
function handleMessage(msg){
 if(msg.type==="error"){toast(msg.message||"エラー",false);if(msg.code==="ROOM_FULL")returnToTitle(false);return}
 if(msg.type==="notice"){toast(msg.message,msg.good);return}
 if(msg.type==="state"){roomView=msg.room||null;gameView=msg.game||null;if(Array.isArray(msg.logs))logs=msg.logs;renderState()}
}
function renderState(){
 if(!roomView)return;
 const me=roomView.players.find(p=>p.id===sessionId);if(!me){returnToTitle(false);return}
 if(!gameView||gameView.status==="waiting"){setScreen("room");renderLobby(me);return}
 setScreen("game");renderGame(me);scheduleCpuTick();
}
function renderLobby(me){
 const fallbackHostId=roomView.hostId||roomView.players.find(p=>!p.isCpu&&p.connected)?.id||roomView.players.find(p=>!p.isCpu)?.id||null;
 const isHost=roomView.youIsHost===true||fallbackHostId===sessionId;
 els.roomTitle.textContent=`ROOM ${roomView.room}`;els.hostLabel.textContent=isHost?"HOST":"GUEST";
 const req=roomView.requiredPlayers||2;
 els.modeButtons.querySelectorAll("button").forEach(b=>{b.classList.toggle("active",b.dataset.mode===roomView.mode);b.disabled=!isHost});
 els.addCpuBtn.disabled=!isHost||roomView.players.length>=req;els.removeCpuBtn.disabled=!isHost||!roomView.players.some(p=>p.isCpu);
 els.waitingPlayers.innerHTML=Array.from({length:req},(_,i)=>{
  const p=roomView.players[i],team=roomView.mode==="pair"?teamOf(i):null;
  return `<div class="waiting-seat ${p?.ready||p?.isCpu?"ready":""} ${p?.isCpu?"cpu":""}"><div class="seat-no">PLAYER ${i+1}${team?` / <span class="team${team}">TEAM ${team}</span>`:""}</div><strong>${p?esc(p.name):"募集中"}</strong><div class="seat-meta">${p?(p.isCpu?"CPU":p.ready?"READY":"WAIT"):"EMPTY"}${p&&!p.isCpu&&!p.connected?" / OFFLINE":""}</div></div>`;
 }).join("");
 const full=roomView.players.length===req;
 els.waitingText.textContent=full?"全員が揃いました。人間プレイヤーがREADYで開始します。":`あと ${req-roomView.players.length} 席です。ホストはCPUを追加できます。`;
 els.readyBtn.disabled=!full;els.readyBtn.textContent=me.ready?"READY 済み":"READY";renderLog();
}
function renderGame(me){
 const meIdx=roomView.players.findIndex(p=>p.id===sessionId),pair=gameView.mode==="pair";
 els.gameRoomLabel.textContent=`ROOM ${roomView.room}`;els.modeChip.textContent=MODE_LABEL[gameView.mode]||gameView.mode;
 els.deckCount.textContent=gameView.deckCount;els.deckLabel.textContent=pair?"NO DECK":"DRAW";els.drawLabel.textContent=pair?"攻撃に使うカード":"今回引いたカード";
 els.selfName.textContent=me.name;els.selfTeam.classList.toggle("hidden",!pair);if(pair){els.selfTeam.textContent=`TEAM ${teamOf(meIdx)}`;els.selfTeam.className=`team-badge ${teamOf(meIdx)}`}
 const selfHand=gameView.hands[meIdx]||[];els.selfOpen.textContent=selfHand.filter(c=>c.revealed).length;els.selfTotal.textContent=selfHand.length;
 renderSelfCards(meIdx,selfHand);
 renderOthers(meIdx);
 const active=gameView.turn,activeP=roomView.players[active],myTurn=active===meIdx;
 els.turnText.textContent=gameView.status==="ended"?"ラウンド終了":`${activeP?.name||"PLAYER"} のターン`;document.querySelector(".turn-dot").style.background=myTurn?"var(--accent)":"var(--blue)";
 renderDraw(meIdx);renderAction(meIdx);renderMemo();renderLog();
 if(gameView.status==="ended")showResultIfNeeded(meIdx);
}
function renderOthers(meIdx){
 const others=roomView.players.map((p,i)=>({p,i})).filter(x=>x.i!==meIdx);
 els.othersGrid.className=`others-grid count-${others.length}`;els.othersGrid.innerHTML="";
 for(const {p,i} of others){
  const panel=document.createElement("div"),pair=gameView.mode==="pair",mate=pair&&teamOf(i)===teamOf(meIdx),eliminated=!!gameView.eliminated?.[i],active=gameView.turn===i;
  panel.className=`player-panel ${mate?"teammate":""} ${eliminated?"eliminated":""} ${active?"active":""}`;
  const team=pair?`<span class="team-badge ${teamOf(i)}">TEAM ${teamOf(i)}</span>`:"";
  const conn=p.isCpu?`<span class="conn-label">CPU</span>`:`<span class="conn-label ${p.connected?"":"offline"}">${p.connected?"ONLINE":"OFFLINE"}</span>`;
  const hand=gameView.hands[i]||[];
  panel.innerHTML=`<div class="player-head"><div><strong>${esc(p.name)}</strong>${team}${conn}</div><div class="open-meter">${hand.filter(c=>c.revealed).length}/${hand.length} OPEN</div></div><div class="card-row"></div>`;
  const row=panel.querySelector(".card-row");hand.forEach(c=>row.appendChild(makeCard(c,i,false,meIdx)));els.othersGrid.appendChild(panel);
 }
}
function renderSelfCards(meIdx,hand){els.selfCards.innerHTML="";hand.forEach(c=>els.selfCards.appendChild(makeCard(c,meIdx,true,meIdx)))}
function makeCard(c,ownerIdx,isSelf,meIdx){
 const d=document.createElement("div"),show=c.num!==null&&c.num!==undefined;
 d.className=`algo-card ${c.color} ${show?"":"hidden-card"} ${c.revealed?"revealed":""}`;
 d.dataset.id=c.id;d.dataset.owner=ownerIdx;
 d.innerHTML=`${show?`<span class="num">${c.num}</span>`:`<span class="qmark">?</span>`}${c.revealed?`<span class="open-overlay">OPEN</span>`:""}${gameView.attackCardId===c.id?`<span class="attack-badge">ATTACK</span>`:""}${gameView.toss?.cardId===c.id?`<span class="toss-badge">TOSS</span>`:""}`;
 let clickable=false,action=null;
 if(gameView.status==="playing"){
  if(gameView.mode==="pair"&&gameView.phase==="toss"&&gameView.toss?.from===meIdx&&isSelf&&!c.revealed){clickable=true;action=()=>send({type:"toss_card",cardId:c.id})}
  else if(gameView.mode==="pair"&&gameView.turn===meIdx&&gameView.phase==="choose_attack_card"&&isSelf&&!c.revealed){clickable=true;action=()=>send({type:"select_attack_card",cardId:c.id})}
  else if(gameView.turn===meIdx&&gameView.phase==="attack"&&!isSelf&&!c.revealed&&canAttackOwner(meIdx,ownerIdx)){clickable=true;action=()=>selectTarget(ownerIdx,c.id)}
 }
 if(selectedTarget?.cardId===c.id)d.classList.add("selected");
 if(clickable){d.classList.add("clickable");d.addEventListener("click",action)}
 return d;
}
function canAttackOwner(meIdx,ownerIdx){
 if(ownerIdx===meIdx||gameView.eliminated?.[ownerIdx])return false;
 return gameView.mode!=="pair"||teamOf(meIdx)!==teamOf(ownerIdx);
}
function selectTarget(owner,cardId){
 selectedTarget={owner,cardId};const p=roomView.players[owner],hand=gameView.hands[owner],idx=hand.findIndex(c=>c.id===cardId),c=hand[idx];
 els.targetLabel.textContent=`${p.name} の左から${idx+1}枚目（${c.color==="black"?"黒":"白"}）`;renderGame(roomView.players.find(p=>p.id===sessionId));
}
function renderDraw(meIdx){
 els.drawCard.className="draw-card";
 if(gameView.mode==="pair"){
  const hand=gameView.hands[meIdx]||[],a=hand.find(c=>c.id===gameView.attackCardId);
  if(gameView.turn===meIdx&&a){els.drawCard.classList.add(a.color);els.drawCard.textContent=a.num}else{els.drawCard.classList.add("empty");els.drawCard.textContent="—"};return;
 }
 if(gameView.turn===meIdx&&gameView.drawn){els.drawCard.classList.add(gameView.drawn.color);els.drawCard.textContent=gameView.drawn.num}else{els.drawCard.classList.add("empty");els.drawCard.textContent="—"}
}
function renderAction(meIdx){
 els.guessPanel.classList.add("hidden");els.decisionPanel.classList.add("hidden");els.tossReveal.classList.add("hidden");els.skipTossBtn.classList.add("hidden");
 if(gameView.tossReveal){els.tossReveal.innerHTML=`味方からのTOSS <b>${gameView.tossReveal.color==="black"?"黒":"白"} ${gameView.tossReveal.num}</b>`;els.tossReveal.classList.remove("hidden")}
 if(gameView.status==="ended"){els.actionTitle.textContent="ROUND END";els.actionHelp.textContent="盤面を見ることができます。";return}
 const active=gameView.turn,activeP=roomView.players[active],myTurn=active===meIdx;
 if(gameView.mode==="pair"&&gameView.phase==="toss"){
  if(gameView.toss?.from===meIdx){els.actionTitle.textContent="TOSS";els.actionHelp.textContent=`味方 ${activeP.name} に見せる自分の伏せカードを1枚選択してください。`;return}
  if(myTurn){els.actionTitle.textContent="味方のTOSS待ち";els.actionHelp.textContent="味方が見せるカードを選んでいます。不要なら省略できます。";els.skipTossBtn.classList.remove("hidden");return}
  els.actionTitle.textContent="TOSS中";els.actionHelp.textContent=`${activeP.name} の手番準備中です。`;return;
 }
 if(!myTurn){els.actionTitle.textContent=`${activeP?.name||"相手"}が推理中`;els.actionHelp.textContent="手番を待っています。";selectedTarget=null;return}
 if(gameView.mode==="pair"&&gameView.phase==="choose_attack_card"){els.actionTitle.textContent="攻撃カードを選択";els.actionHelp.textContent="自分の伏せカード1枚を選んでアタックに使います。";selectedTarget=null;return}
 if(gameView.phase==="attack"){
  els.actionTitle.textContent="相手カードを推理";els.actionHelp.textContent=gameView.mode==="pair"?"敵チームの伏せカードを選択してください。":"好きな相手の伏せカードを選択してください。";
  els.guessPanel.classList.remove("hidden");renderNumberPad();return;
 }
 if(gameView.phase==="decision"){els.actionTitle.textContent="アタック成功";els.actionHelp.textContent="続行するか、ステイして手番を終了します。";els.decisionPanel.classList.remove("hidden");selectedTarget=null}
}
function renderNumberPad(){
 els.numberPad.innerHTML="";const memo=selectedTarget?(memos[selectedTarget.cardId]||new Set()):null;
 for(let n=0;n<=11;n++){const b=document.createElement("button");b.className="num-btn"+(memo?.has(n)?" memo-out":"");b.textContent=n;b.disabled=!selectedTarget;b.addEventListener("click",()=>{if(selectedTarget)send({type:"guess",targetOwner:selectedTarget.owner,targetId:selectedTarget.cardId,number:n})});els.numberPad.appendChild(b)}
 if(selectedTarget){const p=roomView.players[selectedTarget.owner],h=gameView.hands[selectedTarget.owner],i=h.findIndex(c=>c.id===selectedTarget.cardId),c=h[i];els.targetLabel.textContent=`${p.name} の左から${i+1}枚目（${c.color==="black"?"黒":"白"}）`}else els.targetLabel.textContent="伏せカードを選択";
}
function renderMemo(){
 els.memoNumbers.innerHTML="";const memo=selectedTarget?(memos[selectedTarget.cardId]||(memos[selectedTarget.cardId]=new Set())):null;
 els.memoTargetText.textContent=selectedTarget?"選択中カードの候補除外":"相手カードを選択すると使えます";
 for(let n=0;n<=11;n++){const b=document.createElement("button");b.className="memo-btn"+(memo?.has(n)?" off":"");b.textContent=n;b.disabled=!selectedTarget;b.addEventListener("click",()=>{if(!selectedTarget)return;memo.has(n)?memo.delete(n):memo.add(n);renderMemo();renderNumberPad()});els.memoNumbers.appendChild(b)}
}
function scheduleCpuTick(){
 clearTimeout(cpuTimer);if(!gameView||gameView.status!=="playing")return;
 const meIdx=roomView.players.findIndex(p=>p.id===sessionId);
 const coordinator=roomView.players.findIndex(p=>!p.isCpu&&p.connected);
 if(meIdx!==coordinator)return;
 const activeCpu=roomView.players[gameView.turn]?.isCpu;
 const tossCpu=gameView.mode==="pair"&&gameView.phase==="toss"&&roomView.players[gameView.toss?.from]?.isCpu;
 if(activeCpu||tossCpu)cpuTimer=setTimeout(()=>send({type:"cpu_tick"}),720);
}
function showResultIfNeeded(meIdx){
 if(resultShownFor===gameView.gameId)return;resultShownFor=gameView.gameId;
 let win=false,text="";
 if(gameView.mode==="pair"){win=gameView.winnerTeam===teamOf(meIdx);text=`TEAM ${gameView.winnerTeam} の勝利です。`}
 else{win=gameView.winner===meIdx;text=`${roomView.players[gameView.winner]?.name||"PLAYER"} の勝利です。`}
 els.resultTitle.textContent=win?"YOU WIN":"YOU LOSE";els.resultTitle.style.color=win?"var(--accent)":"#ff7f88";els.resultText.textContent=text;setTimeout(()=>els.resultOverlay.classList.remove("hidden"),350)
}
function renderLog(){els.logList.innerHTML=logs.map(x=>`<div class="log-entry"><div class="log-time">${esc(x.time)}</div><div class="log-text">${esc(x.text)}</div></div>`).join("")}
function toast(text,good){const t=document.createElement("div");t.className="toast"+(good===true?" good":good===false?" bad":"");t.textContent=text;els.toastLayer.appendChild(t);setTimeout(()=>t.remove(),1100)}
function leaveRoom(){if(!currentRoom)return;send({type:"leave"});returnToTitle(true)}
function returnToTitle(closeSocket=true){intentionalClose=true;clearTimeout(cpuTimer);if(closeSocket&&socket){try{socket.close()}catch{}}socket=null;currentRoom=null;roomView=null;gameView=null;selectedTarget=null;resultShownFor=null;els.resultOverlay.classList.add("hidden");setScreen("title");setTimeout(refreshRooms,100)}
refreshRooms();
})();
