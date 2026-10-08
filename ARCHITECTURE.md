# Architecture Notes

## Request flow

`POST /api/question` receives only the current pitch, bounded conversation history, latest founder answer, global heat and investor heat.

The server sanitizes those inputs before they reach Gemini. Gemini receives a single control prompt plus a strict JSON schema. The response is normalized again on the server so malformed values cannot directly control the UI.

The server returns:

- next shark
- next question
- difficulty
- focus / attack target
- pressure
- reaction to the previous answer
- global heat delta
- personal shark heat delta
- dodge flag
- optional panel conflict
- walk-out flag

The browser owns presentation state. The API key never crosses the browser boundary.

## Investor state

Each shark begins at 50/100 personal heat.

```text
35+     IN
25–34   ON EDGE
10–24   READY TO WALK
0       OUT
```

A shark who reaches 0 is not eligible to receive another question in the live session.

## Global Pitch Heat

Pitch Heat starts at 50/100. Every answer can move it based on specificity, evidence, numbers, credible economics and the presence of unsupported claims or contradictions.

## Fallback

`server/localEngine.js` is intentionally contextual rather than a fixed question list. It detects signals such as:

- unsupported broad claims
- hedging
- numbers
- evidence
- competitors
- pricing
- distribution
- defensibility

It is used when Gemini is not configured or when a live request fails.

## Final evaluation

The evaluator scores:

- Problem
- Market
- Product
- Business model
- Differentiation
- Defensibility
- Overall

It also produces investor verdicts, strongest point, biggest weakness, key moment, costly moment, three improvements and an improved pitch.

## Production considerations

Cloud Run provides the public service endpoint. The service listens on `PORT` and serves the built React application from Express. Gemini credentials should be provided through Cloud Run secret/configuration mechanisms, not source control.
