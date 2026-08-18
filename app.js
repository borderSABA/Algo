(() => {
"use strict";
const $ = id => document.getElementById(id);
const SERVER_URL = String(window.ALGO_CONFIG?.SERVER_URL || "").replace(/\/+$/, "");
const WS_URL = SERVER_URL.replace(/^http/i, "ws");
const sessionKey = "algo_online_session_v02";
const nameKey = "algo_online_name_v02";
const sessionId = localStorage.getItem(sessionKey) || crypto.randomUUID();
localStorage.setItem(sessionKey, sessionId);

let socket = null;
let currentRoom = null;
let roomView = null;
let gameView = null;
let selectedTargetId = null;
let logs = [];
let memos = {};
let resultShownFor = null;
let reconnectTimer = null;
let intentionalClose = false;

const els = {
  titleScreen:$("titleScreen"), roomScreen:$("roomScreen"), gameScreen:$("gameScreen"),
  nameInput:$("nameInput"), roomGrid:$("roomGrid"), serverState:$("serverState"),
  roomTitle:$("roomTitle"), waitingPlayers:$("waitingPlayers"), waitingText:$("waitingText"), readyBtn:$("readyBtn"),
  opponentName:$("opponentName"), opponentConn:$("opponentConn"), selfName:$("selfName"),
  opponentCards:$("opponentCards"), selfCards:$("selfCards"), opponentOpen:$("opponentOpen"), opponentTotal:$("opponentTotal"),
  selfOpen:$("selfOpen"), selfTotal:$("selfTotal"), turnText:$("turnText"), deckCount:$("deckCount"), gameRoomLabel:$("gameRoomLabel"),
  actionTitle:$("actionTitle"), actionHelp:$("actionHelp"), guessPanel:$("guessPanel"), targetLabel:$("targetLabel"),
  numberPad:$("numberPad"), decisionPanel:$("decisionPanel"), drawCard:$("drawCard"), memoNumbers:$("memoNumbers"),
  memoTargetText:$("memoTargetText"), clearMemoBtn:$("clearMemoBtn"), toastLayer:$("toastLayer"), logList:$("logList"),
  logDrawer:$("logDrawer"), drawerShade:$("drawerShade"), resultOverlay:$("resultOverlay"), resultTitle:$("resultTitle"), resultText:$("resultText")
};

els.nameInput.value = localStorage.getItem(nameKey) || "";
els.nameInput.addEventListener("input", () => localStorage.setItem(nameKey, els.nameInput.value.trim()));
$("refreshRoomsBtn").addEventListener("click", refreshRooms);
$("rulesBtn").addEventListener("click", () => $("rulesModal").classList.remove("hidden"));
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => $(b.dataset.close).classList.add("hidden")));
$("rulesModal").addEventListener("click", e => { if(e.target.id==="rulesModal") $("rulesModal").classList.add("hidden"); });
$("logBtn").addEventListener("click", () => { els.logDrawer.classList.add("open"); els.drawerShade.classList.remove("hidden"); });
$("closeLogBtn").addEventListener("click", closeLog);
els.drawerShade.addEventListener("click", closeLog);
$("leaveBtn").addEventListener("click", leaveRoom);
els.readyBtn.addEventListener("click", () => send({type:"ready"}));
$("continueBtn").addEventListener("click", () => send({type:"continue"}));
$("stayBtn").addEventListener("click", () => send({type:"stay"}));
$("viewBoardBtn").addEventListener("click", () => els.resultOverlay.classList.add("hidden"));
$("rematchBtn").addEventListener("click", () => { els.resultOverlay.classList.add("hidden"); send({type:"ready"}); });
els.clearMemoBtn.addEventListener("click", () => {
  if(!selectedTargetId) return;
  memos[selectedTargetId] = new Set();
  renderMemo(); renderNumberPad();
});

