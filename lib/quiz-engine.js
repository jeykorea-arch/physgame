export const FIRST_TRY_SCORE = 10;
export const SECOND_TRY_SCORE = 7;
export const GUIDED_SCORE = 5;

const numberFrom = (value) => {
  const match = String(value ?? "")
    .replaceAll(",", "")
    .trim()
    .match(/[-+]?\d*\.?\d+/);
  return match ? Number(match[0]) : Number.NaN;
};

export function getLessonQuestions(bank, lesson = 1) {
  return bank.questions.filter((question) => question.lesson === lesson);
}

export function isAnswerCorrect(question, value) {
  if (question.type === "numeric") {
    const actual = numberFrom(value);
    const tolerance = Number(question.answer_tolerance ?? 0);
    return Number.isFinite(actual) && Math.abs(actual - Number(question.answer)) <= tolerance;
  }

  if (question.type === "numeric_pair") {
    if (!Array.isArray(value) || value.length !== question.answer.length) return false;
    return value.every((item, index) => {
      const actual = numberFrom(item);
      const expected = numberFrom(question.answer[index]);
      return Number.isFinite(actual) && actual === expected;
    });
  }

  if (question.type === "multiple_select") {
    if (!Array.isArray(value)) return false;
    const actual = [...value].sort();
    const expected = [...question.answer].sort();
    return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
  }

  if (question.type === "sequence") {
    return (
      Array.isArray(value) &&
      value.length === question.answer.length &&
      value.every((item, index) => item === question.answer[index])
    );
  }

  return value === question.answer;
}

export function scoreForCorrectAttempt(previousWrongAttempts) {
  return previousWrongAttempts === 0 ? FIRST_TRY_SCORE : SECOND_TRY_SCORE;
}

export function formatAnswer(answer) {
  return Array.isArray(answer) ? answer.join(" → ") : String(answer);
}

export function shuffledSequence(question) {
  const values = [...question.options];
  if (values.length > 1) values.push(values.shift());
  return values;
}

const guidedSteps = {
  "L1-Q01": ["에너지원인 터빈에서 시작합니다.", "회전자가 움직이면 자기 선속이 변합니다.", "전자기 유도로 전기 에너지가 전달됩니다."],
  "L1-Q02": ["전력의 단위 W를 J/s로 바꿉니다.", "1,000 W = 1,000 J/s입니다."],
  "L1-Q03": ["P=VI에서 I=P/V로 정리합니다.", "1,000 W ÷ 100 V = 10 A입니다."],
  "L1-Q04": ["P가 일정하면 I=P/V입니다.", "V가 10배가 되면 I는 1/10배입니다."],
  "L1-Q05": ["P손실=I²R에 R=1 Ω을 넣습니다.", "10²×1=100 W, 1²×1=1 W입니다."],
  "L1-Q06": ["먼저 P=VI로 전류 변화를 봅니다.", "그 전류를 I²R에 넣어 열 손실을 비교합니다."],
  "L1-Q07": ["권수비로 의도해 바꾸는 것은 전압 변환입니다.", "전선 저항 때문에 낮아지는 것은 전압 강하입니다."],
  "L1-Q08": ["V₂/V₁=N₂/N₁의 방향을 맞춥니다.", "V₂=2,200×100/1,000=220 V입니다."],
  "L1-Q09": ["이상적 변압기에서 입력·출력 전력은 거의 같습니다.", "전압이 10배면 전류는 1/10배입니다."],
  "L1-Q10": ["패러데이 법칙의 핵심은 자기 선속의 변화입니다.", "일정한 직류는 연결 순간 이후 지속적인 유도 기전력을 만들지 못합니다."],
};

export function getGuidedSteps(question) {
  return guidedSteps[question.id] ?? [question.feedback_incorrect];
}

export function expectedLessonSeconds(bank, lesson = 1) {
  return getLessonQuestions(bank, lesson).reduce((sum, question) => sum + question.estimated_seconds, 0);
}
