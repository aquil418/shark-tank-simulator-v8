# Release test plan

## Automated

- [x] `npm test` passes the local investor-engine tests.

## Pitch entry

- [ ] Structured pitch rejects missing startup name, problem, solution or customer.
- [ ] Free-form pitch rejects an empty pitch.
- [ ] Both pitch modes start the same investor-room flow.

## Investor behaviour

- [ ] DealMaker opens with a question grounded in the pitch.
- [ ] A vague answer gets challenged instead of immediately causing a generic topic switch.
- [ ] A specific answer with numbers/evidence gets an acknowledging reaction.
- [ ] The reaction references the founder's actual words.
- [ ] The next question follows from the answer or an unresolved claim.
- [ ] A dodge is explicitly called out.
- [ ] Repeated dodging increases pressure.
- [ ] Personal shark heat changes after answers.
- [ ] Global Pitch Heat changes after answers.
- [ ] Sharks do not ask questions after reaching OUT.
- [ ] A shark walk-out is visually obvious.
- [ ] Panel-conflict interruptions appear occasionally and do not contain a second question.
- [ ] No shark repeats the same question or lightly rewords it.
- [ ] The interview finishes within the configured 6–9 answer range.

## UI / accessibility

- [ ] Shark avatars are visible and have meaningful alt text.
- [ ] Current question, reactions and pressure are understandable without color alone.
- [ ] Keyboard Enter sends; Shift+Enter creates a new line.
- [ ] Visible focus state works for controls.
- [ ] Answer textarea has an accessible label.
- [ ] Reaction area uses `aria-live` so screen readers can notice the response.
- [ ] Layout works at desktop and narrow mobile widths.
- [ ] Contrast is readable in dark mode.

## Final verdict

- [ ] Six dimension scores render.
- [ ] The Room shows all three investor outcomes and personal heat.
- [ ] Strongest point and biggest weakness are grounded in the transcript.
- [ ] Key Moment is grounded in an actual answer/exchange.
- [ ] Costly Moment identifies the most damaging weak answer or missing proof.
- [ ] Exactly three improvements render.
- [ ] Improved pitch does not invent unsupported facts.

## Security

- [ ] `server/.env` is not tracked by Git.
- [ ] `git check-ignore -v server/.env` reports the ignore rule.
- [ ] No API key appears in the React bundle.
- [ ] No API key appears in browser request bodies.
- [ ] Oversized JSON is rejected.
- [ ] Repeated API requests are rate limited.
- [ ] Production security headers are present.
- [ ] No secret is present in README, screenshots or demo video.

## Live AI

- [ ] `/api/health` reports `LIVE AI` when a valid key is configured.
- [ ] Gemini 3.8 Flash returns a structured interaction.
- [ ] A Gemini timeout does not leave the UI permanently thinking.
- [ ] A Gemini failure falls back cleanly to the local panel.
- [ ] Evaluation also works with live Gemini.

## Deployment

- [ ] `npm run build` succeeds locally before deployment.
- [ ] Cloud Run service starts on its assigned `PORT`.
- [ ] Public Cloud Run URL loads in a private window.
- [ ] A full pitch can be completed from the public URL.
- [ ] Voice input works in a supported browser or is gracefully absent.
- [ ] No `.env`, `node_modules` or `dist` is in the Git repository.
- [ ] GitHub repository is public, exactly one branch, and under 10 MB.
