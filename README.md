# 🦈 Shark Tank Simulator

### Pitch your idea. Survive the sharks.

Shark Tank Simulator is an AI investor simulation built for the Prompt Arena hackathon. Instead of behaving like a questionnaire, it turns a startup pitch into an adaptive investor conversation: the sharks remember claims, attack weak assumptions, disagree with each other, track their own interest, and can walk away.

## What makes it different?

- 🦈 Three distinct investor personalities: DealMaker, Product Shark, Skeptic
- 🔥 Live Pitch Heat: the temperature of the whole room
- 🔥 Personal investor heat: each shark can become interested, go on edge, or leave
- 🧠 Contextual follow-up questions grounded in the founder's actual words
- ⚔️ Pressure and attack-target tracking for every question
- 🚨 Dodge detection: sharks call out answers that do not answer the question
- 🗣️ Panel interruptions: sharks can challenge or support each other
- 🚪 A shark can walk out when confidence collapses
- 🎙️ Optional browser voice input
- 📊 Six-dimension final evaluation
- 🏆 "The Room" investor recap
- ⚡ Key Moment + 💀 Costly Moment from the actual pitch
- ✍️ Three concrete improvements and an improved pitch
- 📴 Offline contextual fallback when Gemini is unavailable

## The problem

Most pitch-practice tools follow a predictable loop: question → answer → next question. That teaches a founder to fill a form, not defend a business.

Shark Tank Simulator is designed around the harder interaction: **make a claim → defend it → face the consequence → adapt.**

## Architecture

```text
Browser / React
     │
     │ same-origin JSON
     ▼
Node + Express on Cloud Run
     │
     ├── input validation + request limits
     ├── investor state / heat normalization
     ├── structured Gemini interaction
     │
     ▼
Gemini 3.8 Flash
     │
     └── structured JSON: reaction, attack, pressure, next question, heat

If Gemini is unavailable:
     └── localEngine.js → deterministic contextual investor fallback
```

The Gemini API key is **server-side only**. It is never placed in React source, browser state, or client-side requests.

## Tech stack

- React 19 + Vite
- Node.js + Express
- Gemini API / Gemini 3.8 Flash
- Google Cloud Run
- Browser Web Speech API for optional voice input

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

### Configure Gemini

Copy `server/.env.example` to `server/.env` and set:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.8-flash
PORT=8080
```

Never commit `server/.env`.

The app displays either **LIVE AI** or **OFFLINE PANEL** so a demo never hides which engine is actually running.

## Testing

Run the automated local-engine tests:

```bash
npm test
```

Then follow `TEST_PLAN.md` for the manual live-AI, browser, security and Cloud Run checks.

## Security checklist

Before publishing:

```bash
git check-ignore -v server/.env
```

The command should confirm that `.env` is ignored.

Also verify:

- no API key appears in source files
- no `.env` is tracked by Git
- `node_modules` and `dist` are excluded
- request bodies are size-limited
- API routes have a lightweight rate limit
- production security headers are enabled

## Deployment

This project includes a Dockerfile and is designed for Google Cloud Run.

For a source deployment:

```bash
gcloud run deploy shark-tank-simulator --source . --region REGION
```

Configure the Gemini key as a Cloud Run secret/environment configuration rather than committing it to source.

After deployment, test the public URL in a private/incognito window before submitting it.

## Files

```text
client/src/main.jsx          React application and investor-room UI
client/src/styles.css        UI, animations and responsive layout
client/public/avatars/       Local shark avatar artwork
server/index.js              Express API + Gemini integration
server/localEngine.js        Offline contextual investor engine
server/localEngine.test.js   Automated engine tests
TEST_PLAN.md                 Manual release checklist
ARCHITECTURE.md              Technical architecture notes
```

## Demo flow

1. Enter a structured or free-form pitch.
2. DealMaker opens with a specific business question.
3. Answer by typing or voice.
4. The shark reacts to the exact answer.
5. Global Pitch Heat and personal investor heat change.
6. Weak answers increase pressure; evasive answers can be called out.
7. Sharks may challenge one another.
8. A shark can leave the room.
9. End the pitch for a full investor verdict.
10. Review the strongest point, biggest weakness, key moment, costly moment and improved pitch.
