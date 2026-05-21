// @ts-nocheck
"use client";

import { useState, useEffect, useRef } from "react";

// ─── Chess helpers ────────────────────────────────────────────────────────────
const FILES = ["a","b","c","d","e","f","g","h"];
const RANKS = [8,7,6,5,4,3,2,1];
const INIT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const sqIdx  = (sq) => FILES.indexOf(sq[0]) + (8 - parseInt(sq[1])) * 8;
const idxSq  = (i)  => FILES[i % 8] + RANKS[Math.floor(i / 8)];
const color  = (p)  => p ? (p === p.toUpperCase() ? "w" : "b") : null;
const ptype  = (p)  => p ? p.toLowerCase() : null;

const GLYPHS = { K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙",k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟" };

function parseFen(fen) {
  const parts = fen.split(" ");
  const board = Array(64).fill(null);
  let rank = 0, file = 0;
  for (const ch of parts[0]) {
    if (ch === "/") { rank++; file = 0; }
    else if (/\d/.test(ch)) file += +ch;
    else { board[rank*8+file] = ch; file++; }
  }
  return { board, turn: parts[1]||"w", castling: parts[2]||"-", ep: parts[3]||"-" };
}

function pseudoMoves(board, sq, turn, ep, castling) {
  const idx = sqIdx(sq);
  const p = board[idx];
  if (!p || color(p) !== turn) return [];
  const pt = ptype(p);
  const moves = [];
  const ok = (r,f) => r>=0&&r<8&&f>=0&&f<8;
  const r0 = Math.floor(idx/8), f0 = idx%8;

  const push = (r,f) => {
    if (!ok(r,f)) return false;
    const ti = r*8+f;
    if (color(board[ti]) === turn) return false;
    moves.push(idxSq(ti));
    return !board[ti];
  };
  const slide = (dr,df) => { let r=r0+dr,f=f0+df; while(ok(r,f)){if(!push(r,f))break;r+=dr;f+=df;} };

  if (pt==="p") {
    const dir = turn==="w"?-1:1, start = turn==="w"?6:1;
    if (!board[(r0+dir)*8+f0]) {
      moves.push(idxSq((r0+dir)*8+f0));
      if (r0===start && !board[(r0+2*dir)*8+f0]) moves.push(idxSq((r0+2*dir)*8+f0));
    }
    for (const df of [-1,1]) {
      if (!ok(r0+dir,f0+df)) continue;
      const ti=(r0+dir)*8+(f0+df), tsq=idxSq(ti);
      if ((board[ti]&&color(board[ti])!==turn)||tsq===ep) moves.push(tsq);
    }
  } else if (pt==="n") {
    for (const [dr,df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) push(r0+dr,f0+df);
  } else if (pt==="b") { for (const [dr,df] of [[-1,-1],[-1,1],[1,-1],[1,1]]) slide(dr,df); }
    else if (pt==="r") { for (const [dr,df] of [[-1,0],[1,0],[0,-1],[0,1]]) slide(dr,df); }
    else if (pt==="q") { for (const [dr,df] of [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]) slide(dr,df); }
    else if (pt==="k") {
    for (const [dr,df] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) push(r0+dr,f0+df);
    if (turn==="w"&&r0===7&&f0===4) {
      if (castling.includes("K")&&!board[61]&&!board[62]) moves.push("g1");
      if (castling.includes("Q")&&!board[59]&&!board[58]&&!board[57]) moves.push("c1");
    }
    if (turn==="b"&&r0===0&&f0===4) {
      if (castling.includes("k")&&!board[5]&&!board[6]) moves.push("g8");
      if (castling.includes("q")&&!board[3]&&!board[2]&&!board[1]) moves.push("c8");
    }
  }
  return moves;
}

function applyMove(board, from, to, turn) {
  const nb = [...board];
  const fi = sqIdx(from), ti = sqIdx(to);
  const p = nb[fi];
  nb[ti] = p; nb[fi] = null;
  if (ptype(p)==="p" && (Math.floor(ti/8)===0||Math.floor(ti/8)===7)) nb[ti] = turn==="w"?"Q":"q";
  if (ptype(p)==="k") {
    if (from==="e1"&&to==="g1") { nb[sqIdx("f1")]="R"; nb[sqIdx("h1")]=null; }
    if (from==="e1"&&to==="c1") { nb[sqIdx("d1")]="R"; nb[sqIdx("a1")]=null; }
    if (from==="e8"&&to==="g8") { nb[sqIdx("f8")]="r"; nb[sqIdx("h8")]=null; }
    if (from==="e8"&&to==="c8") { nb[sqIdx("d8")]="r"; nb[sqIdx("a8")]=null; }
  }
  return nb;
}

function updateCastling(cr, piece, from, to) {
  let c = cr;
  if (piece==="K") c=c.replace("K","").replace("Q","");
  if (piece==="k") c=c.replace("k","").replace("q","");
  if (from==="h1"||to==="h1") c=c.replace("K","");
  if (from==="a1"||to==="a1") c=c.replace("Q","");
  if (from==="h8"||to==="h8") c=c.replace("k","");
  if (from==="a8"||to==="a8") c=c.replace("q","");
  return c||"-";
}

// ─── Pure-JS AI (minimax + alpha-beta) ───────────────────────────────────────
const PIV = { p:100, n:320, b:330, r:500, q:900, k:20000 };
const PST = {
  p:[0,0,0,0,0,0,0,0,5,10,10,-20,-20,10,10,5,5,-5,-10,0,0,-10,-5,5,0,0,0,20,20,0,0,0,5,5,10,25,25,10,5,5,10,10,20,30,30,20,10,10,50,50,50,50,50,50,50,50,0,0,0,0,0,0,0,0],
  n:[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,5,5,0,-20,-40,-30,5,10,15,15,10,5,-30,-30,0,15,20,20,15,0,-30,-30,5,15,20,20,15,5,-30,-30,0,10,15,15,10,0,-30,-40,-20,0,0,0,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
  b:[-20,-10,-10,-10,-10,-10,-10,-20,-10,5,0,0,0,0,5,-10,-10,10,10,10,10,10,10,-10,-10,0,10,10,10,10,0,-10,-10,5,5,10,10,5,5,-10,-10,0,5,10,10,5,0,-10,-10,0,0,0,0,0,0,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  r:[0,0,0,5,5,0,0,0,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,5,10,10,10,10,10,10,5,0,0,0,0,0,0,0,0],
  q:[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,5,0,0,0,0,-10,-10,5,5,5,5,5,0,-10,0,0,5,5,5,5,0,-5,-5,0,5,5,5,5,0,-5,-10,0,5,5,5,5,0,-10,-10,0,0,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  k:[20,30,10,0,0,10,30,20,20,20,0,0,0,0,20,20,-10,-20,-20,-20,-20,-20,-20,-10,-20,-30,-30,-40,-40,-30,-30,-20,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30],
};

function evalBoard(board) {
  let s = 0;
  for (let i=0;i<64;i++) {
    const p=board[i]; if(!p) continue;
    const pt=ptype(p), isW=color(p)==="w";
    const pi = isW ? i : (7-Math.floor(i/8))*8+(i%8);
    s += (isW?1:-1) * (PIV[pt] + (PST[pt]?.[pi]??0));
  }
  return s;
}

function allMoves(board, turn, ep, castling) {
  const moves=[];
  for (let i=0;i<64;i++) {
    const p=board[i]; if(!p||color(p)!==turn) continue;
    const sq=idxSq(i);
    for (const to of pseudoMoves(board,sq,turn,ep,castling)) moves.push({from:sq,to});
  }
  return moves;
}

function minimax(board, depth, alpha, beta, maxing, turn, ep, castling) {
  if (depth===0) return evalBoard(board);
  const moves = allMoves(board,turn,ep,castling);
  if (!moves.length) return maxing ? -99999 : 99999;
  const next = turn==="w"?"b":"w";
  if (maxing) {
    let best=-Infinity;
    for (const m of moves) {
      const v=minimax(applyMove(board,m.from,m.to,turn),depth-1,alpha,beta,false,next,"-",castling);
      best=Math.max(best,v); alpha=Math.max(alpha,best); if(beta<=alpha) break;
    }
    return best;
  } else {
    let best=Infinity;
    for (const m of moves) {
      const v=minimax(applyMove(board,m.from,m.to,turn),depth-1,alpha,beta,true,next,"-",castling);
      best=Math.min(best,v); beta=Math.min(beta,best); if(beta<=alpha) break;
    }
    return best;
  }
}

const AI_CFG = { Beginner:{depth:1,noise:160}, Intermediate:{depth:1,noise:20}, Advanced:{depth:2,noise:0} };

function getAIMove(board, turn, ep, castling, level) {
  const {depth,noise} = AI_CFG[level]??AI_CFG.Intermediate;
  const moves = allMoves(board,turn,ep,castling);
  if (!moves.length) return null;
  const maxing = turn==="w";
  const next = turn==="w"?"b":"w";
  let best = maxing?-Infinity:Infinity, picks=[];
  for (const m of moves) {
    const nb = applyMove(board,m.from,m.to,turn);
    const raw = minimax(nb,depth-1,-Infinity,Infinity,!maxing,next,"-",castling);
    const score = raw + (Math.random()*noise - noise/2);
    const better = maxing ? score>best : score<best;
    if (better) { best=score; picks=[m]; }
    else if (Math.abs(score-best)<5) picks.push(m);
  }
  return picks[Math.floor(Math.random()*picks.length)] ?? moves[0];
}

// ─── Puzzles & Lessons ────────────────────────────────────────────────────────
const PUZZLES = [
  {id:1,title:"Fork Attack",fen:"r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",solution:"f3g5",hint:"Knight to g5 attacks queen and f7!",theme:"Fork",difficulty:"Beginner"},
  {id:2,title:"Back Rank Mate",fen:"6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",solution:"d1d8",hint:"Deliver checkmate on the back rank!",theme:"Checkmate",difficulty:"Beginner"},
  {id:3,title:"Pin the Knight",fen:"r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6",solution:"c4f7",hint:"The f7 square is weak!",theme:"Pin",difficulty:"Intermediate"},
  {id:4,title:"Discovered Check",fen:"3r2k1/5ppp/8/3B4/8/8/5PPP/4R1K1 w - - 0 1",solution:"d5f7",hint:"Move the bishop to reveal a check!",theme:"Discovery",difficulty:"Intermediate"},
  {id:5,title:"Skewer the King",fen:"4k3/8/8/8/8/8/8/4K2R w - - 0 1",solution:"h1h8",hint:"Attack the king, win the rook!",theme:"Skewer",difficulty:"Beginner"},
];

const LESSONS = [
  {id:1,title:"Control the Center",category:"Opening",duration:"5 min",description:"Learn why controlling the center is the most important opening principle.",content:"Place your pawns on e4 and d4 to control the center. Develop knights toward the center (Nf3, Nc3). Avoid moving the same piece twice in the opening. Castle early to protect your king.",icon:"⚔️",difficulty:"Beginner"},
  {id:2,title:"Piece Development",category:"Opening",duration:"7 min",description:"Understand why getting all your pieces out early wins games.",content:"Develop all pieces before attacking. Knights before bishops as a rule of thumb. Connect your rooks by castling. Don't bring your queen out too early.",icon:"🏰",difficulty:"Beginner"},
  {id:3,title:"Tactics: The Fork",category:"Tactics",duration:"8 min",description:"A fork attacks two or more pieces simultaneously.",content:"A fork is when one piece attacks two enemy pieces at once. Knights excel at forks due to their unique movement. Always check if your knight can land on a square that attacks two valuable pieces.",icon:"⚡",difficulty:"Beginner"},
  {id:4,title:"The Pin and Skewer",category:"Tactics",duration:"10 min",description:"Pins immobilize pieces, skewers win material by attacking valuable pieces first.",content:"A pin is when a piece cannot move without exposing a more valuable piece. An absolute pin is against the king. A skewer forces a valuable piece to move, winning the piece behind it.",icon:"📌",difficulty:"Intermediate"},
  {id:5,title:"Pawn Structure",category:"Strategy",duration:"12 min",description:"Pawns are the soul of chess. Understanding pawn structures defines your long-term plans.",content:"Doubled pawns are weak. Isolated pawns have no pawn support. Passed pawns are powerful. Backward pawns cannot be defended by other pawns. Strong pawn structures create strong plans.",icon:"♟️",difficulty:"Intermediate"},
  {id:6,title:"King and Pawn Endgames",category:"Endgame",duration:"15 min",description:"Master the fundamental endgame: king activity and the opposition.",content:"The king becomes a powerful piece in the endgame. The opposition is when two kings face each other. The rule of the square determines if a king can catch a pawn. Triangulation transfers the opposition.",icon:"👑",difficulty:"Intermediate"},
];

// ─── AI Coach ─────────────────────────────────────────────────────────────────
async function askCoach(messages, fen, level) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      model:"claude-sonnet-4-20250514", max_tokens:1000,
      system:`You are Chess Mentor AI — a warm expert chess coach for ${level} players. Position FEN: ${fen}. Be concise (2-4 sentences), practical, encouraging.`,
      messages: messages.map(m=>({role:m.role,content:m.content}))
    })
  });
  const d = await res.json();
  return d.content?.map(b=>b.text||"").join("")||"Let me think about that...";
}

