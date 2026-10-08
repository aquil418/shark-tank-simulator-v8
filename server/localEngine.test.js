import test from "node:test";
import assert from "node:assert/strict";
import { analyzeText, scoreAnswer, localTurn, localEvaluation } from "./localEngine.js";

test("specific answers score better than vague claims", () => {
  const weak = scoreAnswer("Everyone will love it and it will go viral.");
  const strong = scoreAnswer("We interviewed 42 students, 18 paid ₹25 per order, and 31% returned within two weeks.");
  assert.ok(strong.delta > weak.delta);
});

test("signal detector catches broad claims and evidence", () => {
  const a = analyzeText("Everyone is our customer, but we interviewed 20 students and 5 are paying ₹25.");
  assert.equal(a.saysEveryone, true);
  assert.ok(a.evidence.length > 0);
  assert.ok(a.numbers.length >= 2);
});

test("offline opening is grounded in the pitch", () => {
  const turn = localTurn({ startupName: "CampusBite", problem: "Students waste time getting food", solution: "Fast campus delivery", targetCustomer: "Hostel students" }, [], "", 50);
  assert.equal(turn.type, "question");
  assert.match(turn.question, /CampusBite/i);
});

test("offline engine reacts to a weak answer instead of silently moving on", () => {
  const history = [{ shark: "dealmaker", question: "Who pays and how much?", answer: "Everyone will pay because it is cheap.", topic: "price" }];
  const turn = localTurn({ startupName: "CampusBite", targetCustomer: "students", solution: "delivery" }, history, history[0].answer, 50);
  assert.ok(turn.sharkResponse);
  assert.ok(turn.scoreDelta <= 0);
});

test("local evaluation returns the complete judge report", () => {
  const pitch = { startupName: "CampusBite", problem: "Food access", solution: "Delivery", targetCustomer: "students", businessModel: "₹25 per order" };
  const history = [{ shark: "dealmaker", question: "Who pays?", answer: "Students pay ₹25 per order and we interviewed 30 students.", topic: "price", scoreDelta: 5 }];
  const result = localEvaluation(pitch, history, 55);
  assert.equal(typeof result.overall, "number");
  assert.equal(typeof result.keyMoment, "string");
  assert.equal(typeof result.costlyMoment, "string");
  assert.deepEqual(Object.keys(result.verdicts).sort(), ["dealmaker", "product", "skeptic"]);
  assert.equal(result.improvements.length, 3);
});
