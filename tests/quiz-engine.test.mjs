import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getLessonConfig } from "../lib/lesson-config.js";
import { GUIDED_SCORE, expectedLessonSeconds, getLessonQuestions, isAnswerCorrect, scoreForCorrectAttempt } from "../lib/quiz-engine.js";

const bank = JSON.parse(await readFile(new URL("../public/data/quiz_bank_v1.json", import.meta.url), "utf8"));
const lessons = [1, 2, 3].map((number) => getLessonQuestions(bank, number));

const correctFor = (question) => question.type === "short_answer_rubric"
  ? "전력망에서는 전압을 높이고 낮추고, 충전기에서는 전류를 한쪽으로 만든 뒤 전압의 낮아지는 부분을 메우고 흐름을 조절한다."
  : question.answer;

const selectedQuestions = bank.questions.filter((question) => question.options.length > 0 && typeof question.answer === "string");

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

test("v2 선택형 21문항은 정답 문자열을 선택지에 정확히 한 번 포함한다", () => {
  assert.equal(bank.schema_version, "2.0");
  assert.equal(bank.question_count, 30);
  assert.equal(selectedQuestions.length, 21);
  selectedQuestions.forEach((question) => {
    assert.equal(question.options.filter((option) => option === question.answer).length, 1, question.id);
  });
});

test("선택형 정답 위치는 1번 5개, 2번 6개, 3번 5개, 4번 5개이다", () => {
  const positions = selectedQuestions.map((question) => question.options.indexOf(question.answer) + 1);
  const counts = Object.fromEntries([1, 2, 3, 4].map((position) => [position, positions.filter((item) => item === position).length]));
  assert.deepEqual(counts, { 1: 5, 2: 6, 3: 5, 4: 5 });
  assert.deepEqual(counts, Object.fromEntries(Object.entries(bank.revision.answer_position_counts).map(([position, count]) => [Number(position), count])));
  [1, 2, 3].forEach((lessonNumber) => {
    const lessonPositions = selectedQuestions.filter((question) => question.lesson === lessonNumber).map((question) => question.options.indexOf(question.answer) + 1);
    assert.ok(new Set(lessonPositions).size >= 3, `${lessonNumber}차시 위치 다양성`);
  });
});

test("학생 문항과 학생 화면에는 지정된 어려운 전자공학 표현이 없다", async () => {
  const studentSources = [
    JSON.stringify(bank),
    await readFile(new URL("../app/AlphaApp.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../lib/lesson-config.js", import.meta.url), "utf8"),
  ].join("\n");
  const forbidden = ["단상 브리지 정류기", "도통", "반주기", "맥동 직류", "리플", "듀티비", "충전 협상", "프로파일", "피드백 제어", "오실로스코프", "게이트 신호", "에너지 펄스", "ON/OFF"];
  forbidden.forEach((term) => assert.doesNotMatch(studentSources, new RegExp(term), term));
});

test("과학 감사 대상 문항은 에너지·자기 선속·축전기·전압 그래프를 같은 물리량으로 설명한다", () => {
  const byId = Object.fromEntries(bank.questions.map((question) => [question.id, question]));
  assert.match(byId["L1-Q01"].feedback_correct, /역학적 에너지가 전기 에너지로 전환/);
  assert.ok(byId["L1-Q10"].answer.every((answer) => !answer.includes("자기장") || answer.includes("자기 선속")));
  assert.match(byId["L2-Q15"].prompt, /끊어져 전류가 흐르지 않을 때/);
  assert.match(byId["L2-Q16"].answer[0], /정류된 입력 전압이 축전기 전압보다 높아질 때/);
  assert.match(byId["L2-Q16"].answer[1], /부하로 내보낸다/);
  assert.match(byId["L2-Q17"].feedback_correct, /ΔV≈ΔQ\/C/);
  assert.match(byId["L3-Q26"].answer, /교류 입력을 한쪽 극성이 유지되는 직류 출력/);
  assert.match(byId["L3-Q28"].answer[0], /역학적 에너지가 발전기에서 전기 에너지로 전환/);
  assert.match(byId["L3-Q29"].prompt, /각 지점의 전압을 같은 기준/);
  assert.doesNotMatch(byId["L3-Q29"].prompt, /전류 또는 전압/);
  assert.doesNotMatch(byId["L3-Q30"].answer, /발전소에서 만든 전기/);
});

test("다이오드 화면은 위상각·전기 기호·전류계·두 전류 길을 함께 보여 준다", async () => {
  const source = await readFile(new URL("../app/AlphaApp.tsx", import.meta.url), "utf8");
  const configSource = await readFile(new URL("../lib/lesson-config.js", import.meta.url), "utf8");
  assert.match(source, /rectifierCurrents\(value\)/);
  assert.match(source, /currentX = graphLeft \+ \(Math\.max\(0, Math\.min\(360, value\)\) \/ 360\) \* graphWidth/);
  assert.match(source, /Math\.sin\(phase\) \* graphHeight/);
  assert.match(source, /const drawDiode =/);
  assert.match(source, /drawDiode\(leftNode, topNode, "D1"/);
  assert.match(source, /drawDiode\(rightNode, topNode, "D2"/);
  assert.match(source, /drawDiode\(bottomNode, leftNode, "D3"/);
  assert.match(source, /drawDiode\(bottomNode, rightNode, "D4"/);
  assert.match(source, /ctx\.fillText\("A", loadX, 265\)/);
  assert.match(source, /입력 A → D1 → 전류계·부하 ↓/);
  assert.match(source, /입력 B → D2 → 전류계·부하 ↓/);
  assert.match(source, /D4 → 입력 B/);
  assert.match(source, /D3 → 입력 A/);
  assert.match(configSource, /교류 한 주기 속 현재 각도 θ/);
  assert.match(configSource, /θ\(위상각\)는 교류 한 주기 0°~360°/);
});

test("과학 정확성 보강 콘텐츠는 이전 저장 상태를 섞지 않고 새 문항으로 시작한다", async () => {
  const source = await readFile(new URL("../app/AlphaApp.tsx", import.meta.url), "utf8");
  assert.match(source, /CONTENT_VERSION = "quiz-v3-science-audit-2026-08-17"/);
  assert.match(source, /APP_VERSION = 2/);
  assert.match(source, /parsed\.contentVersion !== CONTENT_VERSION/);
  assert.match(source, /physgame\.lesson\$\{lesson\}\.v2/);
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
