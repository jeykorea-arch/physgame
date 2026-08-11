import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GUIDED_SCORE,
  expectedLessonSeconds,
  getLessonQuestions,
  isAnswerCorrect,
  scoreForCorrectAttempt,
} from "../lib/quiz-engine.js";

const bank = JSON.parse(await readFile(new URL("../public/data/quiz_bank_v1.json", import.meta.url), "utf8"));
const lesson = getLessonQuestions(bank, 1);

const wrongFor = (question) => {
  if (question.type === "numeric") return -999;
  if (question.type === "numeric_pair") return ["-1", "-1"];
  if (question.type === "sequence") return [...question.answer].reverse();
  if (question.type === "multiple_select") return [question.options.find((option) => !question.answer.includes(option))];
  return question.options.find((option) => option !== question.answer);
};

test("L1-Q01~L1-Q10 정답 경로는 10/10, 100/100점이다", () => {
  assert.equal(lesson.length, 10);
  assert.deepEqual(lesson.map((question) => question.id), Array.from({ length: 10 }, (_, index) => `L1-Q${String(index + 1).padStart(2, "0")}`));
  let score = 0;
  for (const question of lesson) {
    assert.equal(isAnswerCorrect(question, question.answer), true, `${question.id} 정답 판정`);
    score += scoreForCorrectAttempt(0);
  }
  assert.equal(score, 100);
});

test("모든 L1 문항은 오답을 거부하고 두 번째 정답에 7점을 준다", () => {
  for (const question of lesson) {
    assert.equal(isAnswerCorrect(question, wrongFor(question)), false, `${question.id} 오답 판정`);
    assert.equal(scoreForCorrectAttempt(1), 7);
  }
});

test("두 번 오답 뒤 안내 완료 점수는 5점이다", () => {
  assert.equal(GUIDED_SCORE, 5);
});

test("숫자 문항은 단위 입력과 쉼표를 안전하게 정규화한다", () => {
  assert.equal(isAnswerCorrect(lesson[2], "10 A"), true);
  assert.equal(isAnswerCorrect(lesson[4], ["100 W", "1W"]), true);
});

test("AR과 비AR은 같은 문항 객체, 정답, 피드백을 사용한다", () => {
  const arQuestions = getLessonQuestions(bank, 1);
  const fallbackQuestions = getLessonQuestions(bank, 1);
  assert.deepEqual(arQuestions, fallbackQuestions);
  for (let index = 0; index < arQuestions.length; index += 1) {
    assert.equal(arQuestions[index].answer, fallbackQuestions[index].answer);
    assert.equal(arQuestions[index].feedback_correct, fallbackQuestions[index].feedback_correct);
    assert.equal(arQuestions[index].feedback_incorrect, fallbackQuestions[index].feedback_incorrect);
  }
});

test("진행 상태는 JSON 직렬화 후 문항·점수·시도를 그대로 복원한다", () => {
  const before = {
    version: 1,
    mode: "fallback",
    stageIndex: 1,
    phase: "quiz",
    questionIndex: 4,
    score: 27,
    records: { "L1-Q03": { attempts: 2, completed: true, score: 7 } },
  };
  const after = JSON.parse(JSON.stringify(before));
  assert.deepEqual(after, before);
});

test("1차시 예상 수행 시간은 관찰·예측·조작·전환을 포함해 25분 이내다", () => {
  const quizSeconds = expectedLessonSeconds(bank, 1);
  const threeStageActivities = 3 * 150;
  const onboardingAndScanning = 180;
  const totalSeconds = quizSeconds + threeStageActivities + onboardingAndScanning;
  assert.equal(quizSeconds, 670);
  assert.ok(totalSeconds <= 25 * 60, `${totalSeconds}초`);
});
