import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getLessonConfig } from "../lib/lesson-config.js";
import { GUIDED_SCORE, expectedLessonSeconds, getLessonQuestions, isAnswerCorrect, scoreForCorrectAttempt } from "../lib/quiz-engine.js";

const bank = JSON.parse(await readFile(new URL("../public/data/quiz_bank_v1.json", import.meta.url), "utf8"));
const lessons = [1, 2, 3].map((number) => getLessonQuestions(bank, number));

const correctFor = (question) => question.type === "short_answer_rubric"
  ? "전력망에서는 전압을 높이고 낮추고, 충전기에서는 전류를 한쪽으로 만든 뒤 전압 골짜기를 메우고 스위칭으로 출력을 조절한다."
  : question.answer;

const wrongFor = (question) => {
  if (question.type === "numeric") return -999;
  if (question.type === "numeric_pair") return ["-1", "-1"];
  if (question.type === "sequence") return [...question.answer].reverse();
  if (question.type === "multiple_select") return [question.options.find((option) => !question.answer.includes(option))];
  if (question.type === "short_answer_rubric") return "전기는 그냥 이동한다.";
  return question.options.find((option) => option !== question.answer);
};

test("L1-Q01~L3-Q30 정답 경로는 차시별 10/10, 100/100점이다", () => {
  lessons.forEach((questions, index) => {
    const lessonNumber = index + 1;
    assert.equal(questions.length, 10);
    assert.deepEqual(questions.map((question) => question.id), Array.from({ length: 10 }, (_, questionIndex) => `L${lessonNumber}-Q${String(lessonNumber * 10 - 9 + questionIndex).padStart(2, "0")}`));
    let score = 0;
    questions.forEach((question) => {
      assert.equal(isAnswerCorrect(question, correctFor(question)), true, `${question.id} 정답 판정`);
      score += scoreForCorrectAttempt(0);
    });
    assert.equal(score, 100);
  });
});

test("30문항 모두 오답을 거부하고 두 번째 정답에 7점을 준다", () => {
  lessons.flat().forEach((question) => {
    assert.equal(isAnswerCorrect(question, wrongFor(question)), false, `${question.id} 오답 판정`);
    assert.equal(scoreForCorrectAttempt(1), 7);
  });
});

test("두 번 오답 뒤 안내 완료 점수는 5점이다", () => assert.equal(GUIDED_SCORE, 5));

test("숫자 문항은 단위 입력과 쉼표를 안전하게 정규화한다", () => {
  assert.equal(isAnswerCorrect(lessons[0][2], "10 A"), true);
  assert.equal(isAnswerCorrect(lessons[0][4], ["100 W", "1W"]), true);
});

test("3차시 서술형 자동 참고 판정은 다섯 핵심 역할을 모두 요구한다", () => {
  const question = lessons[2][9];
  assert.equal(question.type, "short_answer_rubric");
  assert.equal(isAnswerCorrect(question, correctFor(question)), true);
  assert.equal(isAnswerCorrect(question, "전압을 높이고 낮춘다."), false);
});

test("각 차시 AR과 비AR은 같은 문항·정답·피드백을 사용한다", () => {
  [1, 2, 3].forEach((lessonNumber) => {
    const arQuestions = getLessonQuestions(bank, lessonNumber);
    const fallbackQuestions = getLessonQuestions(bank, lessonNumber);
    assert.deepEqual(arQuestions, fallbackQuestions);
  });
});

test("차시별 진행 상태는 JSON 직렬화 후 문항·점수·시도를 복원한다", () => {
  [1, 2, 3].forEach((lessonNumber) => {
    const before = { version: 1, lesson: lessonNumber, mode: "fallback", stageIndex: 1, scanMarkerIndex: 0, phase: "quiz", questionIndex: 4, score: 27, records: { [`L${lessonNumber}-Q${String((lessonNumber - 1) * 10 + 3).padStart(2, "0")}`]: { attempts: 2, completed: true, score: 7 } } };
    assert.deepEqual(JSON.parse(JSON.stringify(before)), before);
  });
});

test("세 차시 모두 활동과 전환을 포함해 25분 이내다", () => {
  const expectedQuizSeconds = [670, 675, 785];
  [1, 2, 3].forEach((lessonNumber, index) => {
    const quizSeconds = expectedLessonSeconds(bank, lessonNumber);
    const totalSeconds = quizSeconds + 3 * 150 + 180;
    assert.equal(quizSeconds, expectedQuizSeconds[index]);
    assert.ok(totalSeconds <= 25 * 60, `${lessonNumber}차시 ${totalSeconds}초`);
  });
});

test("차시 구성은 문항 30개와 targetIndex 0~5를 빠짐없이 연결한다", () => {
  const allQuestionIndexes = [];
  const allTargets = new Set();
  [1, 2, 3].forEach((lessonNumber) => {
    const config = getLessonConfig(lessonNumber);
    assert.equal(config.stages.length, 3);
    assert.deepEqual(config.stages.flatMap((stage) => stage.questions), Array.from({ length: 10 }, (_, index) => index));
    config.stages.forEach((stage) => stage.markers.forEach((marker) => allTargets.add(marker.targetIndex)));
    allQuestionIndexes.push(...config.stages.flatMap((stage) => stage.questions));
  });
  assert.equal(allQuestionIndexes.length, 30);
  assert.deepEqual([...allTargets].sort(), [0, 1, 2, 3, 4, 5]);
});
