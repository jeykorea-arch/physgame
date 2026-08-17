import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { get, getDatabase, ref, remove, set, update } from "firebase/database";

const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

assert.ok(Object.values(config).every(Boolean), ".env.local의 Firebase 설정값 5개가 필요합니다.");

const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const classCode = `T${suffix.slice(0, 5)}`;
const teacherApp = initializeApp(config, `teacher-${suffix}`);
const studentApp = initializeApp(config, `student-${suffix}`);

function within(promise, label, milliseconds = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 단계가 ${milliseconds / 1000}초 안에 끝나지 않았습니다.`)), milliseconds)),
  ]);
}

let failure = null;
try {
  console.log("1/7 교사·학생 익명 인증");
  const teacher = (await within(signInAnonymously(getAuth(teacherApp)), "교사 익명 인증")).user;
  const student = (await within(signInAnonymously(getAuth(studentApp)), "학생 익명 인증")).user;
  const teacherDb = getDatabase(teacherApp);
  const studentDb = getDatabase(studentApp);

  console.log("2/7 교사 수업 개설");
  await within(set(ref(teacherDb, `classes/${classCode}`), {
    ownerUid: teacher.uid,
    public: { lesson: 1, active: true, createdAt: Date.now() },
  }), "교사 수업 개설");

  console.log("3/7 학생 수업 정보 확인");
  const publicInfo = (await within(get(ref(studentDb, `classes/${classCode}/public`)), "학생 수업 정보 확인")).val();
  assert.deepEqual({ lesson: publicInfo.lesson, active: publicInfo.active }, { lesson: 1, active: true });

  console.log("4/7 학생 익명 상태 등록");
  await within(set(ref(studentDb, `classes/${classCode}/students/${student.uid}`), {
    alias: "별빛여우",
    connected: true,
    lesson: 1,
    stageIndex: 0,
    phase: "observe",
    questionIndex: 0,
    completedCount: 0,
    score: 0,
    mode: "non-ar",
    lastSeen: Date.now(),
  }), "학생 익명 상태 등록");

  console.log("5/7 교사 진행판 읽기");
  const teacherView = (await within(get(ref(teacherDb, `classes/${classCode}/students`)), "교사 진행판 읽기")).val();
  assert.equal(Object.keys(teacherView).length, 1);
  assert.equal(teacherView[student.uid].phase, "observe");

  console.log("6/7 학생 진행 갱신");
  await within(update(ref(studentDb, `classes/${classCode}/students/${student.uid}`), {
    phase: "quiz",
    questionIndex: 3,
    completedCount: 3,
    score: 27,
    responses: {
      "L1-Q01": {
        attempts: 2,
        completed: true,
        score: 7,
        guided: false,
        hadError: true,
        submissions: [
          { correct: false, choiceCode: "2" },
          { correct: true, choiceCode: "1" },
        ],
      },
    },
    lastSeen: Date.now(),
  }), "학생 진행 갱신");
  const updated = (await within(get(ref(teacherDb, `classes/${classCode}/students/${student.uid}`)), "교사 갱신 확인")).val();
  assert.equal(updated.completedCount, 3);
  assert.equal(updated.score, 27);
  assert.equal(updated.alias, "별빛여우");
  assert.equal(updated.responses["L1-Q01"].submissions[0].choiceCode, "2");
  assert.equal(updated.responses["L1-Q01"].submissions[1].correct, true);

  console.log("7/7 수업 종료·접속 해제");
  await within(update(ref(teacherDb, `classes/${classCode}/public`), { active: false }), "수업 종료");
  await within(update(ref(studentDb, `classes/${classCode}/students/${student.uid}`), { connected: false, lastSeen: Date.now() }), "학생 접속 해제");

  console.log("Firebase 실시간 왕복 검증 통과: 교사 개설 → 익명 닉네임 접속 → 문항별 선택 번호·정오 갱신 → 종료");
} catch (error) {
  failure = error;
} finally {
  try {
    const teacher = getAuth(teacherApp).currentUser;
    if (teacher) await within(remove(ref(getDatabase(teacherApp), `classes/${classCode}`)), "테스트 데이터 정리", 5000);
  } catch { /* 테스트 데이터 정리는 최선 시도 */ }
  await Promise.all([deleteApp(teacherApp), deleteApp(studentApp)]);
}

if (failure) console.error(failure instanceof Error ? failure.message : String(failure));
process.exit(failure ? 1 : 0);