// ─── Chessboard Component ─────────────────────────────────────────────────────
function Chessboard({ board, turn, playerSide, onMove, lastMove, highlights=[], size=480 }) {
  const [selected, setSelected] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);

  const handleClick = (sqName) => {
    // Only allow clicking if it's the player's turn (or no playerSide set)
    if (playerSide && turn !== playerSide) return;
    const idx = sqIdx(sqName);
    const piece = board[idx];
    if (selected) {
      if (legalMoves.includes(sqName)) {
        onMove(selected, sqName);
        setSelected(null); setLegalMoves([]);
      } else if (piece && color(piece)===turn) {
        setSelected(sqName);
        setLegalMoves(pseudoMoves(board,sqName,turn,"-","KQkq"));
      } else {
        setSelected(null); setLegalMoves([]);
      }
    } else if (piece && color(piece)===turn) {
      setSelected(sqName);
      setLegalMoves(pseudoMoves(board,sqName,turn,"-","KQkq"));
    }
  };

  const sqSize = size/8;
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(8,${sqSize}px)`,width:size,height:size,borderRadius:8,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.5)",border:"3px solid #5a3e1b"}}>
      {Array.from({length:64},(_,i)=>{
        const sqName = idxSq(i);
        const r=Math.floor(i/8),f=i%8;
        const isLight=(r+f)%2===0;
        const piece=board[sqIdx(sqName)];
        const isSel=selected===sqName;
        const isLegal=legalMoves.includes(sqName);
        const isLast=lastMove&&(lastMove.from===sqName||lastMove.to===sqName);
        const isHL=highlights.includes(sqName);
        let bg=isLight?"#f0d9b5":"#b58863";
        if(isSel) bg=isLight?"#f6f669":"#baca2b";
        else if(isLast) bg=isLight?"#cdd26a":"#aaa23a";
        if(isHL) bg="#e74c3c";
        return (
          <div key={sqName} onClick={()=>handleClick(sqName)}
            style={{width:sqSize,height:sqSize,background:bg,display:"flex",alignItems:"center",justifyContent:"center",cursor:playerSide&&turn!==playerSide?"default":"pointer",position:"relative",userSelect:"none"}}>
            {r===7&&<span style={{position:"absolute",bottom:2,right:3,fontSize:10,fontWeight:700,color:isLight?"#b58863":"#f0d9b5",fontFamily:"Georgia"}}>{sqName[0]}</span>}
            {f===0&&<span style={{position:"absolute",top:2,left:3,fontSize:10,fontWeight:700,color:isLight?"#b58863":"#f0d9b5",fontFamily:"Georgia"}}>{sqName[1]}</span>}
            {isLegal&&(piece
              ?<div style={{position:"absolute",inset:0,border:"4px solid rgba(20,85,30,0.5)",borderRadius:"50%",zIndex:1}}/>
              :<div style={{width:sqSize*0.33,height:sqSize*0.33,borderRadius:"50%",background:"rgba(20,85,30,0.35)",zIndex:1}}/>
            )}
            {piece&&<span style={{fontSize:sqSize*0.75,lineHeight:1,zIndex:2,filter:"drop-shadow(1px 1px 2px rgba(0,0,0,0.4))"}}>{GLYPHS[piece]}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function ChessMentorAI() {
  const C = {bg:"#0f0e0c",surface:"#1a1814",card:"#221f1a",border:"#3a3228",gold:"#c9a84c",amber:"#e8b84b",text:"#f0e6d3",muted:"#8a7a6a",green:"#4a9b5f",red:"#c0392b",blue:"#2980b9"};
  const card = {background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:24};
  const btn  = (on,col=C.gold)=>({background:on?col:"transparent",color:on?"#0f0e0c":C.text,border:`1px solid ${on?col:C.border}`,borderRadius:8,padding:"9px 18px",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif",fontWeight:on?700:400,transition:"all 0.2s"});

  // ── Navigation
  const [page, setPage] = useState("dashboard");

  // ── Game state
  const [gs, setGs]           = useState(()=>parseFen(INIT_FEN));
  const [castling, setCastling]= useState("KQkq");
  const [ep, setEp]           = useState("-");
  const [fullMove, setFullMove]= useState(1);
  const [lastMove, setLastMove]= useState(null);
  const [history, setHistory] = useState([]);
  const [playerSide, setPlayerSide] = useState(null); // "w" | "b" | null
  const [aiThinking, setAiThinking] = useState(false);
  const [gameOver, setGameOver]= useState(null);
  const [level, setLevel]     = useState("Intermediate");

  // Refs so the AI timeout closure always reads fresh state
  const gsRef       = useRef(gs);
  const castlingRef = useRef(castling);
  const epRef       = useRef(ep);
  const levelRef    = useRef(level);
  const playerSideRef = useRef(playerSide);
  const gameOverRef = useRef(gameOver);

  useEffect(()=>{gsRef.current=gs;},[gs]);
  useEffect(()=>{castlingRef.current=castling;},[castling]);
  useEffect(()=>{epRef.current=ep;},[ep]);
  useEffect(()=>{levelRef.current=level;},[level]);
  useEffect(()=>{playerSideRef.current=playerSide;},[playerSide]);
  useEffect(()=>{gameOverRef.current=gameOver;},[gameOver]);

  // ── AI move effect — fires whenever turn or playerSide changes
  useEffect(()=>{
    if (!playerSide) return;           // no side chosen yet
    if (gs.turn === playerSide) return; // it's the human's turn
    if (gameOver) return;

    let cancelled = false;
    setAiThinking(true);

    // First setTimeout: let React paint the "Thinking..." UI
    const t1 = setTimeout(()=>{
      // Second setTimeout(0): yield to browser before heavy computation
      const t2 = setTimeout(()=>{
        if (cancelled) return;

        const cur  = gsRef.current;
        const cr   = castlingRef.current;
        const epSq = epRef.current;
        const lv   = levelRef.current;

        if (gameOverRef.current || cur.turn === playerSideRef.current) {
          setAiThinking(false); return;
        }

        const move = getAIMove(cur.board, cur.turn, epSq, cr, lv);
        if (cancelled) return;

        setAiThinking(false);
        if (!move) { setGameOver("stalemate"); return; }

        const {from, to} = move;
        const piece = cur.board[sqIdx(from)];
        const nb    = applyMove(cur.board, from, to, cur.turn);
        const next  = cur.turn==="w"?"b":"w";
        const newCr = updateCastling(cr, piece, from, to);

        setCastling(newCr);
        setEp("-");
        if (next==="w") setFullMove(f=>f+1);
        setGs({...cur, board:nb, turn:next});
        setLastMove({from,to});
        setHistory(h=>[...h,`${GLYPHS[piece]??""} ${from}→${to}`]);
      }, 0);

      return ()=>clearTimeout(t2);
    }, 300);

    return ()=>{ cancelled=true; clearTimeout(t1); };
  }, [gs.turn, playerSide, gameOver]);

  // ── Player move handler
  const doMove = (from, to) => {
    if (gameOver) return;
    if (aiThinking) return;
    if (playerSide && gs.turn !== playerSide) return; // not your turn

    const piece = gs.board[sqIdx(from)];
    const nb    = applyMove(gs.board, from, to, gs.turn);
    const next  = gs.turn==="w"?"b":"w";
    const newCr = updateCastling(castling, piece, from, to);
    const pt    = ptype(piece);
    const fromR = Math.floor(sqIdx(from)/8), toR = Math.floor(sqIdx(to)/8);
    const fromF = sqIdx(from)%8;
    const newEp = (pt==="p"&&Math.abs(fromR-toR)===2) ? idxSq(((fromR+toR)/2)*8+fromF) : "-";

    setCastling(newCr);
    setEp(newEp);
    if (next==="w") setFullMove(f=>f+1);
    setGs({...gs, board:nb, turn:next});
    setLastMove({from,to});
    setHistory(h=>[...h,`${GLYPHS[piece]??""} ${from}→${to}`]);
  };

  const newGame = () => {
    setGs(parseFen(INIT_FEN));
    setCastling("KQkq"); setEp("-"); setFullMove(1);
    setLastMove(null); setHistory([]);
    setPlayerSide(null); setAiThinking(false); setGameOver(null);
  };

  // ── Puzzle state
  const [puzzleIdx, setPuzzleIdx]   = useState(0);
  const [puzzleGs, setPuzzleGs]     = useState(()=>parseFen(PUZZLES[0].fen));
  const [puzzleRes, setPuzzleRes]   = useState(null);
  const [showHint, setShowHint]     = useState(false);

  const doPuzzleMove = (from,to)=>{
    const p=PUZZLES[puzzleIdx];
    if(from===p.solution.slice(0,2)&&to===p.solution.slice(2,4)){
      setPuzzleGs(prev=>({...prev,board:applyMove(prev.board,from,to,prev.turn),turn:prev.turn==="w"?"b":"w"}));
      setPuzzleRes("correct");
    } else { setPuzzleRes("wrong"); setTimeout(()=>setPuzzleRes(null),1500); }
  };
  const nextPuzzle=()=>{ const n=(puzzleIdx+1)%PUZZLES.length; setPuzzleIdx(n); setPuzzleGs(parseFen(PUZZLES[n].fen)); setPuzzleRes(null); setShowHint(false); };

  // ── Lesson state
  const [selLesson, setSelLesson] = useState(null);

  // ── Coach state
  const [msgs, setMsgs] = useState([{role:"assistant",content:"Welcome to Chess Mentor AI! ♟ Ask me about any position, opening, tactic, or strategy."}]);
  const [input, setInput] = useState("");
  const [coaching, setCoaching] = useState(false);
  const chatRef = useRef(null);
  useEffect(()=>{chatRef.current?.scrollIntoView({behavior:"smooth"});},[msgs]);

  const sendMsg = async()=>{
    if(!input.trim()||coaching) return;
    const userMsg={role:"user",content:input};
    const newMsgs=[...msgs,userMsg];
    setMsgs(newMsgs); setInput(""); setCoaching(true);
    try {
      const fen=`${gs.turn} board`;
      const reply=await askCoach(newMsgs,fen,level);
      setMsgs(m=>[...m,{role:"assistant",content:reply}]);
    } catch { setMsgs(m=>[...m,{role:"assistant",content:"Connection error — please try again!"}]); }
    setCoaching(false);
  };

  const stats={gamesPlayed:12,accuracy:73,puzzlesSolved:34,streak:5,totalMoves:287,blunders:8};

  // ══════════════════════════════════════════════════════════════════════════════
  // PAGES
  // ══════════════════════════════════════════════════════════════════════════════

  // ── DASHBOARD
  const Dashboard=()=>(
    <div>
      <h1 style={{fontSize:34,fontWeight:700,color:C.gold,margin:"0 0 4px",letterSpacing:"-0.5px"}}>♞ Chess Mentor AI</h1>
      <p style={{color:C.muted,margin:"0 0 28px",fontSize:15}}>Your personal chess training companion</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:28}}>
        {[{l:"Games Played",v:stats.gamesPlayed,i:"♟",c:C.gold},{l:"Avg Accuracy",v:`${stats.accuracy}%`,i:"🎯",c:C.green},{l:"Puzzles Solved",v:stats.puzzlesSolved,i:"⚡",c:C.amber},{l:"Daily Streak",v:`${stats.streak}d`,i:"🔥",c:C.red},{l:"Total Moves",v:stats.totalMoves,i:"↗",c:C.blue},{l:"Blunders",v:stats.blunders,i:"⚠",c:C.muted}].map(s=>(
          <div key={s.l} style={{...card,textAlign:"center"}}>
            <div style={{fontSize:26,marginBottom:6}}>{s.i}</div>
            <div style={{fontSize:28,fontWeight:700,color:s.c}}>{s.v}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={card}>
          <h3 style={{margin:"0 0 14px",color:C.gold}}>Quick Actions</h3>
          {[{l:"▶  Play vs AI",p:"play"},{l:"🧠 Ask Coach",p:"coach"},{l:"⚡ Solve Puzzle",p:"puzzles"},{l:"📚 Study Lesson",p:"lessons"}].map(a=>(
            <div key={a.p} onClick={()=>setPage(a.p)} style={{padding:"10px 14px",borderRadius:8,border:`1px solid ${C.border}`,marginBottom:8,cursor:"pointer",transition:"background 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#2a2520"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {a.l}
            </div>
          ))}
        </div>
        <div style={card}>
          <h3 style={{margin:"0 0 12px",color:C.gold}}>Today's Puzzle</h3>
          <div style={{background:C.surface,borderRadius:8,padding:14,marginBottom:14}}>
            <div style={{fontSize:12,color:C.muted,marginBottom:4}}>⚡ {PUZZLES[0].theme} — {PUZZLES[0].difficulty}</div>
            <div style={{fontWeight:600,marginBottom:6}}>{PUZZLES[0].title}</div>
            <div style={{fontSize:13,color:C.muted}}>{PUZZLES[0].hint}</div>
          </div>
          <button onClick={()=>setPage("puzzles")} style={{...btn(true),width:"100%"}}>Solve Now →</button>
        </div>
      </div>
    </div>
  );

  // ── PLAY
  const Play=()=>{
    if (!playerSide) return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"70vh",gap:28}}>
        <div style={{textAlign:"center"}}>
          <h2 style={{fontSize:30,color:C.gold,margin:"0 0 8px"}}>Choose Your Side</h2>
          <p style={{color:C.muted,margin:0}}>The AI will automatically play the other color</p>
        </div>
        <div style={{display:"flex",gap:20}}>
          {[{s:"w",l:"White",i:"♔",d:"You move first"},{s:"b",l:"Black",i:"♚",d:"AI moves first"}].map(o=>(
            <div key={o.s} onClick={()=>setPlayerSide(o.s)}
              style={{...card,width:180,textAlign:"center",cursor:"pointer",padding:32,transition:"all 0.2s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.gold;e.currentTarget.style.transform="translateY(-3px)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.transform="";}}>
              <div style={{fontSize:64,marginBottom:12}}>{o.i}</div>
              <div style={{fontSize:20,fontWeight:700,marginBottom:4}}>{o.l}</div>
              <div style={{fontSize:13,color:C.muted}}>{o.d}</div>
            </div>
          ))}
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:13,color:C.muted,marginBottom:10}}>AI Difficulty</div>
          <div style={{display:"flex",gap:8}}>
            {["Beginner","Intermediate","Advanced"].map(l=>(
              <button key={l} onClick={()=>setLevel(l)} style={btn(level===l)}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    );

    const myTurn = gs.turn===playerSide;
    const opLabel = playerSide==="w"?"⬛ Black (AI)":"⬜ White (AI)";
    const meLabel = playerSide==="w"?"⬜ You — White":"⬛ You — Black";

    return (
      <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:20}}>
        <div>
          {/* Opponent bar */}
          <div style={{display:"flex",alignItems:"center",marginBottom:8,padding:"7px 12px",borderRadius:8,background:C.surface,border:`1px solid ${aiThinking?C.amber:C.border}`,fontSize:13,color:C.muted,transition:"border-color 0.3s"}}>
            <span>{opLabel}</span>
            {aiThinking&&<span style={{marginLeft:"auto",color:C.amber,fontWeight:700,fontSize:12}}>⏳ Thinking...</span>}
          </div>

          {/* Board */}
          <div style={{position:"relative"}}>
            <Chessboard board={gs.board} turn={gs.turn} playerSide={playerSide} onMove={doMove} lastMove={lastMove} size={480}/>
            {gameOver&&(
              <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,borderRadius:8}}>
                <div style={{fontSize:44}}>{gameOver==="checkmate"?"♟":"½"}</div>
                <div style={{fontSize:22,fontWeight:700,color:C.gold}}>{gameOver==="checkmate"?(myTurn?"You lost!":"You won!"):"Draw!"}</div>
                <button onClick={newGame} style={btn(true)}>Play Again</button>
              </div>
            )}
          </div>

          {/* Player bar */}
          <div style={{display:"flex",alignItems:"center",marginTop:8,padding:"7px 12px",borderRadius:8,background:myTurn&&!gameOver?"#2a2010":C.surface,border:`1px solid ${myTurn&&!gameOver?C.gold:C.border}`,fontSize:13,color:myTurn&&!gameOver?C.gold:C.muted,transition:"all 0.3s"}}>
            <span>{meLabel}</span>
            {myTurn&&!gameOver&&!aiThinking&&<span style={{marginLeft:"auto",fontWeight:700,fontSize:12}}>● Your turn</span>}
          </div>

          <div style={{display:"flex",gap:10,marginTop:12}}>
            <button onClick={newGame} style={btn(false)}>↺ New Game</button>
            <button onClick={()=>setPage("coach")} style={btn(false)}>🧠 Ask Coach</button>
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={card}>
            <h3 style={{margin:"0 0 10px",color:C.gold}}>Game Info</h3>
            <div style={{fontSize:13,color:C.muted,marginBottom:3}}>Playing as</div>
            <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>{playerSide==="w"?"⬜ White":"⬛ Black"}</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:8}}>AI Difficulty</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {["Beginner","Intermediate","Advanced"].map(l=>(
                <button key={l} onClick={()=>setLevel(l)} style={{...btn(level===l),fontSize:12,padding:"6px 12px"}}>{l}</button>
              ))}
            </div>
            <div style={{marginTop:12,padding:"9px 12px",borderRadius:8,background:C.surface,border:`1px solid ${C.border}`,fontSize:12,color:C.muted}}>
              {level==="Beginner"&&"🟢 Makes real blunders — great for learning"}
              {level==="Intermediate"&&"🟡 Solid play with occasional mistakes"}
              {level==="Advanced"&&"🔴 Strong tactical play, very few mistakes"}
            </div>
          </div>
          <div style={{...card,flex:1,maxHeight:280,overflow:"auto"}}>
            <h3 style={{margin:"0 0 10px",color:C.gold}}>Move History</h3>
            {history.length===0
              ?<div style={{color:C.muted,fontSize:13}}>{playerSide==="w"?"Make your first move!":"AI is about to move..."}</div>
              :<div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {history.map((m,i)=>(
                  <span key={i} style={{background:i%2===(playerSide==="w"?0:1)?C.surface:"#2a2010",border:`1px solid ${i%2===(playerSide==="w"?0:1)?C.border:C.gold}`,borderRadius:6,padding:"2px 7px",fontSize:12}}>
                    {Math.floor(i/2)+1}{i%2===0?".":"…"} {m}
                  </span>
                ))}
              </div>
            }
          </div>
          <div style={card}>
            <h3 style={{margin:"0 0 10px",color:C.gold}}>Coach Tip</h3>
            <div style={{fontSize:13,color:C.muted,lineHeight:1.7}}>
              {history.length<4?"🎯 Control the center with e4 or d4. Develop knights first!":history.length<10?"♗ Develop bishops and castle for king safety!":"♛ Look for forks, pins, and discovered attacks!"}
            </div>
            <button onClick={()=>setPage("coach")} style={{...btn(false),marginTop:10,fontSize:12}}>Get full analysis →</button>
          </div>
        </div>
      </div>
    );
  };

  // ── COACH
  const Coach=()=>(
    <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:20,height:"calc(100vh - 100px)"}}>
      <div style={{display:"flex",flexDirection:"column",...card}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div><h2 style={{margin:0,color:C.gold,fontSize:20}}>🧠 AI Chess Coach</h2><p style={{margin:"3px 0 0",color:C.muted,fontSize:12}}>Powered by Claude</p></div>
          <div style={{display:"flex",gap:5}}>
            {["Beginner","Intermediate","Advanced"].map(l=><button key={l} onClick={()=>setLevel(l)} style={{...btn(level===l),fontSize:11,padding:"5px 10px"}}>{l}</button>)}
          </div>
        </div>
        <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column",gap:12,paddingRight:4,marginBottom:14}}>
          {msgs.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"75%",padding:"10px 14px",borderRadius:m.role==="user"?"14px 14px 3px 14px":"14px 14px 14px 3px",background:m.role==="user"?C.gold:C.surface,color:m.role==="user"?"#0f0e0c":C.text,border:`1px solid ${m.role==="user"?C.gold:C.border}`,fontSize:14,lineHeight:1.7}}>
                {m.role==="assistant"&&<span style={{marginRight:6}}>♞</span>}{m.content}
              </div>
            </div>
          ))}
          {coaching&&<div style={{display:"flex",justifyContent:"flex-start"}}><div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:"14px 14px 14px 3px",padding:"10px 16px",fontSize:14,color:C.muted}}>♞ Thinking...</div></div>}
          <div ref={chatRef}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg()} placeholder="Ask about openings, tactics, strategy..."
            style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",color:C.text,fontSize:14,fontFamily:"Georgia,serif",outline:"none"}}/>
          <button onClick={sendMsg} disabled={coaching||!input.trim()} style={{...btn(true),opacity:coaching?0.6:1}}>Send</button>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={card}>
          <h3 style={{margin:"0 0 10px",color:C.gold,fontSize:15}}>Quick Questions</h3>
          {["What's the best move here?","Explain my pawn structure","What opening should I play?","How do I attack the king?","Tips for the endgame?"].map(q=>(
            <div key={q} onClick={()=>setInput(q)} style={{padding:"7px 10px",borderRadius:6,border:`1px solid ${C.border}`,marginBottom:6,cursor:"pointer",fontSize:13,transition:"border-color 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=C.gold} onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>{q}</div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── PUZZLES
  const Puzzles=()=>{
    const pz=PUZZLES[puzzleIdx];
    return (
      <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:20}}>
        <div>
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              <span style={{background:C.gold,color:"#0f0e0c",padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700}}>{pz.theme}</span>
              <span style={{background:C.surface,border:`1px solid ${C.border}`,padding:"3px 10px",borderRadius:20,fontSize:12}}>{pz.difficulty}</span>
              <span style={{color:C.muted,fontSize:12}}>{puzzleIdx+1}/{PUZZLES.length}</span>
            </div>
            <h2 style={{margin:"0 0 4px",color:C.gold}}>{pz.title}</h2>
            <p style={{margin:0,color:C.muted,fontSize:13}}>{puzzleGs.turn==="w"?"⬜ White":"⬛ Black"} to move</p>
          </div>
          <Chessboard board={puzzleGs.board} turn={puzzleGs.turn} playerSide={null} onMove={doPuzzleMove} lastMove={null} size={480} highlights={puzzleRes==="correct"?[pz.solution.slice(2,4)]:[]}/>
          {puzzleRes&&<div style={{marginTop:12,padding:"10px 16px",borderRadius:10,background:puzzleRes==="correct"?"#1a4a2a":"#4a1a1a",border:`1px solid ${puzzleRes==="correct"?C.green:C.red}`,fontWeight:600,color:puzzleRes==="correct"?C.green:C.red}}>{puzzleRes==="correct"?"✓ Excellent! Correct move!":"✗ Not quite — try again!"}</div>}
          <div style={{display:"flex",gap:10,marginTop:14}}>
            <button onClick={()=>setShowHint(!showHint)} style={btn(showHint)}>💡 {showHint?"Hide":"Hint"}</button>
            {puzzleRes==="correct"&&<button onClick={nextPuzzle} style={btn(true)}>Next →</button>}
          </div>
          {showHint&&<div style={{marginTop:10,padding:"10px 14px",borderRadius:8,background:C.surface,border:`1px solid ${C.border}`,fontSize:13,color:C.muted}}>💡 {pz.hint}</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={card}>
            <h3 style={{margin:"0 0 12px",color:C.gold}}>Puzzles</h3>
            {PUZZLES.map((p,i)=>(
              <div key={p.id} onClick={()=>{setPuzzleIdx(i);setPuzzleGs(parseFen(p.fen));setPuzzleRes(null);setShowHint(false);}}
                style={{padding:"9px 12px",borderRadius:8,marginBottom:6,cursor:"pointer",border:`1px solid ${i===puzzleIdx?C.gold:C.border}`,background:i===puzzleIdx?"#2a2010":"transparent",transition:"all 0.15s"}}>
                <div style={{fontWeight:i===puzzleIdx?700:400,fontSize:14}}>{p.title}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{p.theme} · {p.difficulty}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── LESSONS
  const Lessons=()=>selLesson?(
    <div>
      <button onClick={()=>setSelLesson(null)} style={{...btn(false),marginBottom:18}}>← Back</button>
      <div style={{...card,maxWidth:680}}>
        <div style={{fontSize:36,marginBottom:10}}>{selLesson.icon}</div>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <span style={{background:C.gold,color:"#0f0e0c",padding:"2px 10px",borderRadius:20,fontSize:12,fontWeight:700}}>{selLesson.category}</span>
          <span style={{background:C.surface,border:`1px solid ${C.border}`,padding:"2px 10px",borderRadius:20,fontSize:12}}>{selLesson.difficulty}</span>
          <span style={{color:C.muted,fontSize:12}}>⏱ {selLesson.duration}</span>
        </div>
        <h2 style={{margin:"0 0 10px",color:C.gold,fontSize:26}}>{selLesson.title}</h2>
        <p style={{color:C.muted,fontSize:15,lineHeight:1.7,marginBottom:20}}>{selLesson.description}</p>
        <div style={{background:C.surface,borderRadius:10,padding:18,border:`1px solid ${C.border}`}}>
          <h3 style={{margin:"0 0 10px",color:C.amber,fontSize:15}}>Key Points</h3>
          {selLesson.content.split(".").filter(s=>s.trim()).map((pt,i)=>(
            <div key={i} style={{display:"flex",gap:10,marginBottom:8,fontSize:14,lineHeight:1.6}}>
              <span style={{color:C.gold,fontWeight:700,minWidth:18}}>{i+1}.</span><span>{pt.trim()}.</span>
            </div>
          ))}
        </div>
        <div style={{marginTop:18,display:"flex",gap:10}}>
          <button onClick={()=>{setPage("coach");setInput(`Tell me more about ${selLesson.title}`);}} style={btn(true)}>Ask Coach →</button>
          <button onClick={()=>setPage("puzzles")} style={btn(false)}>Practice Puzzles</button>
        </div>
      </div>
    </div>
  ):(
    <div>
      <h2 style={{margin:"0 0 6px",color:C.gold}}>📚 Lesson Library</h2>
      <p style={{color:C.muted,margin:"0 0 22px"}}>Master chess concepts with structured lessons</p>
      {["Opening","Tactics","Strategy","Endgame"].map(cat=>{
        const cl=LESSONS.filter(l=>l.category===cat); if(!cl.length) return null;
        return (
          <div key={cat} style={{marginBottom:28}}>
            <h3 style={{margin:"0 0 12px",color:C.amber,fontSize:17,borderBottom:`1px solid ${C.border}`,paddingBottom:8}}>{cat}</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
              {cl.map(l=>(
                <div key={l.id} onClick={()=>setSelLesson(l)} style={{...card,cursor:"pointer",transition:"all 0.2s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=C.gold;e.currentTarget.style.transform="translateY(-2px)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.transform="";}}>
                  <div style={{fontSize:26,marginBottom:8}}>{l.icon}</div>
                  <div style={{display:"flex",gap:5,marginBottom:7}}>
                    <span style={{background:C.surface,border:`1px solid ${C.border}`,padding:"1px 7px",borderRadius:20,fontSize:11,color:C.muted}}>{l.difficulty}</span>
                    <span style={{color:C.muted,fontSize:11}}>⏱ {l.duration}</span>
                  </div>
                  <h4 style={{margin:"0 0 5px",fontSize:16}}>{l.title}</h4>
                  <p style={{margin:0,color:C.muted,fontSize:13,lineHeight:1.5}}>{l.description.substring(0,80)}...</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── PROGRESS
  const Progress=()=>{
    const wk=[42,68,55,78,83,71,73],days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],mx=Math.max(...wk);
    return (
      <div>
        <h2 style={{margin:"0 0 22px",color:C.gold}}>📈 Progress Report</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:22}}>
          {[{l:"Accuracy",v:`${stats.accuracy}%`,c:C.green},{l:"Puzzles",v:stats.puzzlesSolved,c:C.amber},{l:"Streak",v:`${stats.streak}d`,c:C.gold},{l:"Games",v:stats.gamesPlayed,c:C.blue}].map(s=>(
            <div key={s.l} style={card}><div style={{fontSize:26,fontWeight:700,color:s.c}}>{s.v}</div><div style={{fontSize:12,color:C.muted,marginTop:4}}>{s.l}</div></div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div style={card}>
            <h3 style={{margin:"0 0 18px",color:C.gold}}>Accuracy This Week</h3>
            <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120}}>
              {wk.map((v,i)=>(
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                  <div style={{fontSize:10,color:C.muted}}>{v}%</div>
                  <div style={{width:"100%",borderRadius:"3px 3px 0 0",background:v===mx?C.gold:C.amber,opacity:v===mx?1:0.5,height:`${(v/100)*95}px`,transition:"height 0.5s"}}/>
                  <div style={{fontSize:10,color:C.muted}}>{days[i]}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={card}>
            <h3 style={{margin:"0 0 14px",color:C.gold}}>Move Quality</h3>
            {[{l:"Best",c:C.green,p:50},{l:"Good",c:C.blue,p:31},{l:"Inaccuracies",c:C.amber,p:11},{l:"Blunders",c:C.red,p:3}].map(m=>(
              <div key={m.l} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}><span style={{color:m.c}}>{m.l}</span><span style={{color:C.muted}}>{m.p}%</span></div>
                <div style={{height:5,background:C.surface,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${m.p*2}%`,background:m.c,borderRadius:3,transition:"width 0.7s"}}/></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const nav=[{id:"dashboard",l:"Dashboard",i:"⬛"},{id:"play",l:"Play",i:"♟"},{id:"coach",l:"AI Coach",i:"🧠"},{id:"puzzles",l:"Puzzles",i:"⚡"},{id:"lessons",l:"Lessons",i:"📚"},{id:"progress",l:"Progress",i:"📈"}];
  const pages={dashboard:<Dashboard/>,play:<Play/>,coach:<Coach/>,puzzles:<Puzzles/>,lessons:<Lessons/>,progress:<Progress/>};

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"Georgia,serif",display:"flex"}}>
      <style>{`*{box-sizing:border-box;}::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:#1a1814;}::-webkit-scrollbar-thumb{background:#3a3228;border-radius:3px;}input::placeholder{color:#5a4a3a;}`}</style>

      {/* Sidebar */}
      <div style={{width:210,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",padding:"0 0 14px",flexShrink:0}}>
        <div style={{padding:"24px 18px 18px",borderBottom:`1px solid ${C.border}`,marginBottom:6}}>
          <div style={{fontSize:20,fontWeight:700,color:C.gold}}>♞ Chess Mentor</div>
          <div style={{fontSize:10,color:C.muted,marginTop:3,letterSpacing:2,textTransform:"uppercase"}}>AI Training</div>
        </div>
        {nav.map(n=>(
          <div key={n.id} onClick={()=>setPage(n.id)}
            style={{padding:"11px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,fontSize:14,background:page===n.id?"#2a2010":"transparent",color:page===n.id?C.gold:C.muted,borderLeft:page===n.id?`3px solid ${C.gold}`:"3px solid transparent",transition:"all 0.15s",marginBottom:1}}>
            <span>{n.i}</span>{n.l}
          </div>
        ))}
        <div style={{flex:1}}/>
        <div style={{padding:"14px 18px",borderTop:`1px solid ${C.border}`}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Skill Level</div>
          {["Beginner","Intermediate","Advanced"].map(l=>(
            <div key={l} onClick={()=>setLevel(l)} style={{padding:"4px 8px",borderRadius:5,fontSize:12,cursor:"pointer",background:level===l?"#2a2010":"transparent",color:level===l?C.gold:C.muted,border:`1px solid ${level===l?C.gold:"transparent"}`,marginBottom:3,transition:"all 0.15s"}}>{l}</div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,overflow:"auto",padding:28}}>
        {pages[page]??<Dashboard/>}
      </div>
    </div>
  );
}
