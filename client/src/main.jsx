import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const sharks = {
  dealmaker: { name: "The DealMaker", role: "Market & Money", icon: "💰", avatar: "/avatars/dealmaker.svg", color: "gold" },
  product: { name: "The Product Shark", role: "Product & Customer", icon: "🎯", avatar: "/avatars/product.svg", color: "blue" },
  skeptic: { name: "The Skeptic", role: "Risk & Competition", icon: "🔥", avatar: "/avatars/skeptic.svg", color: "red" }
};

const INITIAL_SHARK_HEAT = { dealmaker: 50, product: 50, skeptic: 50 };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const sharkState = (heat) => heat <= 0 ? "OUT" : heat <= 20 ? "READY TO WALK" : heat <= 34 ? "ON EDGE" : "IN";
const heatLabel = (heat) => heat >= 85 ? "FIRED UP" : heat >= 65 ? "INTERESTED" : heat >= 45 ? "LISTENING" : heat >= 25 ? "ON EDGE" : "DONE";

const initialPitch = {
  startupName: "", problem: "", solution: "", targetCustomer: "", businessModel: "", fundingAsk: "", fullPitch: ""
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function request(path, options) {
  let response;
  try { response = await fetch(path, options); }
  catch { throw new Error("Can't reach the server. Is `npm run dev` still running?"); }
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON body */ }
  if (!response.ok) throw new Error(data?.error || `The server returned an error (${response.status}). Check the server terminal.`);
  if (!data) throw new Error("The server sent an empty response. Check the server terminal.");
  return data;
}

const postJson = (path, body) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function VoiceInput({ onText, disabled }) {
  const recognitionRef = useRef(null);
  const onTextRef = useRef(onText);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);

  // Keep the latest callback without re-creating the recognizer on every render
  // (re-creating it used to cut the microphone off mid-sentence).
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    setSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) text += event.results[i][0]?.transcript || "";
      if (text.trim()) onTextRef.current(text.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    return () => { try { recognition.abort(); } catch { /* already stopped */ } };
  }, []);

  useEffect(() => { if (disabled && listening) { try { recognitionRef.current?.stop(); } catch { /* noop */ } } }, [disabled, listening]);

  if (!supported) return null;
  return (
    <button type="button" className={`mic-button ${listening ? "listening" : ""}`} disabled={disabled} onClick={() => {
      if (listening) { recognitionRef.current?.stop(); return; }
      try { recognitionRef.current?.start(); setListening(true); } catch { setListening(false); }
    }} aria-label={listening ? "Stop voice input" : "Use voice input"} title={listening ? "Stop listening" : "Speak your answer"}>
      <span>{listening ? "■" : "🎙️"}</span>
    </button>
  );
}

function ModeBadge({ mode }) {
  if (!mode) return null;
  const live = mode === "ai";
  return (
    <span className={`mode-badge ${live ? "live" : "demo"}`} title={live ? "Sharks are powered by Gemini" : "No valid GEMINI_API_KEY found, so the offline panel is running. Add a key in server/.env for live AI."}>
      <i />{live ? "LIVE AI" : "OFFLINE PANEL"}
    </span>
  );
}

