import { useState, useCallback, useEffect, useRef } from "react";

// ── Chess logic (pure JS, no external deps) ──────────────────────────────────
const FILES = ["a","b","c","d","e","f","g","h"];
const RANKS = [8,7,6,5,4,3,2,1];

function squareToIdx(sq) { return FILES.indexOf(sq[0]) + (8 - parseInt(sq[1])) * 8; }
function idxToSquare(i) { return FILES[i % 8] + RANKS[Math.floor(i / 8)]; }

const INIT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function parseFen(fen) {
  const parts = fen.split(" ");
  const board = Array(64).fill(null);
  let rank = 0, file = 0;
  for (const ch of parts[0]) {
    if (ch === "/") { rank++; file = 0; }
    else if (/\d/.test(ch)) { file += parseInt(ch); }
    else { board[rank * 8 + file] = ch; file++; }
  }
  return { board, turn: parts[1] || "w", castling: parts[2] || "-", ep: parts[3] || "-" };
}

function pieceColor(p) { return p && (p === p.toUpperCase() ? "w" : "b"); }
function pieceType(p) { return p && p.toLowerCase(); }

const PIECE_UNICODE = {
  K:"♔", Q:"♕", R:"♖", B:"♗", N:"♘", P:"♙",
  k:"♚", q:"♛", r:"♜", b:"♝", n:"♞", p:"♟"
};

// Simple legal-move generator (enough for UI drag+drop)
function getLegalMoves(board, sq, turn, ep, castling) {
  const idx = squareToIdx(sq);
  const piece = board[idx];
  if (!piece || pieceColor(piece) !== turn) return [];
  const pt = pieceType(piece);
  const moves = [];
  const inBounds = (r,f) => r>=0&&r<8&&f>=0&&f<8;
  const r0 = Math.floor(idx/8), f0 = idx%8;

  const push = (r,f) => {
    if (!inBounds(r,f)) return false;
    const ti = r*8+f;
    if (pieceColor(board[ti]) === turn) return false;
    moves.push(idxToSquare(ti));
    return !board[ti];
  };

  const slide = (dr,df) => {
    let r=r0+dr, f=f0+df;
    while(inBounds(r,f)) { if(!push(r,f)) break; r+=dr; f+=df; }
  };

  if (pt === "p") {
    const dir = turn === "w" ? -1 : 1;
    const startRank = turn === "w" ? 6 : 1;
    // forward
    if (!board[(r0+dir)*8+f0]) {
      moves.push(idxToSquare((r0+dir)*8+f0));
      if (r0 === startRank && !board[(r0+2*dir)*8+f0])
        moves.push(idxToSquare((r0+2*dir)*8+f0));
    }
    // captures
    for (const df of [-1,1]) {
      if (!inBounds(r0+dir, f0+df)) continue;
      const ti = (r0+dir)*8+(f0+df);
      const tsq = idxToSquare(ti);
      if (board[ti] && pieceColor(board[ti]) !== turn) moves.push(tsq);
      if (tsq === ep) moves.push(tsq);
    }
  } else if (pt === "n") {
    for (const [dr,df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) push(r0+dr,f0+df);
  } else if (pt === "b") {
    for (const [dr,df] of [[-1,-1],[-1,1],[1,-1],[1,1]]) slide(dr,df);
  } else if (pt === "r") {
    for (const [dr,df] of [[-1,0],[1,0],[0,-1],[0,1]]) slide(dr,df);
  } else if (pt === "q") {
    for (const [dr,df] of [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]) slide(dr,df);
  } else if (pt === "k") {
    for (const [dr,df] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) push(r0+dr,f0+df);
    // basic castling (no check detection for simplicity)
    if (turn === "w" && r0===7 && f0===4) {
      if (castling.includes("K") && !board[63] && !board[62] && !board[61]) moves.push("g1");
      if (castling.includes("Q") && !board[56] && !board[57] && !board[58] && !board[59]) moves.push("c1");
    }
    if (turn === "b" && r0===0 && f0===4) {
      if (castling.includes("k") && !board[7] && !board[6] && !board[5]) moves.push("g8");
      if (castling.includes("q") && !board[0] && !board[1] && !board[2] && !board[3]) moves.push("c8");
    }
  }
  return moves;
}

function applyMove(board, from, to, turn) {
  const nb = [...board];
  const fi = squareToIdx(from), ti = squareToIdx(to);
  const piece = nb[fi];
  nb[ti] = piece; nb[fi] = null;
  // promotion
  if (pieceType(piece)==="p" && (Math.floor(ti/8)===0||Math.floor(ti/8)===7))
    nb[ti] = turn==="w"?"Q":"q";
  // castling rook
  if (pieceType(piece)==="k") {
    if (from==="e1"&&to==="g1") { nb[61]=nb[63]=null; nb[61]="R"; nb[63]=null; nb[61]="R"; nb[63]=null; nb[squareToIdx("f1")]="R"; nb[squareToIdx("h1")]=null; }
    if (from==="e1"&&to==="c1") { nb[squareToIdx("d1")]="R"; nb[squareToIdx("a1")]=null; }
    if (from==="e8"&&to==="g8") { nb[squareToIdx("f8")]="r"; nb[squareToIdx("h8")]=null; }
    if (from==="e8"&&to==="c8") { nb[squareToIdx("d8")]="r"; nb[squareToIdx("a8")]=null; }
  }
  return nb;
}

// ── FEN builder from board state ─────────────────────────────────────────────
function buildFen(board, turn, castling, ep, halfMove, fullMove) {
  let fen = "";
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[r * 8 + f];
      if (p) { if (empty) { fen += empty; empty = 0; } fen += p; }
      else empty++;
    }
    if (empty) fen += empty;
    if (r < 7) fen += "/";
  }
  return `${fen} ${turn} ${castling || "-"} ${ep || "-"} ${halfMove || 0} ${fullMove || 1}`;
}

// ── Pure JS Chess AI (minimax + alpha-beta) — works on every mobile browser ──

// Piece-square tables (from White's perspective; flip rank for Black)
const PST = {
  p: [ 0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10,-20,-20, 10, 10,  5,
       5, -5,-10,  0,  0,-10, -5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5,  5, 10, 25, 25, 10,  5,  5,
      10, 10, 20, 30, 30, 20, 10, 10,
      50, 50, 50, 50, 50, 50, 50, 50,
       0,  0,  0,  0,  0,  0,  0,  0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -20,-10,-10,-10,-10,-10,-10,-20],
  r: [  0,  0,  0,  5,  5,  0,  0,  0,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
         5, 10, 10, 10, 10, 10, 10,  5,
         0,  0,  0,  0,  0,  0,  0,  0],
  q: [-20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -10,  5,  5,  5,  5,  5,  0,-10,
        0,  0,  5,  5,  5,  5,  0, -5,
       -5,  0,  5,  5,  5,  5,  0, -5,
      -10,  0,  5,  5,  5,  5,  0,-10,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20],
  k: [ 20, 30, 10,  0,  0, 10, 30, 20,
       20, 20,  0,  0,  0,  0, 20, 20,
      -10,-20,-20,-20,-20,-20,-20,-10,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30],
};

