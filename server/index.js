import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  SHARKS, SHARK_KEYS, MIN_QUESTIONS, MAX_QUESTIONS,
  localTurn, localEvaluation, countByShark, chooseShark, scoreAnswer
} from "./localEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load server/.env regardless of the directory the process was started from.
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT || 8080);
const MODEL = (process.env.GEMINI_MODEL || "gemini-3.8-flash").trim();
// Tried in order if the configured model is unavailable for this key (404 / not found).
const MODEL_CHAIN = [...new Set([MODEL, "gemini-3.7-flash", "gemini-3.6-flash"])];
const GEMINI_TIMEOUT_MS = 30000;
const GEMINI_BASE = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");

app.use(express.json({ limit: "1mb" }));

// Lightweight security headers without another dependency. Keep dev/HMR usable.
if (process.env.NODE_ENV === "production") {
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
}

// Small in-memory guard against accidental request floods. Cloud Run may have multiple instances,
// so this is deliberately a lightweight abuse guard rather than an authentication system.
const requestWindows = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = `${req.ip || "unknown"}:${req.path}`;
  const item = requestWindows.get(key) || { start: now, count: 0 };
  if (now - item.start > 60_000) { item.start = now; item.count = 0; }
  item.count += 1;
  requestWindows.set(key, item);
  if (item.count > 30) return res.status(429).json({ error: "The panel is getting too many requests. Give it a moment and try again." });
  next();
}

const clientDist = path.resolve(__dirname, "../client/dist");

/* ------------------------------------------------------------------ */
/* API key handling                                                    */
/* ------------------------------------------------------------------ */