function App() {
  const [screen, setScreen] = useState("landing");
  const [pitch, setPitch] = useState(initialPitch);
  const [pitchMode, setPitchMode] = useState("form");
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState("");
  const [score, setScore] = useState(50);
  const [scoreFlash, setScoreFlash] = useState(null);
  const [mode, setMode] = useState(null); // "ai" | "local"
  const [sharkHeat, setSharkHeat] = useState(INITIAL_SHARK_HEAT);
  const [sharkEvents, setSharkEvents] = useState([]);

  const activePitchRef = useRef(initialPitch); // the pitch actually sent to the sharks
  const runRef = useRef(0);                    // invalidates in-flight requests when a new run starts
  const scrollRef = useRef(null);
  const answerRef = useRef(null);

  useEffect(() => {
    request("/api/health").then(h => setMode(h.mode)).catch(() => {});
  }, []);

  // Keep the newest message in view and put the cursor in the answer box.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [history, current, loading]);
  useEffect(() => { if (current && !loading) answerRef.current?.focus(); }, [current, loading]);

  function update(field, value) { setPitch(p => ({ ...p, [field]: value })); }

  function resetRun() {
    runRef.current += 1;
    setHistory([]); setCurrent(null); setEvaluation(null); setAnswer(""); setScore(50); setScoreFlash(null); setError(""); setLoading(false);
    setSharkHeat(INITIAL_SHARK_HEAT); setSharkEvents([]);
  }

  function startPitch(pitchKind) {
    let active;
    if (pitchKind === "form") {
      if (!pitch.startupName.trim() || !pitch.problem.trim() || !pitch.solution.trim() || !pitch.targetCustomer.trim()) {
        setError("Give us the startup name, problem, solution and target customer first."); return;
      }
      active = { ...pitch, fullPitch: "" };
    } else {
      if (!pitch.fullPitch.trim()) { setError("Give the sharks something to work with in your free-form pitch."); return; }
      // Free-form pitch: don't leak half-filled form fields into the sharks' context.
      active = { ...initialPitch, fullPitch: pitch.fullPitch };
    }
    setError("");
    resetRun();
    activePitchRef.current = active;
    setScreen("arena");
    askQuestion([], null, 50, runRef.current);
  }

  async function askQuestion(nextHistory, lastAnswer, currentScore, runId = runRef.current) {
    setLoading(true); setError("");
    try {
      const q = await postJson("/api/question", { pitch: activePitchRef.current, history: nextHistory, lastAnswer, currentScore, sharkHeat });
      if (runId !== runRef.current) return;
      if (q.source) setMode(q.source);

      let working = nextHistory;
      let newScore = currentScore;
      if (lastAnswer) {
        // Pin the shark's reaction and the score swing to the answer it was about, so it stays in the thread.
        working = nextHistory.map((item, i) => i === nextHistory.length - 1
          ? { ...item, reaction: q.sharkResponse ? { shark: q.responseShark || item.shark, text: q.sharkResponse } : null, scoreDelta: q.scoreDelta || 0, panelConflict: q.panelConflict || "", attackTarget: q.attackTarget || item.topic, pressure: q.pressure || 0, dodged: Boolean(q.dodged) }
          : item);
        setHistory(working);
        if (q.scoreDelta) {
          newScore = clamp(currentScore + q.scoreDelta, 0, 100);
          setScore(newScore);
          setScoreFlash({ delta: q.scoreDelta, reason: q.scoreReason });
          setTimeout(() => setScoreFlash(null), 2200);
        }
        if (q.responseShark && !isNaN(Number(q.sharkHeatDelta))) {
          const shark = q.responseShark;
          const heatDelta = clamp(Number(q.sharkHeatDelta), -18, 12);
          setSharkHeat(prev => ({ ...prev, [shark]: clamp((prev[shark] ?? 50) + heatDelta, 0, 100) }));
          setSharkEvents(prev => [...prev.slice(-7), { shark, delta: heatDelta, reason: q.sharkHeatReason || q.scoreReason, walkedOut: Boolean(q.sharkWalkedOut) }]);
        }
        // A short beat so the shark's reaction lands before the next question appears.
        if (q.sharkResponse) await sleep(1100);
        if (runId !== runRef.current) return;
      }

      if (q.type === "finish") { await finish(working, newScore, runId); return; }
      setCurrent(q); setAnswer("");
    } catch (err) {
      if (runId === runRef.current) setError(err.message);
    } finally {
      if (runId === runRef.current) setLoading(false);
    }
  }

  async function submitAnswer(e) {
    e?.preventDefault();
    if (!current || !answer.trim() || loading) return;
    const text = answer.trim();
    const nextHistory = [...history, { shark: current.shark, question: current.question, topic: current.topic, answer: text }];
    setHistory(nextHistory);
    setAnswer("");
    setCurrent(null); // the question now lives in the thread; don't render it twice
    await askQuestion(nextHistory, text, score);
  }

  async function finish(finalHistory = history, liveScore = score, runId = runRef.current) {
    if (!finalHistory.length) { setError("Answer at least one question before calling the verdict."); return; }
    setLoading(true); setError("");
    try {
      const result = await postJson("/api/evaluate", { pitch: activePitchRef.current, history: finalHistory, liveScore });
      if (runId !== runRef.current) return;
      if (result.source) setMode(result.source);
      setEvaluation(result); setScreen("results");
    } catch (err) {
      if (runId === runRef.current) setError(err.message);
    } finally {
      if (runId === runRef.current) setLoading(false);
    }
  }

  function retry() {
    const last = history.at(-1);
    if (!last) { startPitch(activePitchRef.current.fullPitch ? "free" : "form"); return; }
    // If the last answer already got a reaction, the question call worked and the verdict call failed.
    if ("reaction" in last) finish(history, score);
    else askQuestion(history, last.answer, score);
  }

  const setVoiceText = useCallback((text) => setAnswer(prev => prev ? `${prev} ${text}` : text), []);
  const onAnswerKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitAnswer(); } };

  if (screen === "landing") return (
    <main className="shell landing">
      <div className="brand">PROMPTWARS / THE PROMPT ARENA <ModeBadge mode={mode} /></div>
      <div className="hero">
        <div className="eyebrow pulse">AI INVESTOR SIMULATION</div>
        <h1>Pitch your idea.<br /><span>Survive the sharks.</span></h1>
        <p className="lead">Three AI investors. One startup. No polite questions. Defend your idea, adapt under pressure, and leave with a pitch that can actually survive.</p>
        <button className="primary big" onClick={() => setScreen("pitch")}>Enter the Tank <span>→</span></button>
      </div>
      <div className="shark-strip">{Object.entries(sharks).map(([key, shark]) => <div className="shark-card" key={key}><img className="shark-avatar small" src={shark.avatar} alt="" /><div><strong>{shark.name}</strong><small>{shark.role}</small></div></div>)}</div>
    </main>
  );

  if (screen === "pitch") return (
    <main className="shell">
      <header className="topbar"><button className="back" onClick={() => setScreen("landing")}>← Back</button><span>01 / PITCH</span></header>
      <section className="section pitch-section">
        <div className="eyebrow">THE FOUNDER</div>
        <h2>Give the sharks something to attack.</h2>
        <p className="muted">Choose how you want to pitch. You can structure it or just talk it out.</p>
        <div className="pitch-options">
          <form className={`pitch-method ${pitchMode === "form" ? "selected" : ""}`} onSubmit={e => { e.preventDefault(); setPitchMode("form"); startPitch("form"); }}>
            <div className="method-head"><span className="method-icon">▦</span><div><h3>Build your pitch</h3><p>Give the sharks the important details.</p></div></div>
            <label>Startup name<input value={pitch.startupName} onChange={e => update("startupName", e.target.value)} placeholder="e.g. CampusBite" /></label>
            <label>What problem are you solving?<textarea value={pitch.problem} onChange={e => update("problem", e.target.value)} placeholder="What painful problem exists today?" /></label>
            <label>What is your solution?<textarea value={pitch.solution} onChange={e => update("solution", e.target.value)} placeholder="What are you building?" /></label>
            <label>Who is the target customer?<textarea value={pitch.targetCustomer} onChange={e => update("targetCustomer", e.target.value)} placeholder="Who is your first customer?" /></label>
            <label>How will you make money? <span className="optional">optional</span><textarea value={pitch.businessModel} onChange={e => update("businessModel", e.target.value)} placeholder="Subscription, transaction fee, B2B..." /></label>
            <label>Funding ask <span className="optional">optional</span><input value={pitch.fundingAsk} onChange={e => update("fundingAsk", e.target.value)} placeholder="e.g. ₹10 lakh for 10%" /></label>
            <button className="primary" type="submit">Continue with this pitch →</button>
          </form>
          <div className="or-divider"><span>OR</span></div>
          <form className={`pitch-method free ${pitchMode === "free" ? "selected" : ""}`} onSubmit={e => { e.preventDefault(); setPitchMode("free"); startPitch("free"); }}>
            <div className="method-head"><span className="method-icon">🎙</span><div><h3>Pitch it your way</h3><p>Say everything you think the sharks should know.</p></div></div>
            <textarea className="free-pitch" value={pitch.fullPitch} onChange={e => update("fullPitch", e.target.value)} placeholder="Imagine the sharks are sitting in front of you. Tell them what you're building, who needs it, why now, how it works, how you'll make money, what you're asking for — anything they should know..." />
            <button className="primary" type="submit">Continue with free pitch →</button>
          </form>
        </div>
        {error && <div className="error">{error}</div>}
      </section>
    </main>
  );

  if (screen === "arena") return (
    <main className="shell arena">
      <header className="topbar"><button className="back" onClick={() => { runRef.current += 1; setLoading(false); setScreen("pitch"); }}>← Edit pitch</button><span className="topbar-right"><ModeBadge mode={mode} />02 / THE TANK</span></header>
      <div className="tank-header">
        <div><div className="eyebrow">LIVE INVESTOR PANEL</div><h1>{activePitchRef.current.startupName || "Your startup"}</h1><p className="tank-subtitle">Three investors. One pitch. Every answer changes the room.</p></div>
        <div className={`live-score ${scoreFlash ? (scoreFlash.delta >= 0 ? "up" : "down") : ""}`}><span>🔥 PITCH HEAT</span><strong>{score}</strong><small>/100</small>{scoreFlash && <em>{scoreFlash.delta >= 0 ? "+" : ""}{scoreFlash.delta}</em>}</div>
      </div>
      <div className="investor-panel" aria-label="Investor panel">
        {Object.entries(sharks).map(([key, shark]) => {
          const heat = sharkHeat[key] ?? 50;
          const state = sharkState(heat);
          const active = current?.shark === key;
          const reacting = history.at(-1)?.reaction?.shark === key && !current;
          const lastEvent = [...sharkEvents].reverse().find(e => e.shark === key);
          return <div className={`investor ${shark.color} ${active ? "active" : ""} ${reacting ? "reacting" : ""} ${state === "OUT" ? "walked-out" : ""}`} key={key}>
            <div className="investor-avatar-wrap"><img className="investor-avatar" src={shark.avatar} alt={`${shark.name} avatar`} />{state === "OUT" && <span className="out-stamp">OUT</span>}</div>
            <div className="investor-copy"><div className="investor-name">{shark.name}</div><div className="investor-role">{shark.role}</div><div className="investor-status"><span className="mini-fire">🔥</span><strong>{heat}</strong><span>/100</span><b className={`status-${state.toLowerCase().replaceAll(" ", "-")}`}>{state}</b></div><div className="personal-heat"><i style={{width:`${heat}%`}} /></div><small className="heat-label">{heatLabel(heat)}{lastEvent ? ` · ${lastEvent.delta > 0 ? "+" : ""}${lastEvent.delta}` : ""}</small></div>
          </div>;
        })}
      </div>
      <section className="conversation-panel">
        <div className="conversation-scroll" ref={scrollRef}>
          {history.map((item, i) => <React.Fragment key={i}>
            <div className="message shark-message"><img src={sharks[item.shark].avatar} alt={`${sharks[item.shark].name} avatar`} className="shark-avatar message-avatar" /><div><b>{sharks[item.shark].name}</b><p>{item.question}</p></div></div>
            <div className="message founder-message"><span>YOU</span><div><b>You</b><p>{item.answer}</p></div></div>
            {item.reaction && <div className="message shark-message reaction-message" aria-live="polite"><img src={sharks[item.reaction.shark].avatar} alt={`${sharks[item.reaction.shark].name} avatar`} className="shark-avatar message-avatar" /><div><b>{sharks[item.reaction.shark].name}</b><small>{item.dodged ? "you didn't answer" : "reacting"}</small>{typeof item.scoreDelta === "number" && item.scoreDelta !== 0 && <span className={`score-chip ${item.scoreDelta > 0 ? "up" : "down"}`}>{item.scoreDelta > 0 ? "+" : ""}{item.scoreDelta} heat</span>}<p>{item.reaction.text}</p>{item.attackTarget && <small className="attack-line">ATTACKING: {item.attackTarget}{item.pressure ? ` · PRESSURE ${item.pressure}` : ""}</small>}</div></div>}{item.panelConflict && <div className="panel-conflict"><span>⚔</span><p>{item.panelConflict}</p></div>}
          </React.Fragment>)}
          {current && <div className="message shark-message latest"><img src={sharks[current.shark].avatar} alt={`${sharks[current.shark].name} avatar`} className="shark-avatar message-avatar" /><div><b>{current.sharkName}</b><small>{current.difficulty} · {current.focus}</small><p>{current.question}</p><div className="pressure-line"><span>PRESSURE {current.pressure ?? 0}</span><span>ATTACKING: {current.attackTarget || current.focus}</span></div></div></div>}
          {!current && !loading && history.length === 0 && !error && <div className="tank-intro"><div className="big-shark">🦈</div><h2>They're looking at your pitch.</h2><p>The first question is coming.</p></div>}
          {loading && !current && <div className="thinking"><span></span><span></span><span></span><em>{history.length ? "The panel is conferring..." : "The panel is reading your pitch..."}</em></div>}
        </div>
        <form className="answer-bar" onSubmit={submitAnswer}>
          <textarea aria-label="Answer the sharks" ref={answerRef} value={answer} onChange={e => setAnswer(e.target.value)} onKeyDown={onAnswerKeyDown} placeholder={current ? "Answer the sharks... (Enter to send, Shift+Enter for a new line)" : "Wait for the next question..."} disabled={!current || loading} />
          <div className="answer-actions"><VoiceInput onText={setVoiceText} disabled={!current || loading} /><button className="send-button" disabled={!current || loading || !answer.trim()} type="submit" aria-label="Send answer">↑</button></div>
        </form>
        {error && <div className="error">{error}{!loading && <button type="button" className="retry-link" onClick={() => current ? setError("") : retry()}>{current ? "Dismiss" : "Retry"}</button>}</div>}
        {history.length >= 3 && <button className="end-pitch-button" type="button" onClick={() => finish(history, score)} disabled={loading}><span>END THE PITCH</span><strong>Call the verdict →</strong></button>}
      </section>
    </main>
  );

  return (
    <main className="shell results">
      <header className="topbar"><button className="back" onClick={() => setScreen("arena")}>← Back to tank</button><span className="topbar-right"><ModeBadge mode={mode} />03 / VERDICT</span></header>
      <section className="results-head"><div className="eyebrow pulse">THE PANEL HAS HEARD ENOUGH</div><h1>{evaluation?.overall ?? 0}<span>/100</span></h1><p>{evaluation?.overall >= 75 ? "You made them listen." : evaluation?.overall >= 55 ? "There is a business here. Now make it stronger." : "The sharks found blood in the water."}</p></section>
      <section className="score-grid">{[["problem","Problem"],["market","Market"],["product","Product"],["businessModel","Business model"],["differentiation","Differentiation"],["defensibility","Defensibility"]].map(([key,label]) => <div className="score" key={key}><span>{label}</span><strong>{evaluation?.[key] ?? 0}</strong><div className="bar"><i style={{width:`${evaluation?.[key] ?? 0}%`}} /></div></div>)}</section>
      <section className="report-grid"><div className="report-card"><div className="eyebrow">STRONGEST POINT</div><p>{evaluation?.strongestPoint}</p></div><div className="report-card danger"><div className="eyebrow">BIGGEST WEAKNESS</div><p>{evaluation?.biggestWeakness}</p></div></section>
      <section className="room-card">
        <div className="eyebrow">THE ROOM</div>
        <div className="room-grid">{Object.entries(sharks).map(([key, shark]) => { const heat = sharkHeat[key] ?? 50; const v = evaluation?.verdicts?.[key] || "MAYBE"; return <div className={`room-investor ${shark.color} ${v === "PASS" ? "room-pass" : ""}`} key={key}><img src={shark.avatar} alt={`${shark.name} avatar`} /><div><strong>{shark.name}</strong><small>{heat}/100 · {v}</small></div><b className={`v-${v.toLowerCase()}`}>{v}</b></div>; })}</div>
      </section>
      <section className="verdicts">{Object.entries(sharks).map(([key, shark]) => <div className="verdict" key={key}><img src={shark.avatar} alt={`${shark.name} avatar`} className="shark-avatar verdict-avatar" /><div><strong>{shark.name}</strong><small>{shark.role}</small></div><b className={`v-${evaluation?.verdicts?.[key]?.toLowerCase()}`}>{evaluation?.verdicts?.[key]}</b></div>)}</section>
      <section className="report-grid moments"><div className="report-card moment-good"><div className="eyebrow">⚡ KEY MOMENT</div><p>{evaluation?.keyMoment}</p></div><div className="report-card moment-bad"><div className="eyebrow">💀 THE MOMENT THAT COST YOU</div><p>{evaluation?.costlyMoment}</p></div></section>
      <section className="report-card improve"><div className="eyebrow">THREE MOVES BEFORE YOU PITCH AGAIN</div><ol>{(evaluation?.improvements || []).map((x,i)=><li key={i}>{x}</li>)}</ol><div className="improved"><div className="eyebrow">YOUR STRONGER PITCH</div><p>{evaluation?.improvedPitch}</p></div></section>
      <button className="primary big retry" onClick={() => { resetRun(); setScreen("pitch"); }}>Pitch again →</button>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
