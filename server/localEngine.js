// Offline "shark brain".
//
// Used when no valid GEMINI_API_KEY is configured, or when a live AI call fails.
// It is NOT a canned script: it reads the founder's pitch and every answer,
// detects what is missing or suspicious (no price, "everyone", "no competitors",
// hedging, no evidence...), quotes the founder's own words back, scores each
// answer on specificity/evidence, and picks the next shark + question from the gaps.

export const SHARKS = {
  dealmaker: {
    name: "The DealMaker",
    role: "Market & Money",
    style: "calm, commercially ruthless, obsessed with revenue, margins, customer acquisition and scalability"
  },
  product: {
    name: "The Product Shark",
    role: "Product & Customer",
    style: "sharp, curious and product-focused, obsessed with the real user problem, product experience and differentiation"
  },
  skeptic: {
    name: "The Skeptic",
    role: "Risk & Competition",
    style: "aggressive but fair, challenges assumptions, competitive threats, risks and defensibility"
  }
};

export const SHARK_KEYS = Object.keys(SHARKS);
export const MIN_QUESTIONS = 6;
export const MAX_QUESTIONS = 9;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const words = (t) => (String(t || "").trim().match(/\S+/g) || []).length;

/* ------------------------------------------------------------------ */
/* Signal detection                                                    */
/* ------------------------------------------------------------------ */

