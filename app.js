(() => {
"use strict";
const $ = id => document.getElementById(id);
const SERVER_URL = String(window.ALGO_CONFIG?.SERVER_URL || "").replace(/\/+$/, "");
const WS_URL = SERVER_URL.replace(/^http/i,"ws");
const sessionKey="algo_online_session_v06", nameKey="algo_online_name_v06";
const sessionId=localStorage.getItem(sessionKey)||crypto.randomUUID();
localStorage.setItem(sessionKey,sessionId);

let socket=null,currentRoom=null,roomView=null,gameView=null;
let selectedTarget=null,logs=[],resultShownFor=null,reconnectTimer=null,intentionalClose=false,lastAttackFxId=null,attackFxTimer=null,attackFxResultTimer=null;

const els={
 titleScreen:$("titleScreen"),roomScreen:$("roomScreen"),gameScreen:$("gameScreen"),nameInput:$("nameInput"),roomGrid:$("roomGrid"),serverState:$("serverState"),
 roomTitle:$("roomTitle"),waitingPlayers:$("waitingPlayers"),waitingText:$("waitingText"),autoModeBadge:$("autoModeBadge"),pairToggleBtn:$("pairToggleBtn"),pairToggleState:$("pairToggleState"),startGameBtn:$("startGameBtn"),startModeText:$("startModeText"),

 gameRoomLabel:$("gameRoomLabel"),modeChip:$("modeChip"),turnText:$("turnText"),deckCount:$("deckCount"),deckLabel:$("deckLabel"),
 othersGrid:$("othersGrid"),selfName:$("selfName"),selfTeam:$("selfTeam"),selfCards:$("selfCards"),selfOpen:$("selfOpen"),selfTotal:$("selfTotal"),
 actionTitle:$("actionTitle"),actionHelp:$("actionHelp"),guessPanel:$("guessPanel"),targetLabel:$("targetLabel"),numberPad:$("numberPad"),
 decisionPanel:$("decisionPanel"),tossReveal:$("tossReveal"),skipTossBtn:$("skipTossBtn"),
 toastLayer:$("toastLayer"),
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
els.pairToggleBtn.addEventListener("click",()=>send({type:"toggle_pair"}));
els.startGameBtn.addEventListener("click",()=>send({type:"start_game"}));
$("continueBtn").addEventListener("click",()=>send({type:"continue"}));
$("stayBtn").addEventListener("click",()=>send({type:"stay"}));
els.skipTossBtn.addEventListener("click",()=>send({type:"skip_toss"}));
$("viewBoardBtn").addEventListener("click",()=>els.resultOverlay.classList.add("hidden"));
$("rematchBtn").addEventListener("click",()=>{els.resultOverlay.classList.add("hidden");send({type:"start_game"})});

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
  const occ=room.players?.length||0,full=occ>=4,playing=room.status==="playing";
  const mode=room.pairMode&&occ===4?"ペア戦":occ>=2?`${occ}人戦`:"待機中";
  const card=document.createElement("div");
  card.className="room-card"+(full||playing?" full":"");
  const names=(room.players||[]).map(p=>`${esc(p.name)}${p.isCpu?" [CPU]":p.connected?"":" (OFFLINE)"}`).join("<br>")||"空室";
  card.innerHTML=`<div class="room-top"><div><div class="room-name">ROOM ${esc(room.room)}</div><div class="room-mode">${playing?"対戦中":mode}</div></div><div class="room-status">${occ}/4</div></div><div class="seat-list">${names}</div><div class="room-actions"><button class="enter-btn" ${(full||playing)?"disabled":""}>部屋に参加</button><button class="reset-btn">初期化</button></div>`;
  card.querySelector(".enter-btn").addEventListener("click",()=>joinRoom(room.room));
  card.querySelector(".reset-btn").addEventListener("click",()=>resetRoom(room.room));
  els.roomGrid.appendChild(card);
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
 setScreen("game");renderGame(me);
}
function renderLobby(me){
 els.roomTitle.textContent=`ROOM ${roomView.room}`;
 const count=roomView.players.length;
 const pairOn=!!roomView.pairMode;
 const autoMode=pairOn&&count===4?"ペア戦":count>=2?`${count}人戦`:`${count}人参加`;
 els.autoModeBadge.textContent=autoMode;

 els.waitingPlayers.innerHTML="";
 for(let i=0;i<4;i++){
  const p=roomView.players[i];
  const team=pairOn&&count===4?teamOf(i):null;
  const seat=document.createElement("div");
  seat.className=`waiting-seat ${p?.isCpu?"cpu":""} ${p?"":"empty"}`;
  const teamText=team?` / <span class="team${team}">TEAM ${team}</span>`:"";
  if(p){
   seat.innerHTML=`<div><div class="seat-no">PLAYER ${i+1}${teamText}</div><strong>${esc(p.name)}</strong><div class="seat-meta">${p.isCpu?"CPU":p.connected?"ONLINE":"OFFLINE"}</div></div>`;
   if(p.isCpu){
    const rm=document.createElement("button");
    rm.className="seat-action-btn remove";
    rm.textContent="CPUを削除";
    rm.addEventListener("click",()=>send({type:"remove_cpu",cpuId:p.id}));
    seat.appendChild(rm);
   }
  }else{
   seat.innerHTML=`<div><div class="seat-no">PLAYER ${i+1}</div><strong>空席</strong><div class="seat-meta">参加待ち</div></div>`;
   const add=document.createElement("button");
   add.className="seat-action-btn add";
   add.textContent="＋ CPU追加";
   add.addEventListener("click",()=>send({type:"add_cpu"}));
   seat.appendChild(add);
  }
  els.waitingPlayers.appendChild(seat);
 }

 els.pairToggleBtn.disabled=count!==4;
 els.pairToggleBtn.classList.toggle("on",pairOn&&count===4);
 els.pairToggleState.textContent=count!==4?"4人時に選択できます":pairOn?"ON / 2対2で開始":"OFF / 個人戦で開始";

 const canStart=count>=2&&count<=4;
 els.startGameBtn.disabled=!canStart;
 els.startModeText.textContent=!canStart?"2人以上で開始できます":pairOn&&count===4?"ペア戦として開始":`${count}人戦として開始`;

 if(count<2) els.waitingText.textContent="あと1人参加するか、CPUを追加すると開始できます。";
 else if(count<4) els.waitingText.textContent=`現在${count}人。開始すると自動的に${count}人戦になります。`;
 else els.waitingText.textContent=pairOn?"4人・ペアプレーON：2対2で開始します。":"4人・ペアプレーOFF：4人個人戦で開始します。";
 renderLog();
}
function renderGame(me){
 if(selectedTarget){const h=gameView.hands?.[selectedTarget.owner]||[];const c=h.find(x=>x.id===selectedTarget.cardId);if(!c||c.revealed)selectedTarget=null}
 const meIdx=roomView.players.findIndex(p=>p.id===sessionId),pair=gameView.mode==="pair";
 els.gameRoomLabel.textContent=`ROOM ${roomView.room}`;els.modeChip.textContent=MODE_LABEL[gameView.mode]||gameView.mode;
 els.deckCount.textContent=gameView.deckCount;els.deckLabel.textContent=pair?"NO DECK":"DRAW";
 els.selfName.textContent=me.name;els.selfTeam.classList.toggle("hidden",!pair);if(pair){els.selfTeam.textContent=`TEAM ${teamOf(meIdx)}`;els.selfTeam.className=`team-badge ${teamOf(meIdx)}`}
 const selfHand=gameView.hands[meIdx]||[];els.selfOpen.textContent=selfHand.filter(c=>c.revealed).length;els.selfTotal.textContent=selfHand.length;
 renderSelfCards(meIdx,selfHand);
 renderOthers(meIdx);
 const active=gameView.turn,activeP=roomView.players[active],myTurn=active===meIdx;
 els.turnText.textContent=gameView.status==="ended"?"ラウンド終了":`${activeP?.name||"PLAYER"} のターン`;document.querySelector(".turn-dot").style.background=myTurn?"var(--accent)":"var(--blue)";
 renderAction(meIdx);renderLog();
 requestAnimationFrame(()=>playAttackEvent(meIdx));
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
 const isTurnDraw=gameView.turnDrawCardId===c.id;
 d.className=`algo-card ${c.color} ${show?"":"hidden-card"} ${c.revealed?"revealed":""} ${isTurnDraw?"turn-draw":""}`;
 d.dataset.id=c.id;d.dataset.owner=ownerIdx;
 const openLabel=c.revealed?`<span class="open-label ${isSelf?"self-open":""}">OPEN</span>`:`<span class="open-label spacer">OPEN</span>`;
 const face=show?`<span class="num">${c.num}</span>`:`<span class="qmark">?</span>`;
 d.innerHTML=`<div class="card-face">${openLabel}${face}</div>${gameView.attackCardId===c.id?`<span class="attack-badge">ATTACK</span>`:""}${gameView.toss?.cardId===c.id?`<span class="toss-badge">TOSS</span>`:""}`;
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
 els.numberPad.innerHTML="";
 for(let n=0;n<=11;n++){
  const b=document.createElement("button");
  b.className="num-btn";b.textContent=n;b.disabled=!selectedTarget;
  b.addEventListener("click",()=>{if(selectedTarget)send({type:"guess",targetOwner:selectedTarget.owner,targetId:selectedTarget.cardId,number:n})});
  els.numberPad.appendChild(b);
 }
 if(selectedTarget){
  const p=roomView.players[selectedTarget.owner],h=gameView.hands[selectedTarget.owner],i=h.findIndex(c=>c.id===selectedTarget.cardId),c=h[i];
  els.targetLabel.textContent=`${p.name} の左から${i+1}枚目（${c.color==="black"?"黒":"白"}）`;
 }else els.targetLabel.textContent="伏せカードを選択";
}
function showResultIfNeeded(meIdx){
 if(resultShownFor===gameView.gameId)return;resultShownFor=gameView.gameId;
 let win=false,text="";
 if(gameView.mode==="pair"){win=gameView.winnerTeam===teamOf(meIdx);text=`TEAM ${gameView.winnerTeam} の勝利です。`}
 else{win=gameView.winner===meIdx;text=`${roomView.players[gameView.winner]?.name||"PLAYER"} の勝利です。`}
 els.resultTitle.textContent=win?"YOU WIN":"YOU LOSE";els.resultTitle.style.color=win?"var(--accent)":"#ff7f88";els.resultText.textContent=text;setTimeout(()=>els.resultOverlay.classList.remove("hidden"),350)
}
function renderLog(){els.logList.innerHTML=logs.map(x=>`<div class="log-entry"><div class="log-time">${esc(x.time)}</div><div class="log-text">${esc(x.text)}</div></div>`).join("")}

function playAttackEvent(meIdx){
 const fx=gameView?.attackEvent;
 if(!fx||!fx.id||fx.id===lastAttackFxId)return;
 lastAttackFxId=fx.id;

 clearTimeout(attackFxTimer);
 clearTimeout(attackFxResultTimer);
 document.querySelectorAll(".algo-card.attack-focus,.algo-card.attack-hit,.algo-card.attack-miss").forEach(x=>x.classList.remove("attack-focus","attack-hit","attack-miss"));
 document.querySelectorAll(".player-panel.under-attack").forEach(x=>x.classList.remove("under-attack"));
 document.querySelectorAll(".attack-cutin").forEach(x=>x.remove());

 const attacker=roomView.players[fx.attacker];
 const victim=roomView.players[fx.targetOwner];
 const target=document.querySelector(`.algo-card[data-owner="${fx.targetOwner}"][data-id="${CSS.escape(fx.targetId)}"]`);
 if(target){
  target.classList.add("attack-focus");
  const panel=target.closest(".player-panel");
  if(panel)panel.classList.add("under-attack");
 }

 const victimIsMe=fx.targetOwner===meIdx;
 const cutin=document.createElement("div");
 cutin.className="attack-cutin";
 cutin.innerHTML=`
  <div class="attack-cutin-card">
   <div class="attack-kicker">${victimIsMe?"あなたのカードが狙われています":"ATTACK"}</div>
   <div class="attack-route">
    <strong>${esc(attacker?.name||"PLAYER")}</strong>
    <span>→</span>
    <strong class="${victimIsMe?"victim-me":""}">${esc(victim?.name||"PLAYER")}</strong>
   </div>
   <div class="attack-target-line">
    左から <b>${Number(fx.targetIndex)+1}</b> 枚目 ・ ${fx.targetColor==="black"?"黒":"白"}カード
   </div>
   <div class="attack-declare">
    <span>宣言</span>
    <b>${fx.number}</b>
   </div>
   <div class="attack-result">判定中</div>
  </div>`;
 document.body.appendChild(cutin);

 requestAnimationFrame(()=>cutin.classList.add("show"));

 attackFxResultTimer=setTimeout(()=>{
  const result=cutin.querySelector(".attack-result");
  if(!result)return;
  const hit=fx.result==="hit";
  result.textContent=hit?"正解！":"不正解";
  result.classList.add(hit?"hit":"miss","reveal");
  if(target)target.classList.add(hit?"attack-hit":"attack-miss");
 },2000);

 attackFxTimer=setTimeout(()=>{
  cutin.classList.add("hide");
  if(target)target.classList.remove("attack-focus","attack-hit","attack-miss");
  const panel=target?.closest(".player-panel");
  if(panel)panel.classList.remove("under-attack");
  setTimeout(()=>cutin.remove(),260);
 },4000);
}

function toast(text,good){const t=document.createElement("div");t.className="toast"+(good===true?" good":good===false?" bad":"");t.textContent=text;els.toastLayer.appendChild(t);setTimeout(()=>t.remove(),1100)}
function leaveRoom(){if(!currentRoom)return;send({type:"leave"});returnToTitle(true)}
function returnToTitle(closeSocket=true){intentionalClose=true;lastAttackFxId=null;clearTimeout(attackFxTimer);clearTimeout(attackFxResultTimer);if(closeSocket&&socket){try{socket.close()}catch{}}socket=null;currentRoom=null;roomView=null;gameView=null;selectedTarget=null;resultShownFor=null;els.resultOverlay.classList.add("hidden");setScreen("title");setTimeout(refreshRooms,100)}
refreshRooms();
})();
