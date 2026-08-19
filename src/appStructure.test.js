import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Judge inactive return occurs after Judge hooks are declared", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const judgeStart = source.indexOf("function JudgeScreen");
  const judgeEnd = source.indexOf("export default function App", judgeStart);
  const judgeSource = source.slice(judgeStart, judgeEnd);
  const inactiveReturn = judgeSource.indexOf("if (judgeId > activeJudgeCount(meta))");
  const finalJudgeHook = judgeSource.indexOf("const binarySendingRef = useRef(false)");
  assert.ok(judgeStart >= 0 && judgeEnd > judgeStart);
  assert.ok(finalJudgeHook >= 0);
  assert.ok(inactiveReturn > finalJudgeHook);
});

test("stale President actions are guarded by evaluationId", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /resetAll\(meta\.evaluationId\)/);
  assert.match(source, /const expectedEvaluationId = meta\.evaluationId;[\s\S]*?runCriticalAction\("forced"[\s\S]*?isExpectedEvaluation\(current, expectedEvaluationId\)/);
  assert.match(source, /const expectedEvaluationId = meta\.evaluationId;[\s\S]*?finishByTime[\s\S]*?isExpectedEvaluation\(current, expectedEvaluationId\)/);
});