const RX = {
  hedge: /\b(maybe|i think|i guess|hopefully|probably|kind of|sort of|basically|somehow|hope to|we will try|should be able|in theory|might|i believe|we feel|we are planning|planning to)\b/gi,
  bigClaim: /\b(everyone|everybody|anyone|anybody|all people|billions?|no competit(?:ion|ors?)|zero competit(?:ion|ors?)|nobody (?:else|does)|no one (?:else|does)|revolutionary|disrupt\w*|game[- ]?chang\w*|next big thing|viral|guaranteed)\b/gi,
  evidence: /\b(customers?|users?|paying|paid|revenue|sales?|pilots?|waitlist|sign[- ]?ups?|interviews?|interviewed|surveyed?|talked to|spoke to|spoken to|tested|beta|orders?|subscribers?|retention|repeat|churn|loi|letter of intent|mou|contracts?|booked|signed|converted|conversion|downloads?)\b/gi,
  competitor: /\b(competitors?|competition|alternatives?|incumbents?|versus|vs\.?|existing (?:players|solutions|apps?)|already (?:exists?|doing)|swiggy|zomato|amazon|google|flipkart|uber|ola|paytm|byju'?s|unacademy|whatsapp|excel|spreadsheets?|notion)\b/gi,
  moat: /\b(patents?|proprietary|network effects?|exclusive|partnerships?|partners?|switching costs?|brand|community|lock[- ]?in|licen[cs]e|regulat\w*|supply|distribution|integrations?|first[- ]mover|trade secret|data advantage|our data|unique data)\b/gi,
  price: /\b(price|pricing|charge|charges|fee|fees|subscription|per (?:month|user|order|ride|seat|student|customer)|\/month|margin|commission|take rate|cac|ltv|cost to acquire|unit economics|gross margin|average order)\b/i,
  channel: /\b(instagram|youtube|seo|ads?|referrals?|word of mouth|campus|college|whatsapp|outbound|cold (?:email|call)|sales team|influencers?|marketplace|app store|linkedin|offline|stalls?|events?|partnership|reddit|telegram|distributors?)\b/i,
  research: /\b(interview(?:ed|s)?|surveyed?|talked to|spoke to|spoken to|conversations? with|pilot|beta|tested with|user research|feedback from)\b/i,
  money: /(?:₹|\$|rs\.?\s?|inr\s?|usd\s?)\s?\d[\d,.]*\s?(?:lakhs?|crores?|k|m|million|billion)?|\b\d[\d,.]*\s?(?:lakhs?|crores?|rupees|dollars|k|million|billion)\b/i,
  number: /(?:₹|\$)?\d[\d,.]*\s?(?:%|x|k|m|lakhs?|crores?|users?|customers?|students?|orders?|per month|\/month|a month|weeks?|months?|days?|people|businesses|shops?|colleges?|cities)?/gi,
  everyone: /\b(everyone|everybody|anyone|anybody|all people|all students|every (?:person|student|business))\b/i
};

function matches(text, rx) {
  const flags = rx.flags.includes("g") ? rx.flags : rx.flags + "g";
  return [...String(text || "").matchAll(new RegExp(rx.source, flags))].map((m) => m[0]);
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function trimQuote(sentence, max = 105) {
  let s = String(sentence || "").trim().replace(/[.!?…]+$/g, "");
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const cut = s.lastIndexOf(" ");
  return (cut > 40 ? s.slice(0, cut) : s).replace(/[,;:\-–]+$/g, "") + "…";
}

// Pick the most "quotable" sentence, optionally one containing a given pattern.
function pickQuote(text, prefer) {
  const sentences = splitSentences(text);
  if (!sentences.length) return "";
  if (prefer) {
    const hit = sentences.find((s) => prefer.test(s));
    if (hit) return trimQuote(hit);
  }
  let best = sentences[0];
  let bestScore = -1;
  for (const s of sentences) {
    const score =
      matches(s, RX.number).filter((n) => /\d/.test(n)).length * 3 +
      matches(s, RX.evidence).length * 2 +
      matches(s, RX.bigClaim).length * 3 +
      matches(s, RX.hedge).length * 2 +
      Math.min(words(s), 30) / 15;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return trimQuote(best);
}

export function analyzeText(text) {
  const t = String(text || "");
  const numbers = matches(t, RX.number).map((n) => n.trim()).filter((n) => /\d/.test(n));
  const hedges = matches(t, RX.hedge);
  const bigClaims = matches(t, RX.bigClaim);
  const evidence = [...new Set(matches(t, RX.evidence).map((e) => e.toLowerCase()))];
  const competitor = [...new Set(matches(t, RX.competitor).map((e) => e.toLowerCase()))];
  const moat = [...new Set(matches(t, RX.moat).map((e) => e.toLowerCase()))];
  return {
    words: words(t),
    numbers,
    hedges,
    bigClaims,
    evidence,
    competitor,
    moat,
    hasPrice: RX.price.test(t) || RX.money.test(t),
    hasMoney: RX.money.test(t),
    hasChannel: RX.channel.test(t),
    hasResearch: RX.research.test(t),
    saysEveryone: RX.everyone.test(t)
  };
}

/* ------------------------------------------------------------------ */
/* Helpers on the pitch                                                */
/* ------------------------------------------------------------------ */

function pitchText(pitch, { skipAsk = false } = {}) {
  return [pitch.startupName, pitch.problem, pitch.solution, pitch.targetCustomer, pitch.businessModel, skipAsk ? "" : pitch.fundingAsk, pitch.fullPitch]
    .filter(Boolean)
    .join(". ");
}

// The funding ask ("₹10 lakh for 10%") is not a price or proof of demand, so it is excluded by default.
function allText(pitch, history, lastAnswer, opts = { skipAsk: true }) {
  const answers = (history || []).map((h) => h.answer).filter(Boolean);
  if (lastAnswer && !answers.includes(lastAnswer)) answers.push(lastAnswer);
  return [pitchText(pitch, opts), ...answers].join(". ");
}

function startupLabel(pitch) {
  const n = String(pitch.startupName || "").trim();
  return n ? n : "this idea";
}

function customerLabel(pitch) {
  const raw = String(pitch.targetCustomer || "").trim();
  if (!raw) return "your customers";
  const first = raw.split(/[.\n;]|,\s(?=[a-z])/)[0].trim();
  const short = first.length > 58 ? first.slice(0, 58).replace(/\s\S*$/, "") : first;
  return short.charAt(0).toLowerCase() + short.slice(1) || "your customers";
}

function firstSentences(text, count = 1, max = 170) {
  const s = splitSentences(text).slice(0, count).join(" ");
  return s.length > max ? trimQuote(s, max) : s.replace(/[.!?]+$/g, "");
}

function moneyToken(text) {
  const m = String(text || "").match(RX.money);
  return m ? m[0].trim() : "";
}

function pickVariant(list, seed) {
  return list[Math.abs(seed) % list.length];
}

/* ------------------------------------------------------------------ */
/* Scoring one answer                                                  */
/* ------------------------------------------------------------------ */

export function scoreAnswer(answer, previousAnswers = []) {
  const a = analyzeText(answer);
  let d = 0;

  if (a.words < 8) d -= 6;
  else if (a.words < 20) d -= 3;
  else if (a.words < 40) d += 0;
  else if (a.words < 90) d += 2;
  else d += 3;

  d += Math.min(4, a.numbers.length * 2);
  d += Math.min(3, a.evidence.length);
  if (a.competitor.length && a.words > 25) d += 1;
  if (a.moat.length) d += 1;
  if (a.hasPrice) d += 1;
  d -= Math.min(4, a.hedges.length * 2);
  d -= Math.min(5, a.bigClaims.length * 3);

  const norm = (s) => String(s).toLowerCase().replace(/\W+/g, " ").trim();
  if (previousAnswers.some((p) => norm(p) === norm(answer))) d -= 6;

  return { delta: clamp(Math.round(d), -8, 10), analysis: a };
}

/* ------------------------------------------------------------------ */
/* Shark reactions (voice differs per shark)                           */
/* ------------------------------------------------------------------ */

function reactionFor(shark, a, delta, answer, seed) {
  const bigPhrase = a.bigClaims[0] || "";
  const hedge = a.hedges[0] || "";
  const claimQuote = pickQuote(answer, bigPhrase ? new RegExp(bigPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null);
  const hedgeQuote = pickQuote(answer, hedge ? new RegExp(hedge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null);
  const q = pickQuote(answer);
  const num = a.numbers[0] || "";
  const strong = delta >= 5;
  const weak = delta <= -2;
  const tooShort = a.words < 12;

  const V = {
    dealmaker: {
      bigClaim: [
        `"${claimQuote}". I've heard that line in a hundred pitches, and most of them are still waiting for their first real cheque.`,
        `You said "${bigPhrase}". That's not a market, that's a mood. Give me a specific buyer.`
      ],
      hedge: [
        `"${hedgeQuote}". "${hedge}" doesn't go on a balance sheet. I put money into what's happening, not what's hoped.`,
        `That's a lot of "${hedge}" for someone asking me for money. Where's the version that's already true?`
      ],
      short: [
        `That's one line. In this room a business is a number, and you haven't given me one.`,
        `I asked for substance and got a sentence. Try again with something I can underwrite.`
      ],
      strong: [
        `${num ? `${num} — ` : ""}okay, now we're talking. That's something I can actually pressure-test instead of just nodding at.`,
        `"${q}". That's the first thing you've said that sounds like a business and not a brochure.`
      ],
      mid: [
        `I follow the idea, but I still don't see the money in "${q}".`,
        `Fair, but "${q}" is still more story than economics. I'm listening for the numbers.`
      ]
    },
    product: {
      bigClaim: [
        `"${claimQuote}". Real products start with one person who badly needs them, not "${bigPhrase}".`,
        `"${bigPhrase}" is how people describe a market when they haven't met a customer. Who did you actually meet?`
      ],
      hedge: [
        `"${hedgeQuote}" — that's you guessing about your user. I want what they told you.`,
        `You keep saying "${hedge}". Users don't live in "${hedge}", they live in Tuesday afternoon. What happens then?`
      ],
      short: [
        `That doesn't tell me what it feels like to be your user. Paint me the actual moment.`,
        `Too thin. I can't picture a human being using this from that.`
      ],
      strong: [
        `Now that's the user's side of it: "${q}". Good. You went and asked real people.`,
        `${num ? `${num} — ` : ""}that's the kind of detail that makes me believe someone actually felt this problem.`
      ],
      mid: [
        `I see the product in "${q}", but I still can't see the person who can't live without it.`,
        `That's describing what you built. I'm still waiting on who is hurting without it.`
      ]
    },
    skeptic: {
      bigClaim: [
        `"${bigPhrase}". There is always competition. If nothing else, it's whatever your customer does today. Name it.`,
        `"${claimQuote}" — that's the sentence I trust least in any pitch. Convince me otherwise.`
      ],
      hedge: [
        `"${hedgeQuote}". Everything you just said depends on "${hedge}", and that's exactly where startups die.`,
        `So the plan rests on "${hedge}". That's not a plan, that's a hope with a logo.`
      ],
      short: [
        `That was a dodge. If you can't defend it in one breath, you can't defend it to a customer.`,
        `Short answers are where weak ideas hide. Try again.`
      ],
      strong: [
        `Fair. "${q}" is at least a real answer. It's not a wall yet, but it's a start.`,
        `${num ? `${num}? ` : ""}Okay, I can't wave that away. I'll come back and try to break it anyway.`
      ],
      mid: [
        `I'm not convinced by "${q}", but I'm not dismissing it either. Keep going.`,
        `That holds up for now. Let's see whether it survives the next question.`
      ]
    }
  };

  const voice = V[shark] || V.dealmaker;
  if (bigPhrase) return pickVariant(voice.bigClaim, seed);
  if (a.hedges.length >= 2 || (a.hedges.length && weak)) return pickVariant(voice.hedge, seed);
  if (tooShort) return pickVariant(voice.short, seed);
  if (strong) return pickVariant(voice.strong, seed);
  return pickVariant(voice.mid, seed);
}

/* ------------------------------------------------------------------ */
/* Question topics                                                     */
/* ------------------------------------------------------------------ */

function buildTopics(ctx) {
  const { name, customer, pitch, all, an } = ctx;
  const ask = String(pitch.fundingAsk || "").trim();
  const price = moneyToken(all);
  const channel = (all.match(RX.channel) || [""])[0];

  return {
    dealmaker: [
      {
        id: "price",
        focus: "Pricing",
        difficulty: "medium",
        needed: !an.hasPrice,
        text: an.hasPrice && price
          ? `You mention ${price}. Who has actually agreed to pay that, and who have you only assumed will?`
          : `Before anything else on ${name}: who writes the cheque, how much, and how often? A real price, not a pricing model.`
      },
      {
        id: "traction",
        focus: "Proof of demand",
        difficulty: "hard",
        needed: !(an.evidence.length && an.numbers.length),
        text: `What's the strongest proof of demand you have right now? A number, not a feeling.`
      },
      {
        id: "economics",
        focus: "Unit economics",
        difficulty: "hard",
        needed: true,
        text: `Walk me through one customer of ${name}: what does it cost you to win them, what do you earn from them, and how long until you're in profit on that customer?`
      },
      {
        id: "channel",
        focus: "Acquisition",
        difficulty: "hard",
        needed: !an.hasChannel,
        text: an.hasChannel && channel
          ? `${channel.charAt(0).toUpperCase() + channel.slice(1)} might get you the first hundred. What's the engine for the next ten thousand ${customer}?`
          : `Your first hundred customers: where do you actually find them, and what does each one cost you?`
      },
      {
        id: "ask",
        focus: "The ask",
        difficulty: "medium",
        needed: true,
        text: ask
          ? `You're asking for ${ask}. What does that money buy in the next twelve months, and which number moves because of it?`
          : `You haven't told me what you're asking for. How much, for what stake, and what does it buy?`
      },
      {
        id: "scale",
        focus: "Scale",
        difficulty: "brutal",
        needed: true,
        text: `If this works, how big does ${name} really get? Skip "the market is X billion" and tell me how many ${customer} you can realistically reach, and what each is worth.`
      }
    ],
    product: [
      {
        id: "pain",
        focus: "The real problem",
        difficulty: "medium",
        needed: true,
        text: `Forget the product for a second. Describe the last time ${customer} actually felt this problem: what happened, and what did they do about it?`
      },
      {
        id: "alternative",
        focus: "Today's alternative",
        difficulty: "medium",
        needed: !an.competitor.length,
        text: `What do ${customer} do today instead, and why is that not good enough?`
      },
      {
        id: "evidence",
        focus: "User evidence",
        difficulty: "hard",
        needed: !an.hasResearch,
        text: `How many ${customer} have you actually spoken to, and what's the one thing they said that surprised you?`
      },
      {
        id: "first_use",
        focus: "Product experience",
        difficulty: "medium",
        needed: true,
        text: `Walk me through the first sixty seconds a new user spends with ${name}. What do they do, and when do they feel the "aha"?`
      },
      {
        id: "retention",
        focus: "Retention",
        difficulty: "hard",
        needed: true,
        text: `Say they try it once. What brings them back in week two?`
      },
      {
        id: "difference",
        focus: "Differentiation",
        difficulty: "hard",
        needed: true,
        text: `Put ${name} next to what they use today. What's the one difference a user would notice within five minutes?`
      }
    ],
    skeptic: [
      {
        id: "assumption",
        focus: "Biggest assumption",
        difficulty: "hard",
        needed: true,
        text: `What's the one assumption that kills ${name} if it's wrong, and what have you done to test it?`
      },
      {
        id: "copy",
        focus: "Defensibility",
        difficulty: "brutal",
        needed: !an.moat.length,
        text: an.moat.length
          ? `You mention ${an.moat[0]}. Does that actually stop a well-funded competitor, or just slow them down for a quarter?`
          : `A well-funded competitor copies this in six months. What do you have that they can't just buy or build?`
      },
      {
        id: "bigplayer",
        focus: "Competition",
        difficulty: "hard",
        needed: true,
        text: `Why hasn't a big company already done this? Either they tried and failed, or they don't care. Which is it, and what does that tell you?`
      },
      {
        id: "risk",
        focus: "Hidden risk",
        difficulty: "hard",
        needed: true,
        text: `What's the ugliest operational, legal or trust risk in ${name} that you haven't mentioned yet?`
      },
      {
        id: "team",
        focus: "Why you",
        difficulty: "medium",
        needed: true,
        text: `Why are you the person to build this? What do you know that an equally smart stranger wouldn't?`
      },
      {
        id: "failure",
        focus: "Failure mode",
        difficulty: "brutal",
        needed: true,
        text: `It's twelve months from now and ${name} has failed. What's the most likely reason?`
      }
    ]
  };
}

// A targeted challenge built from something suspicious in the latest answer.
function buildChallenge(lastAnswer, a, name, customer) {
  if (a.saysEveryone || a.bigClaims.some((c) => /everyone|everybody|anyone|anybody|all people/i.test(c))) {
    const q = pickQuote(lastAnswer, RX.everyone);
    return {
      shark: "skeptic",
      focus: "Too broad",
      difficulty: "brutal",
      text: `You said "${q}". Nobody builds for everyone. Pick one person and tell me who customer number one is, specifically.`
    };
  }
  if (a.bigClaims.some((c) => /competit/i.test(c))) {
    return {
      shark: "skeptic",
      focus: "No competitors?",
      difficulty: "brutal",
      text: `"No competition" means either there's no market or you haven't looked hard enough. What does ${customer} do today instead of using ${name}?`
    };
  }
  if (a.hedges.length >= 2 && !a.numbers.length) {
    const q = pickQuote(lastAnswer, RX.hedge);
    return {
      shark: "dealmaker",
      focus: "Hope vs evidence",
      difficulty: "hard",
      text: `"${q}". Take every "maybe" out of that. What has already happened that I can verify?`
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Next turn                                                           */
/* ------------------------------------------------------------------ */

export function countByShark(history) {
  return SHARK_KEYS.reduce((acc, key) => {
    acc[key] = (history || []).filter((item) => item.shark === key).length;
    return acc;
  }, {});
}

export function chooseShark(history, preferred = null) {
  const counts = countByShark(history);
  const last = history.at(-1)?.shark || null;
  if (preferred && counts[preferred] < 3 && preferred !== last) return preferred;
  const min = Math.min(...SHARK_KEYS.map((k) => counts[k]));
  const pool = SHARK_KEYS.filter((k) => counts[k] === min);
  return pool.find((k) => k !== last) || pool[0] || SHARK_KEYS.find((k) => k !== last) || "dealmaker";
}

function questionPayload(shark, topic, extra = {}) {
  return {
    type: "question",
    shark,
    sharkName: SHARKS[shark].name,
    role: SHARKS[shark].role,
    question: topic.text,
    difficulty: topic.difficulty || "hard",
    focus: topic.focus || SHARKS[shark].role,
    topic: topic.id,
    ...extra
  };
}

function nextQuestionFor(shark, ctx, history) {
  const asked = new Set((history || []).map((h) => h.topic).filter(Boolean));
  const list = buildTopics(ctx)[shark];
  const fresh = list.filter((t) => !asked.has(t.id));
  const topic =
    fresh.find((t) => t.needed) ||
    fresh[0] || {
      id: `closing_${history.length}`,
      focus: "Closing pressure",
      difficulty: "brutal",
      text: `Give me your single strongest reason I should write a cheque to ${ctx.name} today. One reason, no list.`
    };
  return questionPayload(shark, topic);
}

export function localTurn(pitch, history = [], lastAnswer = "", currentScore = 50) {
  const baseCtx = {
    pitch,
    name: startupLabel(pitch),
    customer: customerLabel(pitch),
    all: allText(pitch, history, lastAnswer),
    an: analyzeText(allText(pitch, history, lastAnswer))
  };

  // Opening: the DealMaker always goes first, grounded in what the pitch actually contains.
  if (!lastAnswer) {
    const open = nextQuestionFor("dealmaker", baseCtx, []);
    const opener = pitch.fullPitch && !pitch.problem
      ? `I've heard you out. Let me start with the money.`
      : `${startupLabel(pitch) === "this idea" ? "Okay" : startupLabel(pitch)}. I've read it. Let me start with the money.`;
    return { ...open, question: `${opener} ${open.question}`, scoreDelta: 0, scoreReason: "The panel is sizing up your pitch.", sharkResponse: null, responseShark: null };
  }

  const prior = history.slice(0, -1).map((h) => h.answer);
  const { delta, analysis } = scoreAnswer(lastAnswer, prior);
  const lastShark = history.at(-1)?.shark || "dealmaker";
  const counts = countByShark(history);
  const h = history.length;
  const covered = SHARK_KEYS.every((k) => counts[k] >= 2);
  const sharkResponse = reactionFor(lastShark, analysis, delta, lastAnswer, h);

  const reasons = {
    strong: "Specific, evidence-backed answer.",
    ok: "Reasonable answer, but the evidence is thin.",
    weak: "Vague or unsupported; the panel noticed.",
    flag: "A red-flag claim cost you credibility."
  };
  const reason = analysis.bigClaims.length ? reasons.flag : delta >= 5 ? reasons.strong : delta >= 0 ? reasons.ok : reasons.weak;

  const lastWasChallenge = history.at(-1)?.topic === "challenge";
  const wantsExtraPressure = covered && h >= MIN_QUESTIONS && h < MAX_QUESTIONS - 1 && delta <= -4 && !lastWasChallenge;
  const finished = h >= MAX_QUESTIONS || (h >= MIN_QUESTIONS && covered && !wantsExtraPressure);

  if (finished) {
    return { type: "finish", scoreDelta: delta, scoreReason: reason, sharkResponse, responseShark: lastShark };
  }

  const ctx = { ...baseCtx, an: analyzeText(allText(pitch, history, "")) };
  const challenge = delta <= -3 && !lastWasChallenge ? buildChallenge(lastAnswer, analysis, ctx.name, ctx.customer) : null;

  if (challenge) {
    const shark = challenge.shark === lastShark && counts[challenge.shark] >= 3 ? chooseShark(history) : challenge.shark;
    return {
      ...questionPayload(shark, { id: "challenge", ...challenge }),
      scoreDelta: delta,
      scoreReason: reason,
      sharkResponse,
      responseShark: lastShark
    };
  }

  const shark = wantsExtraPressure ? lastShark : chooseShark(history);
  return {
    ...nextQuestionFor(shark, ctx, history),
    scoreDelta: delta,
    scoreReason: reason,
    sharkResponse,
    responseShark: lastShark
  };
}

/* ------------------------------------------------------------------ */
/* Final evaluation                                                    */
/* ------------------------------------------------------------------ */

const DIM_LABEL = {
  problem: "Problem",
  market: "Market",
  product: "Product",
  businessModel: "Business model",
  differentiation: "Differentiation",
  defensibility: "Defensibility"
};

function dimScore(text, extraDeltas = []) {
  const a = analyzeText(text);
  let s = 38;
  s += Math.min(14, a.words / 8);
  s += Math.min(10, a.numbers.length * 2.5);
  s += Math.min(9, a.evidence.length * 3);
  s += a.hasResearch ? 4 : 0;
  s += a.hasPrice ? 3 : 0;
  s += a.competitor.length ? 3 : 0;
  s += Math.min(8, a.moat.length * 4);
  s -= Math.min(10, a.hedges.length * 3);
  s -= Math.min(15, a.bigClaims.length * 5);
  if (a.saysEveryone) s -= 6;
  if (extraDeltas.length) s += (extraDeltas.reduce((x, y) => x + y, 0) / extraDeltas.length) * 2;
  return clamp(Math.round(s), 18, 92);
}

export function localEvaluation(pitch, history = [], liveScore = 50) {
  const name = startupLabel(pitch);
  const customer = customerLabel(pitch);

  const items = history.map((h) => {
    const s = scoreAnswer(h.answer || "");
    return { ...h, _delta: typeof h.scoreDelta === "number" ? h.scoreDelta : s.delta };
  });
  const answersFor = (topics) => items.filter((i) => topics.includes(i.topic));
  const textOf = (list) => list.map((i) => i.answer).join(". ");
  const deltasOf = (list) => list.map((i) => i._delta);
  const free = pitch.fullPitch || "";

  const sets = {
    problem: answersFor(["pain", "evidence", "alternative"]),
    market: answersFor(["scale", "channel", "traction"]),
    product: answersFor(["first_use", "retention", "difference"]),
    businessModel: answersFor(["price", "economics", "ask"]),
    differentiation: answersFor(["alternative", "difference", "bigplayer"]),
    defensibility: answersFor(["copy", "bigplayer", "risk", "failure", "assumption"])
  };

  const base = {
    problem: pitch.problem || free,
    market: [pitch.targetCustomer, free].filter(Boolean).join(". "),
    product: pitch.solution || free,
    businessModel: [pitch.businessModel, pitch.fundingAsk, free].filter(Boolean).join(". "),
    differentiation: [pitch.solution, free].filter(Boolean).join(". "),
    defensibility: free
  };

  const dims = {};
  for (const key of Object.keys(DIM_LABEL)) {
    // Fall back to all answers if topic-tagged answers aren't available (e.g. answers came from the AI).
    const matched = sets[key].length > 0;
    const list = matched ? sets[key] : items;
    // Evidence for this area was never probed directly, so don't give full credit for unrelated answers.
    dims[key] = clamp(dimScore(`${base[key]}. ${textOf(list)}`, deltasOf(list)) - (matched ? 0 : 7), 18, 92);
  }

  const mean = Object.values(dims).reduce((a, b) => a + b, 0) / 6;
  const overall = clamp(Math.round(mean * 0.65 + clamp(liveScore, 0, 100) * 0.35), 15, 95);

  const verdictOf = (v) => (v >= 72 ? "INVEST" : v >= 55 ? "MAYBE" : "PASS");
  const verdicts = {
    dealmaker: verdictOf(dims.businessModel * 0.5 + dims.market * 0.3 + overall * 0.2),
    product: verdictOf(dims.problem * 0.4 + dims.product * 0.4 + dims.differentiation * 0.2),
    skeptic: verdictOf(dims.differentiation * 0.35 + dims.defensibility * 0.45 + overall * 0.2 - 4)
  };

  const ranked = Object.entries(dims).sort((a, b) => b[1] - a[1]);
  const best = ranked[0][0];
  const worst = ranked.at(-1)[0];
  const lowThree = ranked.slice(-3).map(([k]) => k);

  const bestItem = [...items].sort((a, b) => b._delta - a._delta)[0];
  const worstItem = [...items].sort((a, b) => a._delta - b._delta)[0];
  const bestQuote = bestItem ? pickQuote(bestItem.answer) : "";
  const worstQuote = worstItem && worstItem._delta < 3 ? pickQuote(worstItem.answer) : "";

  const strongestPoint = dims[best] < 45
    ? `No area convinced the panel yet. ${DIM_LABEL[best]} was relatively your best at ${dims[best]}/100, and it still needs a concrete number or a real customer story.`
    : bestQuote && bestItem._delta > 0
      ? `${DIM_LABEL[best]} is your firmest ground (${dims[best]}/100). Your best moment was answering ${SHARKS[bestItem.shark]?.name || "the panel"}: "${bestQuote}".`
      : `${DIM_LABEL[best]} is your firmest ground at ${dims[best]}/100, but nothing you said was backed by hard evidence yet.`;

  const biggestWeakness = worstQuote
    ? `${DIM_LABEL[worst]} (${dims[worst]}/100) is the gap. The panel flagged "${worstQuote}" as the least convincing moment.`
    : `${DIM_LABEL[worst]} (${dims[worst]}/100) is the gap. The sharks left that area without a concrete, verifiable answer.`;

  const keyMoment = bestItem
    ? `${SHARKS[bestItem.shark]?.name || "The panel"} got the clearest evidence from you here: "${bestQuote}".`
    : "No single answer gave the panel enough evidence to call it a turning point.";
  const costlyMoment = worstItem
    ? `${SHARKS[worstItem.shark]?.name || "The panel"} got the weakest answer here: "${pickQuote(worstItem.answer)}". That left ${DIM_LABEL[worst].toLowerCase()} unresolved.`
    : "The biggest cost was what you did not prove: a concrete, verifiable business assumption.";

  const fix = {
    problem: `Prove the problem with ${customer}: speak to 10 of them this week and bring back their exact words and what they do today.`,
    market: `Narrow ${name} to one first segment of ${customer} and size it bottom-up: how many people, reached how, worth how much each.`,
    product: `Define the first 60 seconds and the reason for a second visit: show what a new user does and why they return in week two.`,
    businessModel: `Put one real price on ${name}, then show unit economics for a single customer: cost to win, revenue per month, payback time.`,
    differentiation: `Name the thing ${customer} use today and state the one difference they'd notice in five minutes.`,
    defensibility: `Say what a funded competitor can't copy in six months (data, partnerships, supply, distribution) and show early proof of it.`
  };
  const improvements = lowThree.reverse().map((k) => fix[k]);

  const strongItem = items.filter((i) => i._delta >= 4 && analyzeText(i.answer).numbers.length).sort((a, b) => b._delta - a._delta)[0];
  const priceItem = items.find((i) => i.topic !== "ask" && (analyzeText(i.answer).hasMoney || /\b(price|commission|subscription|per (month|user|order))\b/i.test(i.answer)) && i._delta >= 0);
  const moatItem = items.find((i) => RX.moat.test(i.answer) && i._delta >= 0);
  const lc = (t) => t.replace(/^./, (c) => c.toLowerCase());
  const end1 = (t) => String(t).trim().replace(/[.!?…]+$/, "") + ".";

  const parts = [];
  if (pitch.fullPitch) {
    parts.push(end1(firstSentences(pitch.fullPitch, 2, 260)));
  } else {
    parts.push(`${name === "this idea" ? "We" : name} helps ${customer}.`);
    if (pitch.problem) parts.push(`The problem: ${end1(firstSentences(pitch.problem, 1, 170))}`);
    if (pitch.solution) parts.push(`Our solution: ${end1(firstSentences(pitch.solution, 1, 170))}`);
  }
  if (pitch.businessModel) parts.push(`How we earn: ${end1(firstSentences(pitch.businessModel, 1, 150))}`);
  else if (priceItem) parts.push(`How we earn: ${end1(firstSentences(priceItem.answer, 2, 220))}`);
  else parts.push(`[Add: who pays, how much, how often, as one real price.]`);
  if (strongItem) {
    // If the same answer already supplied the pricing line, use its remaining sentences as the proof.
    const sents = splitSentences(strongItem.answer);
    const proof = strongItem === priceItem && !pitch.businessModel ? sents.slice(2).join(" ") : sents.slice(0, 2).join(" ");
    parts.push(proof ? `Proof so far: ${end1(trimQuote(proof, 230))}` : `[Add your strongest proof: users interviewed, pilots run, paying customers, signed letters of intent.]`);
  }
  else parts.push(`[Add your strongest proof: users interviewed, pilots run, paying customers, signed letters of intent.]`);
  if (moatItem) parts.push(`Why we're hard to copy: ${end1(firstSentences(moatItem.answer, 1, 200))}`);
  else parts.push(`[Add: why a bigger competitor can't copy this in six months.]`);
  parts.push(pitch.fundingAsk ? `The ask: ${pitch.fundingAsk}, and [add: the exact milestone it buys in 12 months].` : `[Add: the amount you're asking for, the stake, and what it buys.]`);

  return {
    ...dims,
    overall,
    strongestPoint,
    biggestWeakness,
    keyMoment,
    costlyMoment,
    improvements,
    verdicts,
    improvedPitch: parts.join(" ")
  };
}