function closeLog(){ els.logDrawer.classList.remove("open"); els.drawerShade.classList.add("hidden"); }
function setScreen(name){
  els.titleScreen.classList.toggle("hidden", name!=="title");
  els.roomScreen.classList.toggle("hidden", name!=="room");
  els.gameScreen.classList.toggle("hidden", name!=="game");
  document.querySelectorAll(".game-only").forEach(x => x.classList.toggle("hidden", name==="title"));
}
function playerName(){
  const n = els.nameInput.value.trim();
  if(!n){ toast("プレイヤー名を入力してください", false); els.nameInput.focus(); return null; }
  localStorage.setItem(nameKey,n);
  return n;
}
async function refreshRooms(){
  try{
    const r = await fetch(`${SERVER_URL}/rooms`, {cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data = await r.json();
    setServerOnline(true);
    renderRooms(data.rooms || []);
  }catch(e){
    setServerOnline(false);
    els.roomGrid.innerHTML = `<div class="room-card" style="grid-column:1/-1"><div class="seat-list">Cloudflare Workersへ接続できません。SERVER_URLまたはデプロイ状態を確認してください。</div></div>`;
  }
}
function setServerOnline(ok){
  els.serverState.classList.toggle("online",ok); els.serverState.classList.toggle("offline",!ok);
  els.serverState.querySelector("span:last-child").textContent = ok ? "サーバー接続OK" : "サーバー未接続";
}
function renderRooms(rooms){
  els.roomGrid.innerHTML="";
  for(const room of rooms){
    const card=document.createElement("div");
    const occupied=room.players?.length||0, full=occupied>=2;
    card.className="room-card"+(full?" full":"");
    const names=(room.players||[]).map(p=>escapeHtml(p.name)+(p.connected?"":" (OFFLINE)")).join("<br>") || "空室";
    card.innerHTML=`
      <div class="room-top"><div class="room-name">ROOM ${room.room}</div><div class="room-status ${occupied===2?"ready":""}">${occupied}/2</div></div>
      <div class="seat-list">${names}</div>
      <div class="room-actions">
        <button class="enter-btn" ${full?"disabled":""}>入室</button>
        <button class="reset-btn">初期化</button>
      </div>`;
    card.querySelector(".enter-btn").addEventListener("click",()=>joinRoom(room.room));
    card.querySelector(".reset-btn").addEventListener("click",()=>resetRoom(room.room));
    els.roomGrid.appendChild(card);
  }
}
async function resetRoom(room){
  if(!confirm(`ROOM ${room} を初期化しますか？\n対戦中の場合もゲームが終了します。`)) return;
  try{
    const r=await fetch(`${SERVER_URL}/reset?room=${encodeURIComponent(room)}`,{method:"POST"});
    if(!r.ok) throw new Error();
    toast(`ROOM ${room} を初期化しました`,true);
    if(currentRoom===String(room)) returnToTitle(false);
    setTimeout(refreshRooms,250);
  }catch{ toast("部屋の初期化に失敗しました",false); }
}
function joinRoom(room){
  const name=playerName(); if(!name) return;
  currentRoom=String(room); intentionalClose=false;
  els.roomTitle.textContent=`ROOM ${room}`;
  setScreen("room");
  connect(name);
}
function connect(name){
  if(socket){ try{socket.close();}catch{} }
  const u=`${WS_URL}/ws?room=${encodeURIComponent(currentRoom)}&session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}`;
  socket=new WebSocket(u);
  socket.addEventListener("open",()=>{ addLog("サーバーへ接続しました。"); });
  socket.addEventListener("message",ev=>{
    let msg; try{msg=JSON.parse(ev.data);}catch{return;}
    handleMessage(msg);
  });
  socket.addEventListener("close",()=>{
    if(intentionalClose) return;
    addLog("接続が切れました。再接続を試みます。");
    if(currentRoom){
      clearTimeout(reconnectTimer);
      reconnectTimer=setTimeout(()=>connect(playerName()||"PLAYER"),1400);
    }
  });
}
function handleMessage(msg){
  if(msg.type==="error"){ toast(msg.message||"エラー",false); if(msg.code==="ROOM_FULL") returnToTitle(false); return; }
  if(msg.type==="notice"){ addLog(msg.message); toast(msg.message,msg.good); return; }
  if(msg.type==="state"){
    roomView=msg.room||null; gameView=msg.game||null;
    if(Array.isArray(msg.logs)) logs=msg.logs;
    renderState();
  }
}
function renderState(){
  if(!roomView) return;
  const me=roomView.players.find(p=>p.id===sessionId);
  if(!me){ returnToTitle(false); return; }
  if(!gameView || gameView.status==="waiting"){
    setScreen("room");
    els.roomTitle.textContent=`ROOM ${roomView.room}`;
    els.waitingPlayers.innerHTML=[0,1].map(i=>{
      const p=roomView.players[i];
      return `<div class="waiting-seat ${p?.ready?"ready":""}"><div class="seat-no">PLAYER ${i+1}</div><strong>${p?escapeHtml(p.name):"募集中"}</strong><div class="room-status">${p?(p.ready?"READY":"WAIT"):"EMPTY"}</div></div>`;
    }).join("");
    const two=roomView.players.length===2;
    els.waitingText.textContent=two ? "2人揃いました。両者がREADYで開始します。" : "対戦相手を待っています。";
    els.readyBtn.disabled=!two;
    els.readyBtn.textContent=me.ready?"READY 済み":"READY";
    renderLog();
    return;
  }
  setScreen("game");
  els.gameRoomLabel.textContent=`ROOM ${roomView.room}`;
  renderGame(me);
}
function renderGame(me){
  const myIndex=roomView.players.findIndex(p=>p.id===sessionId);
  const oppIndex=myIndex===0?1:0;
  const opp=roomView.players[oppIndex];
  const selfHand=gameView.hands[myIndex]||[];
  const oppHand=gameView.hands[oppIndex]||[];
  els.selfName.textContent=me.name;
  els.opponentName.textContent=opp?.name||"相手";
  els.opponentConn.textContent=opp?.connected===false?"OFFLINE":"ONLINE";
  els.opponentConn.classList.toggle("offline",opp?.connected===false);
  els.deckCount.textContent=gameView.deckCount;
  els.selfOpen.textContent=selfHand.filter(c=>c.revealed).length; els.selfTotal.textContent=selfHand.length;
  els.opponentOpen.textContent=oppHand.filter(c=>c.revealed).length; els.opponentTotal.textContent=oppHand.length;
  renderCards(els.selfCards,selfHand,true);
  renderCards(els.opponentCards,oppHand,false);

  const myTurn=gameView.turn===myIndex;
  els.turnText.textContent=gameView.status==="ended"?"ラウンド終了":myTurn?"あなたのターン":`${opp?.name||"相手"}のターン`;
  document.querySelector(".turn-dot").style.background=myTurn?"var(--accent)":"var(--blue)";

  els.drawCard.className="draw-card";
  if(gameView.drawn && myTurn){
    els.drawCard.classList.add(gameView.drawn.color);
    els.drawCard.textContent=gameView.drawn.num;
  }else{ els.drawCard.classList.add("empty"); els.drawCard.textContent="—"; }

  els.guessPanel.classList.add("hidden");
  els.decisionPanel.classList.add("hidden");
  if(gameView.status==="ended"){
    els.actionTitle.textContent="ROUND END";
    els.actionHelp.textContent="盤面を確認できます。";
    showResultIfNeeded(myIndex);
  }else if(!myTurn){
    els.actionTitle.textContent=`${opp?.name||"相手"}が推理中`;
    els.actionHelp.textContent="相手のアタックを待っています。";
    selectedTargetId=null;
  }else if(gameView.phase==="attack"){
    els.actionTitle.textContent="相手のカードを推理";
    els.actionHelp.textContent="伏せカードを1枚選択して数字を宣言します。";
    els.guessPanel.classList.remove("hidden");
    if(selectedTargetId && !oppHand.some(c=>c.id===selectedTargetId && !c.revealed)) selectedTargetId=null;
    els.targetLabel.textContent=selectedTargetId?"選択中のカードへアタック":"相手の伏せカードを選択";
  }else if(gameView.phase==="decision"){
    els.actionTitle.textContent="アタック成功";
    els.actionHelp.textContent="続けて狙うか、ステイして引いたカードを伏せたまま残します。";
    els.decisionPanel.classList.remove("hidden");
    selectedTargetId=null;
  }
  renderNumberPad(); renderMemo(); renderLog();
}
function renderCards(root,cards,isSelf){
  root.innerHTML="";
  const n=Math.max(cards.length,1);
  cards.forEach((card,i)=>{
    const el=document.createElement("div");
    const visible=isSelf || card.revealed || gameView.status==="ended";
    el.className=`algo-card ${card.color} ${visible?"":"hidden-card"} ${card.revealed?"revealed":""} ${selectedTargetId===card.id?"selected":""}`;
    el.style.flexBasis=`min(84px, calc((100% - ${(n-1)*6}px) / ${n}))`;
    el.innerHTML=`<span class="pos">${i+1}</span><span class="number">${visible?card.num:"?"}</span>${isSelf&&card.revealed?'<span class="open-overlay">OPEN</span>':""}`;
    if(!isSelf && !card.revealed && gameView.status==="playing" && gameView.phase==="attack"){
      el.addEventListener("click",()=>{ selectedTargetId=card.id; renderGame(roomView.players.find(p=>p.id===sessionId)); });
    }
    root.appendChild(el);
  });
}
function renderNumberPad(){
  els.numberPad.innerHTML="";
  const memo=selectedTargetId ? (memos[selectedTargetId] ||= new Set()) : null;
  for(let n=0;n<=11;n++){
    const b=document.createElement("button"); b.className="num-btn"; b.textContent=n;
    if(memo?.has(n)) b.classList.add("memo-out");
    b.disabled=!selectedTargetId;
    b.addEventListener("click",()=>{ if(selectedTargetId) send({type:"guess",targetId:selectedTargetId,number:n}); });
    els.numberPad.appendChild(b);
  }
}
function renderMemo(){
  els.memoNumbers.innerHTML="";
  els.memoTargetText.textContent=selectedTargetId?"選択カードの除外候補":"相手カードを選択すると使えます";
  const memo=selectedTargetId ? (memos[selectedTargetId] ||= new Set()) : null;
  for(let n=0;n<=11;n++){
    const b=document.createElement("button"); b.className="memo-btn"; b.textContent=n;
    if(!selectedTargetId) b.disabled=true;
    if(memo?.has(n)) b.classList.add("off");
    b.addEventListener("click",()=>{ if(!selectedTargetId)return; memo.has(n)?memo.delete(n):memo.add(n); renderMemo(); renderNumberPad(); });
    els.memoNumbers.appendChild(b);
  }
}
function showResultIfNeeded(myIndex){
  const key=`${gameView.gameId}:${gameView.winner}`;
  if(resultShownFor===key) return;
  resultShownFor=key;
  const win=gameView.winner===myIndex;
  els.resultTitle.textContent=win?"YOU WIN":"YOU LOSE";
  els.resultTitle.style.color=win?"var(--accent)":"#ff7b84";
  els.resultText.textContent=win?"相手のカードをすべてOPENにしました。":"あなたのカードをすべてOPENにされました。";
  els.resultOverlay.classList.remove("hidden");
}
function send(obj){
  if(!socket || socket.readyState!==WebSocket.OPEN){ toast("サーバーへ再接続中です",false); return; }
  socket.send(JSON.stringify(obj));
}
function leaveRoom(){
  if(!currentRoom) returnToTitle();
  if(!confirm("この部屋から退出しますか？")) return;
  send({type:"leave"});
  setTimeout(()=>returnToTitle(true),120);
}
function returnToTitle(closeSocket=true){
  intentionalClose=true; clearTimeout(reconnectTimer);
  if(closeSocket && socket){ try{socket.close();}catch{} }
  socket=null; currentRoom=null; roomView=null; gameView=null; selectedTargetId=null; resultShownFor=null;
  $("resultOverlay").classList.add("hidden"); closeLog(); setScreen("title"); setTimeout(refreshRooms,180);
}
function addLog(text){ logs.unshift({time:new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),text}); logs=logs.slice(0,80); renderLog(); }
function renderLog(){
  els.logList.innerHTML=(logs||[]).map(x=>`<div class="log-entry"><div class="log-time">${escapeHtml(x.time||"")}</div><div class="log-text">${escapeHtml(x.text||"")}</div></div>`).join("");
}
function toast(text,good){
  const t=document.createElement("div"); t.className="toast"+(good===true?" good":good===false?" bad":""); t.textContent=text; els.toastLayer.appendChild(t); setTimeout(()=>t.remove(),1250);
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

setScreen("title");
refreshRooms();
setInterval(()=>{ if(!currentRoom) refreshRooms(); },5000);
})();