const PIECE_VALUE = { p:100, n:320, b:330, r:500, q:900, k:20000 };

function getAllMoves(board, turn, ep, castling) {
  const moves = [];
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || pieceColor(p) !== turn) continue;
    const sq = idxToSquare(i);
    const targets = getLegalMoves(board, sq, turn, ep, castling);
    for (const to of targets) moves.push({ from: sq, to });
  }
  return moves;
}

function evaluateBoard(board) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const pt = pieceType(p);
    const isWhite = pieceColor(p) === "w";
    const pstIdx = isWhite ? i : (7 - Math.floor(i / 8)) * 8 + (i % 8);
    const val = PIECE_VALUE[pt] + (PST[pt]?.[pstIdx] ?? 0);
    score += isWhite ? val : -val;
  }
  return score;
}

// Minimax with alpha-beta pruning
function minimax(board, depth, alpha, beta, maximizing, turn, ep, castling) {
  if (depth === 0) return evaluateBoard(board);
  const moves = getAllMoves(board, turn, ep, castling);
  if (moves.length === 0) return maximizing ? -99999 : 99999;
  const nextTurn = turn === "w" ? "b" : "w";
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const nb = applyMove(board, m.from, m.to, turn);
      const val = minimax(nb, depth - 1, alpha, beta, false, nextTurn, "-", castling);
      best = Math.max(best, val);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const nb = applyMove(board, m.from, m.to, turn);
      const val = minimax(nb, depth - 1, alpha, beta, true, nextTurn, "-", castling);
      best = Math.min(best, val);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// Depth and randomness by difficulty
const AI_CONFIG = {
  Beginner:     { depth: 1, randomness: 180 },
  Intermediate: { depth: 2, randomness: 40  },
  Advanced:     { depth: 3, randomness: 0   },
};

function getAIMove(board, turn, ep, castling, level) {
  const { depth, randomness } = AI_CONFIG[level] ?? AI_CONFIG.Intermediate;
  const moves = getAllMoves(board, turn, ep, castling);
  if (!moves.length) return null;

  const maximizing = turn === "w";
  let bestScore = maximizing ? -Infinity : Infinity;
  let bestMoves = [];

  for (const m of moves) {
    const nb = applyMove(board, m.from, m.to, turn);
    const score = minimax(nb, depth - 1, -Infinity, Infinity, !maximizing, turn === "w" ? "b" : "w", "-", castling);
    // add controlled noise for lower difficulties
    const noisyScore = score + (Math.random() * randomness - randomness / 2);
    if (maximizing ? noisyScore > bestScore : noisyScore < bestScore) {
      bestScore = noisyScore;
      bestMoves = [m];
    } else if (Math.abs(noisyScore - bestScore) < 5) {
      bestMoves.push(m);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)] ?? moves[0];
}

// ── Puzzle data ───────────────────────────────────────────────────────────────
const PUZZLES = [
  { id:1, title:"Fork Attack", fen:"r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4", solution:"f3g5", hint:"Knight to g5 attacks queen and f7!", theme:"Fork", difficulty:"Beginner" },
  { id:2, title:"Back Rank Mate", fen:"6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", solution:"d1d8", hint:"Deliver checkmate on the back rank!", theme:"Checkmate", difficulty:"Beginner" },
  { id:3, title:"Pin the Knight", fen:"r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6", solution:"c4f7", hint:"The f7 square is weak!", theme:"Pin", difficulty:"Intermediate" },
  { id:4, title:"Discovered Check", fen:"3r2k1/5ppp/8/3B4/8/8/5PPP/4R1K1 w - - 0 1", solution:"d5f7", hint:"Move the bishop to reveal a check!", theme:"Discovery", difficulty:"Intermediate" },
  { id:5, title:"Skewer the King", fen:"4k3/8/8/8/8/8/8/4K2R w - - 0 1", solution:"h1h8", hint:"Attack the king, win the rook!", theme:"Skewer", difficulty:"Beginner" },
];

// ── Lessons data ──────────────────────────────────────────────────────────────
const LESSONS = [
  { id:1, title:"Control the Center", category:"Opening", duration:"5 min", description:"Learn why controlling the center is the most important opening principle. The four central squares e4, d4, e5, d5 are the heart of the board.", content:"Place your pawns on e4 and d4 to control the center. Develop knights toward the center (Nf3, Nc3). Avoid moving the same piece twice in the opening. Castle early to protect your king.", icon:"⚔️", difficulty:"Beginner" },
  { id:2, title:"Piece Development", category:"Opening", duration:"7 min", description:"Understand why getting all your pieces out early wins games. Pieces on their starting squares have no power!", content:"Develop all pieces before attacking. Knights before bishops as a rule of thumb. Connect your rooks by castling. Don't bring your queen out too early.", icon:"🏰", difficulty:"Beginner" },
  { id:3, title:"Tactics: The Fork", category:"Tactics", duration:"8 min", description:"A fork attacks two or more pieces simultaneously. Knights are especially good at forking!", content:"A fork is when one piece attacks two enemy pieces at once. Knights excel at forks due to their unique movement. Always check if your knight can land on a square that attacks two valuable pieces.", icon:"⚡", difficulty:"Beginner" },
  { id:4, title:"The Pin and Skewer", category:"Tactics", duration:"10 min", description:"Pins immobilize pieces, skewers win material by attacking valuable pieces first.", content:"A pin is when a piece cannot move without exposing a more valuable piece. An absolute pin is against the king. A skewer forces a valuable piece to move, winning the piece behind it.", icon:"📌", difficulty:"Intermediate" },
  { id:5, title:"Pawn Structure", category:"Strategy", duration:"12 min", description:"Pawns are the soul of chess. Understanding pawn structures defines your long-term plans.", content:"Doubled pawns are weak. Isolated pawns have no pawn support. Passed pawns are powerful. Backward pawns cannot be defended by other pawns. Strong pawn structures create strong plans.", icon:"♟️", difficulty:"Intermediate" },
  { id:6, title:"King and Pawn Endgames", category:"Endgame", duration:"15 min", description:"Master the fundamental endgame: king activity and the opposition are key concepts.", content:"The king becomes a powerful piece in the endgame. The opposition is when two kings face each other. The rule of the square determines if a king can catch a pawn. Triangulation transfers the opposition.", icon:"👑", difficulty:"Intermediate" },
];

// ── AI Coach call ─────────────────────────────────────────────────────────────
async function askCoach(messages, position, level) {
  const systemPrompt = `You are Chess Mentor AI — a warm, expert chess coach adapting to ${level} players.
Current position FEN: ${position}
Keep responses concise (2-4 sentences), practical, and encouraging. Use chess terminology appropriately for ${level} level.
Focus on actionable advice. Use ♟ chess symbols when listing moves. Never be discouraging.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    })
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "Let me think about that position...";
}

// ── Chessboard Component ──────────────────────────────────────────────────────
function Chessboard({ board, turn, onMove, highlights = [], lastMove = null, size = 480 }) {
  const [selected, setSelected] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [dragging, setDragging] = useState(null);
  const [flipped] = useState(false);

  const sq = (i) => {
    const r = Math.floor(i / 8), f = i % 8;
    return flipped ? idxToSquare((7 - r) * 8 + (7 - f)) : idxToSquare(r * 8 + f);
  };

  const handleClick = (sqName) => {
    const idx = squareToIdx(sqName);
    const piece = board[idx];
    if (selected) {
      if (legalMoves.includes(sqName)) {
        onMove(selected, sqName);
        setSelected(null); setLegalMoves([]);
      } else if (piece && pieceColor(piece) === turn) {
        setSelected(sqName);
        setLegalMoves(getLegalMoves(board, sqName, turn, "-", "KQkq"));
      } else {
        setSelected(null); setLegalMoves([]);
      }
    } else if (piece && pieceColor(piece) === turn) {
      setSelected(sqName);
      setLegalMoves(getLegalMoves(board, sqName, turn, "-", "KQkq"));
    }
  };

  const sqSize = size / 8;

  return (
    <div style={{ display:"grid", gridTemplateColumns:`repeat(8,${sqSize}px)`, width:size, height:size, borderRadius:8, overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.5)", border:"3px solid #5a3e1b" }}>
      {Array.from({length:64},(_,i) => {
        const sqName = sq(i);
        const r = Math.floor(i/8), f = i%8;
        const isLight = (r+f)%2===0;
        const piece = board[squareToIdx(sqName)];
        const isSel = selected === sqName;
        const isLegal = legalMoves.includes(sqName);
        const isLast = lastMove && (lastMove.from===sqName||lastMove.to===sqName);
        const isHighlight = highlights.includes(sqName);
        const showFile = r===7;
        const showRank = f===0;

        let bg = isLight ? "#f0d9b5" : "#b58863";
        if (isSel) bg = isLight ? "#f6f669" : "#baca2b";
        if (isLast) bg = isLight ? "#cdd26a" : "#aaa23a";
        if (isHighlight) bg = "#e74c3c";

        return (
          <div key={sqName} onClick={() => handleClick(sqName)}
            style={{ width:sqSize, height:sqSize, background:bg, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", position:"relative", userSelect:"none" }}>
            {showRank && <span style={{ position:"absolute", top:2, left:3, fontSize:10, fontWeight:700, color: isLight?"#b58863":"#f0d9b5", fontFamily:"Georgia", lineHeight:1 }}>{sqName[1]}</span>}
            {showFile && <span style={{ position:"absolute", bottom:2, right:3, fontSize:10, fontWeight:700, color: isLight?"#b58863":"#f0d9b5", fontFamily:"Georgia", lineHeight:1 }}>{sqName[0]}</span>}
            {isLegal && (
              piece
                ? <div style={{ position:"absolute", inset:0, border:"4px solid rgba(20,85,30,0.5)", borderRadius:"50%", zIndex:1 }} />
                : <div style={{ width:sqSize*0.33, height:sqSize*0.33, borderRadius:"50%", background:"rgba(20,85,30,0.35)", zIndex:1 }} />
            )}
            {piece && (
              <span style={{ fontSize:sqSize*0.75, lineHeight:1, zIndex:2, filter:"drop-shadow(1px 1px 2px rgba(0,0,0,0.4))", transition:"transform 0.1s" }}>
                {PIECE_UNICODE[piece]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function ChessMentorAI() {
  const [page, setPage] = useState("dashboard");
  const [gameState, setGameState] = useState(() => parseFen(INIT_FEN));
  const [moveHistory, setMoveHistory] = useState([]);
  const [lastMove, setLastMove] = useState(null);
  const [coachMessages, setCoachMessages] = useState([
    { role:"assistant", content:"Welcome to Chess Mentor AI! ♟ I'm your personal coach. You can ask me about any position, opening ideas, tactics, or strategy. What would you like to work on today?" }
  ]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [playerLevel, setPlayerLevel] = useState("Intermediate");
  const [currentPuzzle, setCurrentPuzzle] = useState(0);
  const [puzzleState, setPuzzleState] = useState(() => parseFen(PUZZLES[0].fen));
  const [puzzleResult, setPuzzleResult] = useState(null);
  const [showHint, setShowHint] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [stats] = useState({ gamesPlayed:12, accuracy:73, puzzlesSolved:34, streak:5, totalMoves:287, blunders:8 });
  const [playerSide, setPlayerSide] = useState(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [gameOver, setGameOver] = useState(null);
  const [castlingRights, setCastlingRights] = useState("KQkq");
  const [epSquare, setEpSquare] = useState("-");
  const [fullMove, setFullMove] = useState(1);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [coachMessages]);

  const fenFromState = (gs) => buildFen(gs.board, gs.turn, castlingRights, epSquare, 0, fullMove);

  // ── Trigger AI move whenever it's the opponent's turn ──
  useEffect(() => {
    if (!playerSide || gameOver) return;
    if (gameState.turn === playerSide) return; // player's turn, do nothing
    setAiThinking(true);
    // Use setTimeout so React can re-render the "Thinking..." state before blocking
    const delay = { Beginner: 400, Intermediate: 600, Advanced: 900 }[playerLevel] ?? 600;
    const timer = setTimeout(() => {
      const move = getAIMove(gameState.board, gameState.turn, epSquare, castlingRights, playerLevel);
      setAiThinking(false);
      if (!move) { setGameOver("stalemate"); return; }
      const { from, to } = move;
      const piece = gameState.board[squareToIdx(from)];
      const nb = applyMove(gameState.board, from, to, gameState.turn);
      const nextTurn = gameState.turn === "w" ? "b" : "w";
      // update castling rights
      let cr = castlingRights;
      if (piece === "K") cr = cr.replace("K","").replace("Q","");
      if (piece === "k") cr = cr.replace("k","").replace("q","");
      if (from==="h1"||to==="h1") cr = cr.replace("K","");
      if (from==="a1"||to==="a1") cr = cr.replace("Q","");
      if (from==="h8"||to==="h8") cr = cr.replace("k","");
      if (from==="a8"||to==="a8") cr = cr.replace("q","");
      setCastlingRights(cr || "-");
      setEpSquare("-");
      if (nextTurn === "w") setFullMove(f => f + 1);
      setGameState(prev => ({ ...prev, board: nb, turn: nextTurn }));
      setLastMove({ from, to });
      setMoveHistory(h => [...h, `${PIECE_UNICODE[piece] ?? ""}${from}-${to}`]);
    }, delay);
    return () => clearTimeout(timer);
  }, [gameState.turn, playerSide, gameOver, playerLevel]);

  const handleBoardMove = (from, to) => {
    if (playerSide && gameState.turn !== playerSide) return;
    if (aiThinking || gameOver) return;
    const piece = gameState.board[squareToIdx(from)];
    const nb = applyMove(gameState.board, from, to, gameState.turn);
    const nextTurn = gameState.turn === "w" ? "b" : "w";
    // track castling rights
    let cr = castlingRights;
    if (piece === "K") cr = cr.replace("K","").replace("Q","");
    if (piece === "k") cr = cr.replace("k","").replace("q","");
    if (from==="h1"||to==="h1") cr = cr.replace("K","");
    if (from==="a1"||to==="a1") cr = cr.replace("Q","");
    if (from==="h8"||to==="h8") cr = cr.replace("k","");
    if (from==="a8"||to==="a8") cr = cr.replace("q","");
    setCastlingRights(cr || "-");
    // track en passant
    const fromR = Math.floor(squareToIdx(from)/8), toR = Math.floor(squareToIdx(to)/8);
    const fromF = squareToIdx(from)%8;
    if (pieceType(piece)==="p" && Math.abs(fromR-toR)===2) {
      const epR = (fromR+toR)/2;
      setEpSquare(idxToSquare(epR*8+fromF));
    } else setEpSquare("-");
    if (nextTurn === "w") setFullMove(f => f + 1);
    const newState = { ...gameState, board: nb, turn: nextTurn };
    setGameState(newState);
    setLastMove({from, to});
    setMoveHistory(h => [...h, `${PIECE_UNICODE[piece]}${from}-${to}`]);
  };

  const handlePuzzleMove = (from, to) => {
    const puzzle = PUZZLES[currentPuzzle];
    const correctFrom = puzzle.solution.slice(0,2);
    const correctTo = puzzle.solution.slice(2,4);
    if (from === correctFrom && to === correctTo) {
      const nb = applyMove(puzzleState.board, from, to, puzzleState.turn);
      setPuzzleState({...puzzleState, board:nb, turn:puzzleState.turn==="w"?"b":"w"});
      setPuzzleResult("correct");
    } else {
      setPuzzleResult("wrong");
      setTimeout(() => setPuzzleResult(null), 1500);
    }
  };

  const nextPuzzle = () => {
    const next = (currentPuzzle+1) % PUZZLES.length;
    setCurrentPuzzle(next);
    setPuzzleState(parseFen(PUZZLES[next].fen));
    setPuzzleResult(null);
    setShowHint(false);
  };

  const resetBoard = () => {
    setGameState(parseFen(INIT_FEN));
    setMoveHistory([]);
    setLastMove(null);
    setPlayerSide(null);
    setAiThinking(false);
    setGameOver(null);
    setCastlingRights("KQkq");
    setEpSquare("-");
    setFullMove(1);
  };

  const sendToCoach = async () => {
    if (!coachInput.trim() || coachLoading) return;
    const userMsg = { role:"user", content: coachInput };
    const newMessages = [...coachMessages, userMsg];
    setCoachMessages(newMessages);
    setCoachInput("");
    setCoachLoading(true);
    try {
      const reply = await askCoach(newMessages, fenFromState(gameState), playerLevel);
      setCoachMessages(m => [...m, { role:"assistant", content:reply }]);
    } catch {
      setCoachMessages(m => [...m, { role:"assistant", content:"I had trouble connecting. Please try again!" }]);
    }
    setCoachLoading(false);
  };

  // ── Styles ──
  const colors = {
    bg: "#0f0e0c", surface: "#1a1814", card: "#221f1a", border: "#3a3228",
    gold: "#c9a84c", amber: "#e8b84b", text: "#f0e6d3", muted: "#8a7a6a",
    green: "#4a9b5f", red: "#c0392b", blue: "#2980b9"
  };

  const navItems = [
    {id:"dashboard",label:"Dashboard",icon:"⬛"},
    {id:"play",label:"Play",icon:"♟"},
    {id:"coach",label:"AI Coach",icon:"🧠"},
    {id:"puzzles",label:"Puzzles",icon:"⚡"},
    {id:"lessons",label:"Lessons",icon:"📚"},
    {id:"progress",label:"Progress",icon:"📈"},
  ];

  const pageStyle = { minHeight:"100vh", background:colors.bg, color:colors.text, fontFamily:"'Georgia', serif", display:"flex" };
  const sidebarStyle = { width:220, background:colors.surface, borderRight:`1px solid ${colors.border}`, display:"flex", flexDirection:"column", padding:"0 0 16px" };
  const mainStyle = { flex:1, overflow:"auto", padding:32 };
  const cardStyle = { background:colors.card, border:`1px solid ${colors.border}`, borderRadius:12, padding:24 };
  const btnStyle = (active,color="#c9a84c") => ({
    background: active ? color : "transparent",
    color: active ? "#0f0e0c" : colors.text,
    border: `1px solid ${active ? color : colors.border}`,
    borderRadius:8, padding:"10px 20px", cursor:"pointer", fontSize:14,
    fontFamily:"Georgia,serif", fontWeight:active?700:400, transition:"all 0.2s"
  });

  // DASHBOARD
  const Dashboard = () => (
    <div>
      <div style={{ marginBottom:32 }}>
        <h1 style={{ fontSize:36, fontWeight:700, color:colors.gold, margin:0, letterSpacing:"-0.5px" }}>♞ Chess Mentor AI</h1>
        <p style={{ color:colors.muted, margin:"8px 0 0", fontSize:16 }}>Your personal chess training companion</p>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:20, marginBottom:32 }}>
        {[
          {label:"Games Played",value:stats.gamesPlayed,icon:"♟",color:colors.gold},
          {label:"Avg Accuracy",value:`${stats.accuracy}%`,icon:"🎯",color:colors.green},
          {label:"Puzzles Solved",value:stats.puzzlesSolved,icon:"⚡",color:colors.amber},
          {label:"Daily Streak",value:`${stats.streak} days`,icon:"🔥",color:colors.red},
          {label:"Total Moves",value:stats.totalMoves,icon:"↗",color:colors.blue},
          {label:"Blunders",value:stats.blunders,icon:"⚠",color:colors.muted},
        ].map(s => (
          <div key={s.label} style={{...cardStyle, textAlign:"center"}}>
            <div style={{ fontSize:28, marginBottom:8 }}>{s.icon}</div>
            <div style={{ fontSize:32, fontWeight:700, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:13, color:colors.muted, marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div style={cardStyle}>
          <h3 style={{ margin:"0 0 16px", color:colors.gold, fontSize:18 }}>Quick Actions</h3>
          {[
            {label:"▶  Play a Game",page:"play",desc:"Practice with the board"},
            {label:"🧠 Ask Your Coach",page:"coach",desc:"Get personalized advice"},
            {label:"⚡ Solve a Puzzle",page:"puzzles",desc:"Sharpen your tactics"},
            {label:"📚 Study a Lesson",page:"lessons",desc:"Learn new concepts"},
          ].map(a => (
            <div key={a.page} onClick={() => setPage(a.page)} style={{ padding:"12px 16px", borderRadius:8, border:`1px solid ${colors.border}`, marginBottom:10, cursor:"pointer", transition:"all 0.2s", background:"transparent" }}
              onMouseEnter={e => e.currentTarget.style.background = "#2a2520"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ fontWeight:600, marginBottom:2 }}>{a.label}</div>
              <div style={{ fontSize:12, color:colors.muted }}>{a.desc}</div>
            </div>
          ))}
        </div>
        <div style={cardStyle}>
          <h3 style={{ margin:"0 0 16px", color:colors.gold, fontSize:18 }}>Today's Puzzle</h3>
          <div style={{ background:"#1a1814", borderRadius:8, padding:16, marginBottom:16 }}>
            <div style={{ fontSize:13, color:colors.muted, marginBottom:4 }}>⚡ {PUZZLES[0].theme} — {PUZZLES[0].difficulty}</div>
            <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>{PUZZLES[0].title}</div>
            <div style={{ fontSize:13, color:colors.muted }}>{PUZZLES[0].hint}</div>
          </div>
          <button onClick={() => setPage("puzzles")} style={{...btnStyle(true), width:"100%"}}>Solve Puzzle →</button>
        </div>
      </div>
    </div>
  );

  // PLAY
  const Play = () => {
    // Side selection screen
    if (!playerSide) return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"70vh", gap:32 }}>
        <div style={{ textAlign:"center" }}>
          <h2 style={{ fontSize:32, color:colors.gold, margin:"0 0 8px" }}>Choose Your Side</h2>
          <p style={{ color:colors.muted, margin:0, fontSize:15 }}>You'll control only these pieces for the entire game</p>
        </div>
        <div style={{ display:"flex", gap:24 }}>
          {[
            { side:"w", label:"White", icon:"♔", desc:"You move first" },
            { side:"b", label:"Black", icon:"♚", desc:"AI moves first" },
          ].map(opt => (
            <div key={opt.side} onClick={() => setPlayerSide(opt.side)}
              style={{ ...cardStyle, width:200, textAlign:"center", cursor:"pointer", transition:"all 0.2s", padding:36 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=colors.gold; e.currentTarget.style.transform="translateY(-4px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=colors.border; e.currentTarget.style.transform=""; }}>
              <div style={{ fontSize:72, lineHeight:1, marginBottom:16, filter:"drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}>{opt.icon}</div>
              <div style={{ fontSize:22, fontWeight:700, color:colors.text, marginBottom:6 }}>{opt.label}</div>
              <div style={{ fontSize:13, color:colors.muted }}>{opt.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:13, color:colors.muted, marginBottom:10 }}>AI Difficulty</div>
          <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
            {["Beginner","Intermediate","Advanced"].map(l => (
              <button key={l} onClick={() => setPlayerLevel(l)} style={{...btnStyle(playerLevel===l), fontSize:13, padding:"8px 18px"}}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    );

    const isMyTurn = gameState.turn === playerSide;
    const opponentSide = playerSide === "w" ? "b" : "w";
    const opponentLabel = playerSide === "w" ? "⬛ Black (Stockfish AI)" : "⬜ White (Stockfish AI)";
    const playerLabel   = playerSide === "w" ? "⬜ You (White)" : "⬛ You (Black)";

    return (
      <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:24 }}>
        <div>
          {/* Opponent label */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, padding:"8px 14px", borderRadius:8, background:colors.surface, border:`1px solid ${aiThinking ? colors.amber : colors.border}`, fontSize:13, color:colors.muted, transition:"border-color 0.3s" }}>
            <span>{opponentLabel}</span>
            {aiThinking && (
              <span style={{ marginLeft:"auto", color:colors.amber, fontWeight:600, fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:colors.amber, animation:"pulse 1s infinite" }} />
                Thinking...
              </span>
            )}
          </div>

          {/* Board with game-over overlay */}
          <div style={{ position:"relative" }}>
            <Chessboard board={gameState.board} turn={gameState.turn} onMove={handleBoardMove} lastMove={lastMove} size={480} />
            {gameOver && (
              <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", borderRadius:8, gap:16 }}>
                <div style={{ fontSize:48 }}>{gameOver==="checkmate"?"♟":"½"}</div>
                <div style={{ fontSize:24, fontWeight:700, color:colors.gold }}>{gameOver==="checkmate" ? (isMyTurn?"You lost!":"You won!") : "Draw!"}</div>
                <div style={{ fontSize:14, color:colors.muted }}>{gameOver==="checkmate"?"Checkmate":"Stalemate / Draw"}</div>
                <button onClick={resetBoard} style={btnStyle(true)}>Play Again</button>
              </div>
            )}
          </div>

          {/* Player label */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10, padding:"8px 14px", borderRadius:8, background: isMyTurn && !gameOver?"#2a2010":colors.surface, border:`1px solid ${isMyTurn && !gameOver?colors.gold:colors.border}`, fontSize:13, color: isMyTurn && !gameOver?colors.gold:colors.muted, transition:"all 0.3s" }}>
            <span>{playerLabel}</span>
            {isMyTurn && !aiThinking && !gameOver && <span style={{ marginLeft:"auto", fontWeight:600, fontSize:12 }}>● Your turn</span>}
          </div>

          <div style={{ display:"flex", gap:10, marginTop:14 }}>
            <button onClick={resetBoard} style={btnStyle(false)}>↺ New Game</button>
            <button onClick={() => setPage("coach")} style={btnStyle(false)}>🧠 Ask Coach</button>
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={cardStyle}>
            <h3 style={{ margin:"0 0 12px", color:colors.gold }}>Game Info</h3>
            <div style={{ fontSize:13, color:colors.muted, marginBottom:4 }}>Playing as</div>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>{playerSide==="w"?"⬜ White":"⬛ Black"}</div>
            <div style={{ fontSize:13, color:colors.muted, marginBottom:8 }}>AI Difficulty</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {["Beginner","Intermediate","Advanced"].map(l => (
                <button key={l} onClick={() => setPlayerLevel(l)} style={{...btnStyle(playerLevel===l,"#c9a84c"), fontSize:12, padding:"6px 12px"}}>{l}</button>
              ))}
            </div>
            <div style={{ marginTop:14, padding:"10px 12px", borderRadius:8, background:colors.surface, border:`1px solid ${colors.border}`, fontSize:12, color:colors.muted }}>
              {playerLevel==="Beginner" && "🟢 Beginner: Makes frequent mistakes, great for learning"}
              {playerLevel==="Intermediate" && "🟡 Intermediate: Solid play, occasional blunders"}
              {playerLevel==="Advanced" && "🔴 Advanced: Strong tactical play, few mistakes"}
            </div>
          </div>

          <div style={{...cardStyle, flex:1, maxHeight:260, overflow:"auto"}}>
            <h3 style={{ margin:"0 0 12px", color:colors.gold }}>Move History</h3>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {moveHistory.length === 0
                ? <div style={{ color:colors.muted, fontSize:13 }}>No moves yet. {playerSide==="w"?"Make your first move!":"AI will move first..."}</div>
                : moveHistory.map((m,i) => (
                  <span key={i} style={{ background: i%2===(playerSide==="w"?0:1)?colors.surface:"#2a2010", border:`1px solid ${i%2===(playerSide==="w"?0:1)?colors.border:colors.gold}`, borderRadius:6, padding:"3px 8px", fontSize:13 }}>
                    {Math.floor(i/2)+1}{i%2===0?".":"..."}{m}
                  </span>
                ))}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ margin:"0 0 12px", color:colors.gold }}>Coach Tip</h3>
            <div style={{ fontSize:13, color:colors.muted, lineHeight:1.7 }}>
              {moveHistory.length < 4
                ? "🎯 Control the center with e4 or d4. Develop your knights first!"
                : moveHistory.length < 10
                ? "♗ Develop bishops and castle for king safety. Avoid moving pawns unnecessarily!"
                : "♛ Look for tactics — forks, pins, and discovered attacks!"}
            </div>
            <button onClick={() => setPage("coach")} style={{...btnStyle(false), marginTop:12, fontSize:12}}>Get full analysis →</button>
          </div>
        </div>
      </div>
    );
  };

  // COACH
  const Coach = () => (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:24, height:"calc(100vh - 100px)" }}>
      <div style={{ display:"flex", flexDirection:"column", ...cardStyle }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div>
            <h2 style={{ margin:0, color:colors.gold, fontSize:22 }}>🧠 AI Chess Coach</h2>
            <p style={{ margin:"4px 0 0", color:colors.muted, fontSize:13 }}>Powered by Claude — adapts to your level</p>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {["Beginner","Intermediate","Advanced"].map(l => (
              <button key={l} onClick={() => setPlayerLevel(l)} style={{...btnStyle(playerLevel===l), fontSize:12, padding:"6px 12px"}}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ flex:1, overflow:"auto", display:"flex", flexDirection:"column", gap:14, paddingRight:4, marginBottom:16 }}>
          {coachMessages.map((m,i) => (
            <div key={i} style={{ display:"flex", justifyContent: m.role==="user"?"flex-end":"flex-start" }}>
              <div style={{
                maxWidth:"75%", padding:"12px 16px", borderRadius: m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",
                background: m.role==="user" ? colors.gold : colors.surface,
                color: m.role==="user" ? "#0f0e0c" : colors.text,
                border: `1px solid ${m.role==="user" ? colors.gold : colors.border}`,
                fontSize:14, lineHeight:1.7
              }}>
                {m.role==="assistant" && <span style={{ fontSize:16, marginRight:6 }}>♞</span>}
                {m.content}
              </div>
            </div>
          ))}
          {coachLoading && (
            <div style={{ display:"flex", justifyContent:"flex-start" }}>
              <div style={{ background:colors.surface, border:`1px solid ${colors.border}`, borderRadius:"16px 16px 16px 4px", padding:"12px 20px", fontSize:14, color:colors.muted }}>
                ♞ Analyzing position<span style={{ animation:"pulse 1s infinite" }}>...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <input value={coachInput} onChange={e => setCoachInput(e.target.value)}
            onKeyDown={e => e.key==="Enter" && sendToCoach()}
            placeholder="Ask about openings, tactics, positions..."
            style={{ flex:1, background:colors.surface, border:`1px solid ${colors.border}`, borderRadius:10, padding:"12px 16px", color:colors.text, fontSize:14, fontFamily:"Georgia,serif", outline:"none" }} />
          <button onClick={sendToCoach} disabled={coachLoading || !coachInput.trim()}
            style={{...btnStyle(true), padding:"12px 20px", opacity: coachLoading ? 0.6 : 1}}>Send</button>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        <div style={cardStyle}>
          <h3 style={{ margin:"0 0 12px", color:colors.gold, fontSize:16 }}>Current Position</h3>
          <Chessboard board={gameState.board} turn={gameState.turn} onMove={handleBoardMove} size={280} />
        </div>
        <div style={cardStyle}>
          <h3 style={{ margin:"0 0 10px", color:colors.gold, fontSize:16 }}>Quick Questions</h3>
          {[
            "What's the best move here?",
            "Explain my pawn structure",
            "What opening should I play?",
            "How do I attack the king?",
          ].map(q => (
            <div key={q} onClick={() => setCoachInput(q)} style={{ padding:"8px 12px", borderRadius:6, border:`1px solid ${colors.border}`, marginBottom:8, cursor:"pointer", fontSize:13, transition:"all 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = colors.gold}
              onMouseLeave={e => e.currentTarget.style.borderColor = colors.border}>
              {q}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // PUZZLES
  const Puzzles = () => {
    const puzzle = PUZZLES[currentPuzzle];
    return (
      <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:24 }}>
        <div>
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ background:colors.gold, color:"#0f0e0c", padding:"4px 12px", borderRadius:20, fontSize:12, fontWeight:700 }}>{puzzle.theme}</span>
              <span style={{ background:colors.surface, border:`1px solid ${colors.border}`, padding:"4px 12px", borderRadius:20, fontSize:12 }}>{puzzle.difficulty}</span>
              <span style={{ color:colors.muted, fontSize:13 }}>{currentPuzzle+1}/{PUZZLES.length}</span>
            </div>
            <h2 style={{ margin:"10px 0 4px", color:colors.gold }}>{puzzle.title}</h2>
            <p style={{ margin:0, color:colors.muted, fontSize:14 }}>{puzzleState.turn==="w"?"⬜ White":"⬛ Black"} to move</p>
          </div>
          <Chessboard board={puzzleState.board} turn={puzzleState.turn} onMove={handlePuzzleMove} size={480}
            highlights={puzzleResult==="correct" ? [puzzle.solution.slice(2,4)] : []} />
          {puzzleResult && (
            <div style={{ marginTop:16, padding:"12px 20px", borderRadius:10, background: puzzleResult==="correct" ? "#1a4a2a" : "#4a1a1a", border:`1px solid ${puzzleResult==="correct"?"#4a9b5f":"#c0392b"}`, fontSize:15, fontWeight:600, color: puzzleResult==="correct"?colors.green:colors.red }}>
              {puzzleResult==="correct" ? "✓ Excellent! That's the winning move!" : "✗ Not quite — try again!"}
            </div>
          )}
          <div style={{ display:"flex", gap:10, marginTop:16 }}>
            <button onClick={() => setShowHint(!showHint)} style={btnStyle(showHint)}>💡 {showHint?"Hide":"Show"} Hint</button>
            {puzzleResult==="correct" && <button onClick={nextPuzzle} style={btnStyle(true)}>Next Puzzle →</button>}
          </div>
          {showHint && (
            <div style={{ marginTop:12, padding:"12px 16px", borderRadius:8, background:colors.surface, border:`1px solid ${colors.border}`, fontSize:14, color:colors.muted }}>
              💡 {puzzle.hint}
            </div>
          )}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={cardStyle}>
            <h3 style={{ margin:"0 0 12px", color:colors.gold }}>Puzzle List</h3>
            {PUZZLES.map((p,i) => (
              <div key={p.id} onClick={() => { setCurrentPuzzle(i); setPuzzleState(parseFen(p.fen)); setPuzzleResult(null); setShowHint(false); }}
                style={{ padding:"10px 14px", borderRadius:8, marginBottom:8, cursor:"pointer", border:`1px solid ${i===currentPuzzle?colors.gold:colors.border}`, background:i===currentPuzzle?"#2a2010":"transparent", transition:"all 0.15s" }}>
                <div style={{ fontWeight:i===currentPuzzle?700:400 }}>{p.title}</div>
                <div style={{ fontSize:12, color:colors.muted, marginTop:2 }}>{p.theme} · {p.difficulty}</div>
              </div>
            ))}
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin:"0 0 8px", color:colors.gold }}>Your Stats</h3>
            <div style={{ fontSize:13, color:colors.muted, lineHeight:2 }}>
              <div>Puzzles solved: <strong style={{color:colors.text}}>{stats.puzzlesSolved}</strong></div>
              <div>Success rate: <strong style={{color:colors.green}}>78%</strong></div>
              <div>Best theme: <strong style={{color:colors.text}}>Forks</strong></div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // LESSONS
  const Lessons = () => (
    selectedLesson ? (
      <div>
        <button onClick={() => setSelectedLesson(null)} style={{...btnStyle(false), marginBottom:20}}>← Back to Lessons</button>
        <div style={{...cardStyle, maxWidth:700}}>
          <div style={{ fontSize:40, marginBottom:12 }}>{selectedLesson.icon}</div>
          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            <span style={{ background:colors.gold, color:"#0f0e0c", padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:700 }}>{selectedLesson.category}</span>
            <span style={{ background:colors.surface, border:`1px solid ${colors.border}`, padding:"3px 10px", borderRadius:20, fontSize:12 }}>{selectedLesson.difficulty}</span>
            <span style={{ color:colors.muted, fontSize:12 }}>⏱ {selectedLesson.duration}</span>
          </div>
          <h2 style={{ margin:"0 0 12px", color:colors.gold, fontSize:28 }}>{selectedLesson.title}</h2>
          <p style={{ color:colors.muted, fontSize:16, lineHeight:1.7, marginBottom:24 }}>{selectedLesson.description}</p>
          <div style={{ background:colors.surface, borderRadius:10, padding:20, border:`1px solid ${colors.border}` }}>
            <h3 style={{ margin:"0 0 12px", color:colors.amber, fontSize:16 }}>Key Points</h3>
            {selectedLesson.content.split(".").filter(s=>s.trim()).map((point,i) => (
              <div key={i} style={{ display:"flex", gap:12, marginBottom:10, fontSize:14, lineHeight:1.6 }}>
                <span style={{ color:colors.gold, fontWeight:700, minWidth:20 }}>{i+1}.</span>
                <span>{point.trim()}.</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:20, display:"flex", gap:12 }}>
            <button onClick={() => { setPage("coach"); setCoachInput(`Teach me more about ${selectedLesson.title}`); }} style={btnStyle(true)}>
              Ask Coach About This →
            </button>
            <button onClick={() => { setPage("puzzles"); }} style={btnStyle(false)}>Practice with Puzzles</button>
          </div>
        </div>
      </div>
    ) : (
      <div>
        <h2 style={{ margin:"0 0 8px", color:colors.gold }}>📚 Lesson Library</h2>
        <p style={{ color:colors.muted, margin:"0 0 24px" }}>Master chess concepts with structured lessons</p>
        {["Opening","Tactics","Strategy","Endgame"].map(cat => {
          const catLessons = LESSONS.filter(l => l.category===cat);
          if (!catLessons.length) return null;
          return (
            <div key={cat} style={{ marginBottom:32 }}>
              <h3 style={{ margin:"0 0 14px", color:colors.amber, fontSize:18, borderBottom:`1px solid ${colors.border}`, paddingBottom:10 }}>{cat}</h3>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:16 }}>
                {catLessons.map(lesson => (
                  <div key={lesson.id} onClick={() => setSelectedLesson(lesson)}
                    style={{...cardStyle, cursor:"pointer", transition:"all 0.2s"}}
                    onMouseEnter={e => { e.currentTarget.style.borderColor=colors.gold; e.currentTarget.style.transform="translateY(-2px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor=colors.border; e.currentTarget.style.transform=""; }}>
                    <div style={{ fontSize:28, marginBottom:10 }}>{lesson.icon}</div>
                    <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                      <span style={{ background:colors.surface, border:`1px solid ${colors.border}`, padding:"2px 8px", borderRadius:20, fontSize:11, color:colors.muted }}>{lesson.difficulty}</span>
                      <span style={{ color:colors.muted, fontSize:11 }}>⏱ {lesson.duration}</span>
                    </div>
                    <h4 style={{ margin:"0 0 6px", fontSize:17, color:colors.text }}>{lesson.title}</h4>
                    <p style={{ margin:0, color:colors.muted, fontSize:13, lineHeight:1.6 }}>{lesson.description.substring(0,80)}...</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    )
  );

  // PROGRESS
  const Progress = () => {
    const weekData = [42,68,55,78,83,71,73];
    const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const maxVal = Math.max(...weekData);
    return (
      <div>
        <h2 style={{ margin:"0 0 24px", color:colors.gold }}>📈 Progress Report</h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:24 }}>
          {[
            {label:"Accuracy",value:`${stats.accuracy}%`,change:"+5%",color:colors.green},
            {label:"Puzzles",value:stats.puzzlesSolved,change:"+8",color:colors.amber},
            {label:"Streak",value:`${stats.streak}d`,change:"🔥",color:colors.gold},
            {label:"Games",value:stats.gamesPlayed,change:"+3",color:colors.blue},
          ].map(s => (
            <div key={s.label} style={cardStyle}>
              <div style={{ fontSize:28, fontWeight:700, color:s.color }}>{s.value}</div>
              <div style={{ fontSize:13, color:colors.muted, margin:"4px 0" }}>{s.label}</div>
              <div style={{ fontSize:12, color:colors.green }}>{s.change} this week</div>
            </div>
          ))}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
          <div style={cardStyle}>
            <h3 style={{ margin:"0 0 20px", color:colors.gold }}>Accuracy This Week</h3>
            <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:140 }}>
              {weekData.map((v,i) => (
                <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                  <div style={{ fontSize:11, color:colors.muted }}>{v}%</div>
                  <div style={{ width:"100%", borderRadius:"4px 4px 0 0", background: v===maxVal ? colors.gold : colors.amber, opacity: v===maxVal?1:0.5, height:`${(v/100)*110}px`, transition:"height 0.5s" }} />
                  <div style={{ fontSize:11, color:colors.muted }}>{days[i]}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin:"0 0 16px", color:colors.gold }}>Move Quality</h3>
            {[
              {label:"Best Moves",count:143,color:colors.green,pct:50},
              {label:"Good Moves",count:89,color:colors.blue,pct:31},
              {label:"Inaccuracies",count:32,color:colors.amber,pct:11},
              {label:"Blunders",count:stats.blunders,color:colors.red,pct:3},
            ].map(m => (
              <div key={m.label} style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:5 }}>
                  <span style={{color:m.color}}>{m.label}</span>
                  <span style={{color:colors.muted}}>{m.count} ({m.pct}%)</span>
                </div>
                <div style={{ height:6, background:colors.surface, borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${m.pct*2}%`, background:m.color, borderRadius:3, transition:"width 0.7s" }} />
                </div>
              </div>
            ))}
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin:"0 0 16px", color:colors.gold }}>Weakness Analysis</h3>
            <p style={{ color:colors.muted, fontSize:13, marginBottom:16 }}>Areas to focus on based on your games:</p>
            {[
              {area:"Endgame technique",severity:"High",icon:"⚠"},
              {area:"Tactical alertness",severity:"Medium",icon:"⚡"},
              {area:"Time management",severity:"Medium",icon:"⏱"},
              {area:"Opening preparation",severity:"Low",icon:"📖"},
            ].map(w => (
              <div key={w.area} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${colors.border}`, fontSize:13 }}>
                <span>{w.icon} {w.area}</span>
                <span style={{ color: w.severity==="High"?colors.red:w.severity==="Medium"?colors.amber:colors.green, fontSize:12, fontWeight:600 }}>{w.severity}</span>
              </div>
            ))}
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin:"0 0 16px", color:colors.gold }}>Study Plan</h3>
            <p style={{ color:colors.muted, fontSize:13, marginBottom:16 }}>Personalized based on your weaknesses:</p>
            {[
              {task:"Solve 5 endgame puzzles",done:true},
              {task:"Review king and pawn lesson",done:true},
              {task:"Play 2 practice games",done:false},
              {task:"Study tactical patterns",done:false},
              {task:"Analyze 1 master game",done:false},
            ].map(t => (
              <div key={t.task} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", fontSize:13, borderBottom:`1px solid ${colors.border}` }}>
                <span style={{ color: t.done?colors.green:colors.muted, fontSize:16 }}>{t.done?"✓":"○"}</span>
                <span style={{ textDecoration: t.done?"line-through":"none", color: t.done?colors.muted:colors.text }}>{t.task}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const pages = { dashboard:<Dashboard/>, play:<Play/>, coach:<Coach/>, puzzles:<Puzzles/>, lessons:<Lessons/>, progress:<Progress/> };

  return (
    <div style={pageStyle}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #1a1814; }
        ::-webkit-scrollbar-thumb { background: #3a3228; border-radius: 3px; }
        input::placeholder { color: #5a4a3a; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      {/* Sidebar */}
      <div style={sidebarStyle}>
        <div style={{ padding:"28px 20px 20px", borderBottom:`1px solid ${colors.border}`, marginBottom:8 }}>
          <div style={{ fontSize:22, fontWeight:700, color:colors.gold, letterSpacing:"-0.5px" }}>♞ Chess Mentor</div>
          <div style={{ fontSize:11, color:colors.muted, marginTop:4, letterSpacing:2, textTransform:"uppercase" }}>AI Training Platform</div>
        </div>
        {navItems.map(n => (
          <div key={n.id} onClick={() => setPage(n.id)}
            style={{ padding:"12px 20px", cursor:"pointer", display:"flex", alignItems:"center", gap:12, fontSize:14,
              background: page===n.id ? "#2a2010" : "transparent",
              color: page===n.id ? colors.gold : colors.muted,
              borderLeft: page===n.id ? `3px solid ${colors.gold}` : "3px solid transparent",
              transition:"all 0.15s", marginBottom:2
            }}>
            <span style={{ fontSize:16 }}>{n.icon}</span>
            {n.label}
          </div>
        ))}
        <div style={{ flex:1 }} />
        <div style={{ padding:"16px 20px", borderTop:`1px solid ${colors.border}` }}>
          <div style={{ fontSize:12, color:colors.muted, marginBottom:8 }}>Skill Level</div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {["Beginner","Intermediate","Advanced"].map(l => (
              <div key={l} onClick={() => setPlayerLevel(l)} style={{ padding:"5px 10px", borderRadius:6, fontSize:12, cursor:"pointer", background: playerLevel===l?"#2a2010":"transparent", color: playerLevel===l?colors.gold:colors.muted, border:`1px solid ${playerLevel===l?colors.gold:"transparent"}`, transition:"all 0.15s" }}>{l}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={mainStyle}>
        {pages[page] || <Dashboard/>}
      </div>
    </div>
  );
}