function readApiKey() {
  const raw = String(process.env.GEMINI_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (!raw) return null;
  // Placeholders such as "tobegiven", "your_api_key_here", "<key>" must NOT count as a key.
  if (/^(to ?be ?(given|added|set|filled)|your[\s_-]*(gemini[\s_-]*)?(api[\s_-]*)?key.*|change ?me|paste.*|insert.*|xxx+|none|null|undefined|<.*>)$/i.test(raw)) return null;
  if (raw.length < 20 || /\s/.test(raw)) return null;
  return raw;
}

const state = {
  workingModel: null,   // last model that answered successfully
  disabledReason: null  // set when the key is rejected, so we stop hammering the API
};

function aiAvailable() {
  return Boolean(readApiKey()) && !state.disabledReason;
}

/* ------------------------------------------------------------------ */
/* Gemini                                                              */
/* ------------------------------------------------------------------ */

class GeminiError extends Error {
  constructor(message, { status = 0, fatal = false, modelMissing = false } = {}) {
    super(message);
    this.status = status;
    this.fatal = fatal;
    this.modelMissing = modelMissing;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(text) {
  const cleaned = String(text || "").replace(/```json|```/gi, "").trim();
  try { return JSON.parse(cleaned); } catch { /* try to salvage below */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("Model did not return JSON.");
}

const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["question", "finish"] },
    shark: { type: "string", enum: ["dealmaker", "product", "skeptic"] },
    question: { type: "string" },
    difficulty: { type: "string", enum: ["medium", "hard", "brutal"] },
    focus: { type: "string" },
    attackTarget: { type: "string" },
    pressure: { type: "integer" },
    scoreDelta: { type: "integer" },
    scoreReason: { type: "string" },
    sharkResponse: { type: "string" },
    responseShark: { type: "string", enum: ["dealmaker", "product", "skeptic"] },
    sharkHeatDelta: { type: "integer" },
    sharkHeatReason: { type: "string" },
    sharkWalkedOut: { type: "boolean" },
    dodged: { type: "boolean" },
    panelConflict: { type: "string" }
  },
  required: ["type", "scoreDelta", "scoreReason", "sharkResponse", "responseShark", "sharkHeatDelta", "sharkHeatReason", "sharkWalkedOut", "dodged", "panelConflict"]
};

const GEMINI_EVAL_SCHEMA = {
  type: "object",
  properties: {
    problem: { type: "integer" }, market: { type: "integer" }, product: { type: "integer" }, businessModel: { type: "integer" }, differentiation: { type: "integer" }, defensibility: { type: "integer" }, overall: { type: "integer" },
    strongestPoint: { type: "string" }, biggestWeakness: { type: "string" }, keyMoment: { type: "string" }, costlyMoment: { type: "string" },
    improvements: { type: "array", items: { type: "string" } },
    verdicts: { type: "object", properties: { dealmaker: { type: "string", enum: ["INVEST", "MAYBE", "PASS"] }, product: { type: "string", enum: ["INVEST", "MAYBE", "PASS"] }, skeptic: { type: "string", enum: ["INVEST", "MAYBE", "PASS"] } }, required: ["dealmaker", "product", "skeptic"] },
    improvedPitch: { type: "string" }
  },
  required: ["problem", "market", "product", "businessModel", "differentiation", "defensibility", "overall", "strongestPoint", "biggestWeakness", "keyMoment", "costlyMoment", "improvements", "verdicts", "improvedPitch"]
};

async function geminiOnce(model, apiKey, prompt, temperature, schema = GEMINI_RESPONSE_SCHEMA) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const url = `${GEMINI_BASE}/interactions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model,
        input: prompt,
        response_format: { type: "text", mime_type: "application/json", schema },
        generation_config: { temperature, thinking_level: "medium" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 700);
      const authProblem = response.status === 401 || response.status === 403 || /API key (not valid|expired|invalid)|API_KEY_INVALID|PERMISSION_DENIED/i.test(body);
      const modelMissing = response.status === 404 || /not found|not supported/i.test(body);
      throw new GeminiError(`Gemini ${response.status} (${model}): ${body}`, { status: response.status, fatal: authProblem, modelMissing });
    }

    const data = await response.json();
    const text = String(data?.output_text || data?.steps?.flatMap(s => s?.content || []).filter(c => c?.type === "text").map(c => c.text || "").join("") || "").trim();
    if (!text) throw new GeminiError(`Gemini (${model}) returned an empty response.`, { status: 200 });
    return extractJson(text);
  } catch (err) {
    if (err.name === "AbortError") throw new GeminiError(`Gemini (${model}) timed out.`, { status: 408 });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt, { temperature = 0.85, schema = GEMINI_RESPONSE_SCHEMA } = {}) {
  const apiKey = readApiKey();
  if (!apiKey || state.disabledReason) return null;

  const chain = state.workingModel ? [state.workingModel, ...MODEL_CHAIN.filter((m) => m !== state.workingModel)] : MODEL_CHAIN;
  let lastError = null;

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await geminiOnce(model, apiKey, prompt, temperature, schema);
        state.workingModel = model;
        return result;
      } catch (err) {
        lastError = err;
        if (err.fatal) {
          state.disabledReason = "Gemini rejected the API key. Check GEMINI_API_KEY in server/.env and restart.";
          console.error(`[ai] ${err.message}\n[ai] Falling back to offline sharks until the server is restarted.`);
          throw err;
        }
        if (err.modelMissing) break;                       // try the next model
        if ([429, 500, 502, 503, 504, 408].includes(err.status) && attempt === 0) { await sleep(700); continue; }
        if (err instanceof SyntaxError || /did not return JSON/.test(err.message)) { if (attempt === 0) continue; }
        break;
      }
    }
  }
  if (lastError) {
    console.error(`[ai] all Gemini models failed. Last error: ${lastError.message}`);
  }
  throw lastError || new Error("Gemini call failed.");
}

/* ------------------------------------------------------------------ */
/* Input helpers                                                       */
/* ------------------------------------------------------------------ */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const cleanText = (value, max = 5000) => String(value ?? "").trim().slice(0, max);

function cleanPitch(pitch = {}) {
  return {
    startupName: cleanText(pitch.startupName, 120),
    problem: cleanText(pitch.problem),
    solution: cleanText(pitch.solution),
    targetCustomer: cleanText(pitch.targetCustomer, 1200),
    businessModel: cleanText(pitch.businessModel, 1500),
    fundingAsk: cleanText(pitch.fundingAsk, 600),
    fullPitch: cleanText(pitch.fullPitch, 5000)
  };
}

function cleanHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_QUESTIONS).map((item) => ({
    shark: SHARK_KEYS.includes(item?.shark) ? item.shark : "dealmaker",
    question: cleanText(item?.question, 1200),
    answer: cleanText(item?.answer, 1800),
    topic: cleanText(item?.topic, 40),
    response: cleanText(item?.reaction?.text || item?.response, 900),
    scoreDelta: Number(item?.scoreDelta) || 0
  }));
}

const isEnum = (v, list) => list.includes(v);

/* ------------------------------------------------------------------ */
/* Question turn                                                       */
/* ------------------------------------------------------------------ */

function questionPrompt({ pitch, history, lastAnswer, currentScore, sharkHeat }) {
  const counts = countByShark(history);
  const lastShark = history.at(-1)?.shark || null;
  const transcript = history.map((h, i) => ({ n: i + 1, shark: SHARKS[h.shark].name, asked: h.question, founderSaid: h.answer, sharkReacted: h.response || undefined, scoreChange: h.scoreDelta || undefined }));
  const available = Object.fromEntries(SHARK_KEYS.map(k => [k, { heat: sharkHeat?.[k] ?? 50, state: sharkHeat?.[k] <= 0 ? "OUT" : sharkHeat?.[k] <= 34 ? "ON EDGE" : "IN", questions: counts[k] }]));

  return `You are the control brain of a ruthless but intelligent TV investor panel. This is NOT a questionnaire. It is a live negotiation. Sharks listen to exact claims, remember them, challenge weak links, and sometimes disagree with each other.

SHARK PERSONALITIES
- dealmaker — ${SHARKS.dealmaker.style}. Attack price, revenue, margin, CAC, LTV, scale and the funding ask. Never let a founder hide behind a big market.
- product — ${SHARKS.product.style}. Attack user pain, behaviour, first use, retention, UX and differentiation. Demand a concrete human story.
- skeptic — ${SHARKS.skeptic.style}. Attack assumptions, contradictions, competitors, risk and defensibility. If the founder says "everyone" or "no competition", call it out immediately.

PITCH\n${JSON.stringify(pitch, null, 2)}

CONVERSATION\n${JSON.stringify(transcript, null, 2)}

LIVE STATE\nGlobal pitch heat: ${currentScore}/100\nInvestor state: ${JSON.stringify(available)}\nLatest founder answer: ${lastAnswer ? JSON.stringify(lastAnswer) : "none — opening question"}

YOUR JOB
1. Judge ONLY the latest answer. Specific numbers, evidence, customer stories and honest limits earn heat. Vague claims, hedging, contradictions and dodging lose heat.
2. First respond to the latest answer in 1-3 spoken sentences. Quote or tightly paraphrase a concrete phrase from the founder. Do NOT ask the next question inside the reaction.
3. Decide whether the founder actually answered the question. If not, set dodged=true and say so plainly: "You didn't answer me." A second dodge should sharply increase pressure.
4. Identify the exact attackTarget (2-6 words) and pressure 0-100. Pressure should rise when the founder dodges, contradicts themselves, gives unsupported claims or repeats weak answers.
5. sharkHeatDelta is for the shark who asked the latest question, from -18 to +12. Strong evidence can increase their personal interest. Repeated dodging can make them walk. If their resulting heat is 0 or below, sharkWalkedOut MUST be true and sharkResponse MUST end the relationship clearly (for example: "I'm out.").
6. If a shark is OUT, never select them again. Prefer the investor with the strongest reason to challenge the latest claim, not a round-robin rotation. Do not select an investor simply because they have fewer questions if another investor has a legitimate follow-up.
7. Occasionally create panelConflict (one short sentence) when another shark would naturally challenge or support the current shark. This is a panel interruption, not a new question. Otherwise return an empty string.
8. If continuing, ask ONE sharp question that follows directly from the founder's actual words. Never jump to a generic topic just because it is a different shark. No repeated or lightly reworded questions.
9. Finish after enough evidence has been tested. Never finish before ${MIN_QUESTIONS} answers and never continue beyond ${MAX_QUESTIONS}. If a founder gives a strong answer, acknowledge it and attack the next unresolved risk. If they keep dodging, pressure can end the pitch early after the minimum.

STYLE
Short spoken sentences. Ruthless, fair, specific. No emojis, markdown, corporate filler, "great question", "thank you", "as an AI", or fake praise. No invented facts.

Return JSON matching the supplied schema.`;
}

function normalizeTurn(raw, { pitch, history, lastAnswer, sharkHeat = {} }) {
  const h = history.length;
  const counts = countByShark(history);
  const covered = SHARK_KEYS.every((k) => counts[k] >= 2);
  const lastShark = history.at(-1)?.shark || "dealmaker";
  const isOpening = !lastAnswer;

  // Always have an offline turn ready: used to patch anything the model got wrong.
  const offline = localTurn(pitch, history, lastAnswer, 50);

  let delta = isOpening ? 0 : clamp(Math.round(Number(raw?.scoreDelta)), -8, 10);
  if (!Number.isFinite(delta)) delta = isOpening ? 0 : scoreAnswer(lastAnswer).delta;

  const scoreReason = cleanText(raw?.scoreReason, 160) || offline.scoreReason || "";
  const responseShark = isEnum(raw?.responseShark, SHARK_KEYS) ? raw.responseShark : lastShark;
  const sharkResponse = isOpening ? null : (cleanText(raw?.sharkResponse, 500) || offline.sharkResponse || null);
  const heatDelta = isOpening ? 0 : clamp(Math.round(Number(raw?.sharkHeatDelta)), -18, 12);
  const previousHeat = clamp(Number(sharkHeat?.[responseShark] ?? 50), 0, 100);
  const resultingHeat = clamp(previousHeat + (Number.isFinite(heatDelta) ? heatDelta : 0), 0, 100);
  const sharkWalkedOut = !isOpening && (Boolean(raw?.sharkWalkedOut) || resultingHeat <= 0);
  const pressure = clamp(Math.round(Number(raw?.pressure)), 0, 100) || (lastAnswer ? (delta < 0 ? 75 : 52) : 35);
  const dodged = Boolean(raw?.dodged);
  const panelConflict = cleanText(raw?.panelConflict, 220);
  const allOut = SHARK_KEYS.every(k => k === responseShark ? resultingHeat <= 0 : (Number(sharkHeat?.[k] ?? 50) <= 0));

  let wantsFinish = raw?.type === "finish" || allOut;
  if (isOpening) wantsFinish = false;
  if (h < MIN_QUESTIONS) wantsFinish = false;
  if (h >= MIN_QUESTIONS && h < MAX_QUESTIONS && !covered) wantsFinish = false;
  if (h >= MAX_QUESTIONS) wantsFinish = true;

  if (wantsFinish) {
    return { type: "finish", scoreDelta: delta, scoreReason, sharkResponse, responseShark, sharkHeatDelta: Number.isFinite(heatDelta) ? heatDelta : 0, sharkHeatReason: cleanText(raw?.sharkHeatReason, 160) || scoreReason, sharkWalkedOut, dodged, panelConflict, source: "ai" };
  }

  let shark = isEnum(raw?.shark, SHARK_KEYS) ? raw.shark : null;
  if (isOpening) shark = "dealmaker";
  if (sharkHeat?.[shark] <= 0) shark = null;
  if (!shark || counts[shark] >= 3) {
    const availableKeys = SHARK_KEYS.filter(k => (sharkHeat?.[k] ?? 50) > 0);
    const candidate = chooseShark(history);
    shark = availableKeys.includes(candidate) ? candidate : (availableKeys.find(k => k !== lastShark) || availableKeys[0] || "dealmaker");
  }

  let question = cleanText(raw?.question, 600);
  if (question.length < 12) {
    // Model gave no usable question: use the offline engine's question for the same shark slot.
    if (offline.type === "question") return { ...offline, scoreDelta: delta, scoreReason, sharkResponse, responseShark, source: "ai" };
    question = "Give me your single strongest reason I should invest, in one sentence.";
  }

  return {
    type: "question",
    shark,
    sharkName: SHARKS[shark].name,
    role: SHARKS[shark].role,
    question,
    difficulty: isEnum(raw?.difficulty, ["medium", "hard", "brutal"]) ? raw.difficulty : "hard",
    focus: cleanText(raw?.focus, 40) || SHARKS[shark].role,
    attackTarget: cleanText(raw?.attackTarget, 80) || cleanText(raw?.focus, 40) || "unresolved claim",
    pressure,
    topic: "ai",
    scoreDelta: delta,
    scoreReason,
    sharkResponse,
    responseShark,
    sharkHeatDelta: Number.isFinite(heatDelta) ? heatDelta : 0,
    sharkHeatReason: cleanText(raw?.sharkHeatReason, 160) || scoreReason,
    sharkWalkedOut,
    dodged,
    panelConflict,
    source: "ai"
  };
}

app.get("/api/health", (_req, res) => {
  const key = readApiKey();
  res.json({
    ok: true,
    model: state.workingModel || MODEL,
    aiConfigured: Boolean(key),
    aiActive: aiAvailable(),
    mode: aiAvailable() ? "ai" : "local",
    reason: !key ? "No valid GEMINI_API_KEY set; running with the offline panel." : state.disabledReason || null
  });
});

function decorateLocalTurn(turn, history, lastAnswer) {
  const delta = Number(turn?.scoreDelta) || 0;
  const responseShark = turn?.responseShark || history.at(-1)?.shark || null;
  const heatDelta = lastAnswer ? clamp(Math.round(delta * 1.35), -14, 10) : 0;
  const walked = Boolean(responseShark && history.length >= MIN_QUESTIONS && heatDelta <= -12);
  return {
    ...turn,
    attackTarget: turn?.focus || "unresolved claim",
    pressure: lastAnswer ? clamp(55 + (delta < 0 ? Math.abs(delta) * 7 : 0), 0, 95) : 35,
    dodged: Boolean(lastAnswer && /didn'?t answer|avoid|vague|not an answer/i.test(turn?.sharkResponse || "")),
    sharkHeatDelta: heatDelta,
    sharkHeatReason: turn?.scoreReason || "Answer quality changed investor confidence.",
    sharkWalkedOut: walked,
    panelConflict: "",
    responseShark
  };
}

app.post("/api/question", rateLimit, async (req, res) => {
  try {
    const pitch = cleanPitch(req.body?.pitch);
    const history = cleanHistory(req.body?.history);
    const lastAnswer = cleanText(req.body?.lastAnswer, 2200);
    const currentScore = clamp(Number(req.body?.currentScore ?? 50) || 50, 0, 100);
    const sharkHeat = Object.fromEntries(SHARK_KEYS.map(k => [k, clamp(Number(req.body?.sharkHeat?.[k] ?? 50) || 50, 0, 100)]));

    if (history.length > 0 && !lastAnswer) {
      return res.status(400).json({ error: "An answer is required to continue the pitch." });
    }

    if (aiAvailable()) {
      try {
        const raw = await callGemini(questionPrompt({ pitch, history, lastAnswer, currentScore, sharkHeat }));
        return res.json(normalizeTurn(raw, { pitch, history, lastAnswer, sharkHeat }));
      } catch (err) {
        console.error(`[ai] question failed, using offline panel for this turn: ${err.message}`);
      }
    }

    await sleep(450 + Math.random() * 500); // gives the "thinking" beat a natural feel
    return res.json({ ...decorateLocalTurn(localTurn(pitch, history, lastAnswer, currentScore), history, lastAnswer), source: "local" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "The investor panel stumbled. Try that answer again." });
  }
});

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

function evaluationPrompt(pitch, history, liveScore) {
  const transcript = history.map((h, i) => ({
    n: i + 1,
    shark: SHARKS[h.shark].name,
    asked: h.question,
    founderSaid: h.answer,
    sharkReacted: h.response || undefined,
    scoreChange: h.scoreDelta || undefined,
    panelConflict: h.panelConflict || undefined
  }));

  return `You are the final judging panel of a Shark Tank-style pitch simulation: The DealMaker (money & market), The Product Shark (user & product), The Skeptic (risk & defensibility).
Judge the founder ONLY on what they actually said. Do not invent market facts, numbers, customers or traction. If something wasn't evidenced, say so.

PITCH
${JSON.stringify(pitch, null, 2)}

Q&A TRANSCRIPT
${JSON.stringify(transcript, null, 2)}

Live pitch score at the end of the Q&A: ${liveScore}/100 (a signal of how individual answers landed).

Score 0-100 (integers): problem, market, product, businessModel, differentiation, defensibility, and overall.
Be honest: vague pitches score under 50; most good-but-unproven pitches land 50-70; only evidenced, specific, defensible pitches pass 80.

Also provide:
- "strongestPoint": 1-2 sentences, citing something the founder actually said.
- "biggestWeakness": 1-2 sentences, citing a specific gap or weak answer.
- "keyMoment": the single strongest answer or exchange, 1-2 sentences. Quote/paraphrase only what happened.
- "costlyMoment": the single answer/dodge/contradiction that hurt most, 1-2 sentences. If none was clearly costly, say what remained unproven.
- "improvements": exactly 3 concrete, actionable moves (each under 35 words).
- "verdicts": INVEST, MAYBE or PASS for dealmaker, product and skeptic, consistent with each shark's focus and with the scores.
- "improvedPitch": a tighter 90-140 word version of the pitch using only facts the founder gave. Where a key fact is missing, put a bracketed placeholder like [add your price] instead of inventing it.

Return ONLY JSON:
{
  "problem": int, "market": int, "product": int, "businessModel": int, "differentiation": int, "defensibility": int, "overall": int,
  "strongestPoint": string, "biggestWeakness": string, "keyMoment": string, "costlyMoment": string, "improvements": [string, string, string],
  "verdicts": { "dealmaker": "INVEST|MAYBE|PASS", "product": "INVEST|MAYBE|PASS", "skeptic": "INVEST|MAYBE|PASS" },
  "improvedPitch": string
}`;
}

function normalizeEvaluation(raw, fallback) {
  const dims = ["problem", "market", "product", "businessModel", "differentiation", "defensibility"];
  const out = {};
  for (const k of dims) {
    const v = Math.round(Number(raw?.[k]));
    out[k] = Number.isFinite(v) ? clamp(v, 0, 100) : fallback[k];
  }
  const o = Math.round(Number(raw?.overall));
  out.overall = Number.isFinite(o) ? clamp(o, 0, 100) : Math.round(dims.reduce((s, k) => s + out[k], 0) / dims.length);

  const str = (v, fb) => (cleanText(v, 900) || fb);
  out.strongestPoint = str(raw?.strongestPoint, fallback.strongestPoint);
  out.biggestWeakness = str(raw?.biggestWeakness, fallback.biggestWeakness);
  out.keyMoment = str(raw?.keyMoment, fallback.keyMoment || fallback.strongestPoint);
  out.costlyMoment = str(raw?.costlyMoment, fallback.costlyMoment || fallback.biggestWeakness);

  const imps = Array.isArray(raw?.improvements) ? raw.improvements.map((x) => cleanText(x, 400)).filter(Boolean).slice(0, 3) : [];
  out.improvements = imps.length === 3 ? imps : fallback.improvements;

  const norm = (v, fb) => { const s = String(v || "").toUpperCase().trim(); return isEnum(s, ["INVEST", "MAYBE", "PASS"]) ? s : fb; };
  out.verdicts = {
    dealmaker: norm(raw?.verdicts?.dealmaker, fallback.verdicts.dealmaker),
    product: norm(raw?.verdicts?.product, fallback.verdicts.product),
    skeptic: norm(raw?.verdicts?.skeptic, fallback.verdicts.skeptic)
  };
  out.improvedPitch = str(raw?.improvedPitch, fallback.improvedPitch);
  return out;
}

app.post("/api/evaluate", rateLimit, async (req, res) => {
  try {
    const pitch = cleanPitch(req.body?.pitch);
    const history = cleanHistory(req.body?.history);
    const liveScore = clamp(Number(req.body?.liveScore ?? 50) || 50, 0, 100);

    if (!history.length) {
      return res.status(400).json({ error: "Answer at least one question before asking for a verdict." });
    }

    const fallback = localEvaluation(pitch, history, liveScore);

    if (aiAvailable()) {
      try {
        const raw = await callGemini(evaluationPrompt(pitch, history, liveScore), { temperature: 0.5, schema: GEMINI_EVAL_SCHEMA });
        return res.json({ ...normalizeEvaluation(raw, fallback), source: "ai" });
      } catch (err) {
        console.error(`[ai] evaluation failed, using offline verdict: ${err.message}`);
      }
    }

    await sleep(600);
    return res.json({ ...fallback, source: "local" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "The panel couldn't finish deliberating. Try again." });
  }
});

/* ------------------------------------------------------------------ */
/* Static client (production build)                                    */
/* ------------------------------------------------------------------ */

if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get("*splat", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Shark Tank Simulator server listening on port ${PORT}`);
  console.log(aiAvailable()
    ? `Live AI: ON  (model chain: ${MODEL_CHAIN.join(", ")})`
    : "Live AI: OFF (no valid GEMINI_API_KEY): using the offline contextual panel");
});
