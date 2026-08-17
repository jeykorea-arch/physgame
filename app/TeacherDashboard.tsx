"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatAnswer } from "../lib/quiz-engine.js";
import { getLessonConfig, LESSONS } from "../lib/lesson-config.js";
import { liveClassConfigured, openTeacherClass, type LiveQuestionResponse, type LiveStudent, type LiveSubmission, type TeacherClassHandle } from "./firebase-live";

type ResponseRecord = Partial<LiveQuestionResponse>;
type StudentResult = { schema?: string; nickname?: string; lesson: number; score: number; mode: string; records: Record<string, ResponseRecord> };
type Question = { lesson: number; id: string; stage?: string; type?: string; prompt?: string; options?: unknown[]; answer?: unknown; misconception?: string; feedback_correct?: string };
type Participant = { key: string; nickname: string; score: number; records: Record<string, ResponseRecord>; source: "live" | "file" };

const pad = (value: number) => String(value).padStart(2, "0");
const phaseLabels: Record<string, string> = { waiting: "시작 대기", paused: "일시 멈춤", scan: "마커 인식", observe: "관찰", predict: "예측", manipulate: "조작·검증", quiz: "퀴즈·피드백", stageComplete: "단계 완료", complete: "차시 완료" };
const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

function download(filename: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function submissionList(record?: ResponseRecord): LiveSubmission[] {
  if (!record?.submissions) return [];
  return Array.isArray(record.submissions) ? record.submissions : Object.values(record.submissions);
}
function choiceLabel(code: string) {
  if (!code) return "직접 입력·순서 조작";
  if (code.includes(">")) return code.split(">").map((value) => circled[Number(value) - 1] ?? `${value}번`).join("→");
  return code.split(",").map((value) => circled[Number(value) - 1] ?? `${value}번`).join("+");
}
function answeredCorrectly(record?: ResponseRecord) {
  const attempts = submissionList(record);
  return attempts.length ? attempts.some((item) => item.correct) : Boolean(record?.completed && !record?.guided);
}
function wrongAttempts(record?: ResponseRecord) { return submissionList(record).filter((item) => !item.correct); }

export function TeacherDashboard({ bank, onExit }: { bank: { questions: Question[] }; onExit: () => void }) {
  const [lesson, setLesson] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(45 * 60);
  const [running, setRunning] = useState(false);
  const [classCode, setClassCode] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem("physgame.teacher.liveClassCode") ?? "");
  const [manualCounts, setManualCounts] = useState({ connected: 0, active: 0, completed: 0, issues: 0 });
  const [liveStudents, setLiveStudents] = useState<LiveStudent[]>([]);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState(liveClassConfigured ? "실시간 수업을 열면 학생 접속 현황이 자동으로 표시됩니다." : "Firebase 환경변수가 없어 수동 집계 모드로 실행 중입니다.");
  const [results, setResults] = useState<StudentResult[]>([]);
  const [message, setMessage] = useState("준비되면 1차시 링크에 접속하세요.");
  const [importStatus, setImportStatus] = useState("");
  const [questionBoardOpen, setQuestionBoardOpen] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const liveHandleRef = useRef<TeacherClassHandle | null>(null);
  const config = getLessonConfig(lesson);
  const studentUrl = useMemo(() => {
    const url = new URL(document.baseURI);
    const params = new URLSearchParams({ lesson: String(lesson) });
    if (classCode && liveOpen) params.set("class", classCode);
    url.search = params.toString();
    return url.toString();
  }, [classCode, lesson, liveOpen]);

  useEffect(() => () => liveHandleRef.current?.detach(), []);
  useEffect(() => {
    if (!liveOpen || !qrRef.current) return;
    QRCode.toCanvas(qrRef.current, studentUrl, { width: 280, margin: 2, color: { dark: "#07141d", light: "#ffffff" } }).catch(() => undefined);
  }, [liveOpen, studentUrl]);
  useEffect(() => {
    if (!running || secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [running, secondsLeft]);
  useEffect(() => {
    const handle = liveHandleRef.current;
    if (!handle) return;
    handle.setLesson(lesson).then(() => setLiveStatus(`${lesson}차시 실시간 수업 진행 중`)).catch(() => setLiveStatus("차시 변경을 전송하지 못했습니다."));
  }, [lesson]);
  useEffect(() => {
    if (!questionBoardOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setQuestionBoardOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [questionBoardOpen]);

  const lessonLiveStudents = useMemo(() => liveStudents.filter((student) => student.lesson === lesson), [lesson, liveStudents]);
  const liveCounts = useMemo(() => {
    const connectedStudents = lessonLiveStudents.filter((student) => student.connected);
    return { connected: connectedStudents.length, active: connectedStudents.filter((student) => student.completedCount < 10).length, completed: lessonLiveStudents.filter((student) => student.completedCount >= 10 || student.phase === "complete").length, issues: connectedStudents.filter((student) => student.mode === "non-ar").length };
  }, [lessonLiveStudents]);
  const counts = liveOpen ? liveCounts : manualCounts;
  const lessonResults = results.filter((result) => result.lesson === lesson);
  const lessonQuestions = bank.questions.filter((question) => question.lesson === lesson).sort((a, b) => a.id.localeCompare(b.id));
  const participants = useMemo<Participant[]>(() => [
    ...lessonLiveStudents.map((student) => ({ key: `live-${student.uid}`, nickname: student.alias, score: student.score, records: student.responses ?? {}, source: "live" as const })),
    ...lessonResults.map((result, index) => ({ key: `file-${index}`, nickname: result.nickname?.trim() || `가져온 학생 ${index + 1}`, score: result.score, records: result.records ?? {}, source: "file" as const })),
  ], [lessonLiveStudents, lessonResults]);
  const aggregates = useMemo(() => lessonQuestions.map((question) => {
    const records = participants.map((participant) => participant.records[question.id]).filter(Boolean);
    const wrong = records.filter((record) => Boolean(record?.hadError) || wrongAttempts(record).length > 0).length;
    const firstTryCorrect = records.filter((record) => submissionList(record)[0]?.correct || (!submissionList(record).length && record?.completed && !record?.hadError)).length;
    return { id: question.id, total: records.length, wrong, completed: records.filter((record) => record?.completed).length, accuracy: records.length ? Math.round(firstTryCorrect / records.length * 100) : 0 };
  }).filter((item) => item.total > 0).sort((a, b) => b.wrong - a.wrong || a.id.localeCompare(b.id)), [lessonQuestions, participants]);
  const explanationOrder = useMemo(() => {
    if (aggregates.length) return aggregates.filter((item) => item.wrong > 0).slice(0, 3).map((item) => {
      const question = lessonQuestions.find((candidate) => candidate.id === item.id);
      return { id: item.id, title: question?.misconception ?? "오개념 설명", explanation: question?.feedback_correct ?? "정답 피드백을 다시 설명하세요.", wrong: item.wrong, total: item.total };
    });
    return config.teacherTopics.slice(0, 3).map((topic: string, index: number) => ({ id: `${index + 1}`, title: topic, explanation: "응답이 모이기 전 권장 설명 순서입니다.", wrong: 0, total: 0 }));
  }, [aggregates, config.teacherTopics, lessonQuestions]);

  const startLiveClass = async () => {
    if (!liveClassConfigured) { setLiveStatus("Firebase 환경변수가 없어 실시간 수업을 열 수 없습니다."); return; }
    setLiveStatus("실시간 수업을 여는 중…");
    try {
      const handle = await openTeacherClass(lesson, setLiveStudents, setLiveStatus, classCode);
      liveHandleRef.current?.detach();
      liveHandleRef.current = handle;
      setClassCode(handle.classCode);
      localStorage.setItem("physgame.teacher.liveClassCode", handle.classCode);
      setLiveOpen(true);
      setLiveStatus(`${lesson}차시 실시간 수업 진행 중`);
    } catch (error) { setLiveStatus(error instanceof Error ? error.message : "실시간 수업을 열지 못했습니다."); }
  };
  const closeLiveClass = async () => {
    if (!window.confirm("현재 실시간 수업을 종료할까요? 학생의 기기 내 학습 기록은 그대로 유지됩니다.")) return;
    const handle = liveHandleRef.current;
    liveHandleRef.current = null;
    if (handle) await handle.close().catch(() => undefined);
    setLiveOpen(false); setLiveStudents([]); setLiveStatus("실시간 수업이 종료되었습니다. 같은 코드로 다시 열 수 있습니다.");
  };
  const importResults = async (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: StudentResult[] = [];
    for (const file of Array.from(files)) {
      try {
        const parsed = JSON.parse(await file.text());
        if (["physgame-anonymous-result-v1", "physgame-anonymous-result-v2"].includes(parsed?.schema) && [1, 2, 3].includes(parsed.lesson) && parsed.records) accepted.push(parsed);
      } catch { /* 잘못된 파일은 상태 메시지로 안내 */ }
    }
    setResults((current) => [...current, ...accepted]); setImportStatus(`${files.length}개 중 ${accepted.length}개의 익명 결과를 가져왔습니다.`);
  };
  const exportJson = () => download(`physgame-class-${classCode || "local"}-lesson${lesson}.json`, JSON.stringify({ schema: "physgame-teacher-summary-v2", classCode: classCode || null, lesson, counts, participants, aggregates }, null, 2), "application/json");
  const exportCsv = () => {
    const rows = [["question_id", "responses", "first_try_accuracy_percent", "had_error_count"], ...aggregates.map((item) => [item.id, item.total, item.accuracy, item.wrong])];
    download(`physgame-class-${classCode || "local"}-lesson${lesson}.csv`, `\ufeff${rows.map((row) => row.join(",")).join("\n")}`, "text/csv;charset=utf-8");
  };

  return (
    <main className="teacher-shell">
      <header className="teacher-header"><button className="brand-button" onClick={onExit}><span className="brand-mark">V</span><span><b>전기의 여정</b><small>TEACHER CONSOLE</small></span></button><div><span>수업 코드</span><strong>{classCode || "미개설"}</strong></div></header>
      <section className="teacher-alert" role="note"><strong>{liveOpen ? "실시간 익명 집계" : liveClassConfigured ? "실시간 수업 준비" : "수동 집계 모드"}</strong><span>{liveOpen ? "익명 닉네임·현재 단계·점수·문항별 선택 번호와 정오가 자동 갱신됩니다. 답안 원문·실명·학번·사진·영상은 수집하지 않습니다." : liveClassConfigured ? "‘실시간 수업 열기’를 누른 뒤 QR을 학생에게 보여 주세요. Spark 무료 한도 안에서 운영됩니다." : "환경변수 설정 전에는 수동 집계와 익명 결과 JSON 가져오기를 사용할 수 있습니다."}</span></section>
      <nav className="lesson-tabs" aria-label="차시 선택">{Object.values(LESSONS).map((item) => <button key={item.number} className={lesson === item.number ? "active" : ""} onClick={() => { setLesson(item.number); setMessage(`준비되면 ${item.number}차시 링크에 접속하세요.`); }}>{item.number}차시<br /><small>{item.title}</small></button>)}</nav>
      <section className="teacher-grid">
        <article className="teacher-card qr-card"><p className="eyebrow">STUDENT ENTRY</p><h1>{lesson}차시 · {config.title}</h1>{liveOpen ? <><canvas ref={qrRef} aria-label={`${lesson}차시 실시간 수업 접속 QR 코드`} /><div className="class-code-display"><span>직접 입력 코드</span><strong>{classCode}</strong></div><a href={studentUrl} target="_blank" rel="noreferrer">{studentUrl}</a><p>이 QR 또는 6자리 코드를 안내해야 접속 현황에 표시됩니다.</p></> : <div className="qr-locked"><strong>아직 실시간 수업이 열리지 않았습니다</strong><p>수업을 열면 추적 가능한 QR과 6자리 코드가 생성됩니다.</p><button onClick={startLiveClass}>실시간 수업 열기</button></div>}</article>
        <article className="teacher-card timer-card"><p className="eyebrow">45 MIN CLASS TIMER</p><div className="teacher-timer">{pad(Math.floor(secondsLeft / 60))}:{pad(secondsLeft % 60)}</div><div className="timer-phases"><span>도입 0–3분</span><span>핵심 3–28분</span><span>정리 28–40분</span><span>여유 40–45분</span></div><div className="teacher-actions"><button onClick={() => setRunning((value) => !value)}>{running ? "일시정지" : "시작"}</button><button onClick={() => { setRunning(false); setSecondsLeft(45 * 60); }}>초기화</button></div></article>
        <article className="teacher-card roster-card"><p className="eyebrow">{liveOpen ? "LIVE STATUS" : "CLASS STATUS"}</p><h2>{liveOpen ? "실시간 수업 현황" : "수업 현황"}</h2>{Object.entries({ connected: "접속", active: "진행", completed: "완료", issues: liveOpen ? "비AR" : "기술 문제" }).map(([key, label]) => <div className={`counter-row ${liveOpen ? "live" : ""}`} key={key}><span>{label}</span>{!liveOpen && <button aria-label={`${label} 한 명 줄이기`} onClick={() => setManualCounts((current) => ({ ...current, [key]: Math.max(0, current[key as keyof typeof current] - 1) }))}>−</button>}<strong>{counts[key as keyof typeof counts]}</strong>{!liveOpen && <button aria-label={`${label} 한 명 늘리기`} onClick={() => setManualCounts((current) => ({ ...current, [key]: current[key as keyof typeof current] + 1 }))}>+</button>}</div>)}<div className="teacher-actions"><button onClick={liveOpen ? closeLiveClass : startLiveClass}>{liveOpen ? "실시간 수업 종료" : classCode ? "이전 코드로 수업 열기" : "실시간 수업 열기"}</button></div><p className="live-status-copy" role="status">{liveStatus}</p></article>
        <article className="teacher-card broadcast-card"><p className="eyebrow">PROJECTOR MESSAGE</p><h2>{message}</h2><div className="message-presets">{["다음 스테이지로 이동하세요.", "힌트를 확인하고 다시 시도하세요.", "인식이 어렵다면 비AR로 전환하세요."].map((text) => <button key={text} onClick={() => setMessage(text)}>{text}</button>)}</div><small>학생 기기를 원격 제어하지 않습니다. 교실 화면에 보여 줄 안내 문구입니다.</small></article>
        <article className="teacher-card live-students-card"><p className="eyebrow">ANONYMOUS LIVE PROGRESS</p><h2>닉네임별 진행·점수</h2>{liveOpen && lessonLiveStudents.length ? <div className="live-student-table" role="table" aria-label="익명 학생 진행 상황"><div className="live-student-row header" role="row"><span>익명 닉네임</span><span>현재 위치</span><span>문항</span><span>점수</span><span>모드</span></div>{[...lessonLiveStudents].sort((a, b) => b.completedCount - a.completedCount || b.score - a.score).map((student) => <div className={`live-student-row ${student.connected ? "" : "offline"}`} role="row" key={student.uid}><b>{student.alias}<small> #{student.uid.slice(-4).toUpperCase()}</small></b><span>{student.stageIndex + 1}단계 · {phaseLabels[student.phase] ?? student.phase}</span><span>{student.completedCount}/10</span><strong>{student.score}</strong><em>{student.mode === "ar" ? "AR" : "비AR"}</em></div>)}</div> : <p className="live-empty">{liveOpen ? "학생이 닉네임을 입력하고 연결되면 이곳에 나타납니다." : "실시간 수업을 열면 닉네임별 진행 상황을 볼 수 있습니다."}</p>}</article>
        <article className="teacher-card response-card"><p className="eyebrow">ANSWER TRACE</p><h2>학생별 오답 선택 기록</h2>{participants.length ? <div className="student-response-list">{participants.map((participant) => {
          const wrongQuestions = lessonQuestions.filter((question) => wrongAttempts(participant.records[question.id]).length || participant.records[question.id]?.hadError);
          return <details key={participant.key}><summary><b>{participant.nickname}</b><span>{participant.score}/100점 · {participant.source === "live" ? "실시간" : "파일"}</span></summary>{wrongQuestions.length ? <ol>{wrongQuestions.map((question) => <li key={question.id}><b>{question.id}</b><span>{wrongAttempts(participant.records[question.id]).length ? wrongAttempts(participant.records[question.id]).map((attempt, index) => `${index + 1}차 오답 ${choiceLabel(attempt.choiceCode)}`).join(" → ") : "이전 버전 기록: 오답 번호 없음"}</span></li>)}</ol> : <p>기록된 오답이 없습니다.</p>}</details>;
        })}</div> : <p className="live-empty">실시간 응답 또는 익명 결과 파일이 들어오면 오답 문항과 선택 번호가 표시됩니다.</p>}<button className="question-board-button" onClick={() => setQuestionBoardOpen(true)}>전체 문항·정답 현황 열기</button></article>
        <article className="teacher-card flow-card"><p className="eyebrow">LESSON FLOW</p><h2>{lesson}차시 진행 안내</h2><ol className="teacher-flow"><li><b>0–3분</b><span>QR 접속·익명 닉네임·안전 안내</span></li><li><b>3–28분</b><span>{config.stages.map((stage) => stage.name).join(" → ")}</span></li><li><b>28–40분</b><span>오개념 설명 순서에 따라 전체 피드백</span></li><li><b>40–45분</b><span>핵심 산출 확인·익명 결과 저장</span></li></ol></article>
        <article className="teacher-card misconception-card"><p className="eyebrow">TEACHING PRIORITY</p><h2>오개념 설명 순서</h2><p className="priority-note">{aggregates.length ? "실시간 응답과 가져온 결과에서 오류가 많은 문항 순입니다." : "응답이 모이기 전에는 차시 기본 권장 순서를 표시합니다."}</p><ol className="misconception-order">{explanationOrder.map((item, index) => <li key={item.id}><span>{index + 1}</span><div><b>{item.id.includes("Q") ? `${item.id} · ` : ""}{item.title}</b><p>{item.explanation}</p>{item.total > 0 && <small>오류 {item.wrong}/{item.total}</small>}</div></li>)}</ol></article>
        <article className="teacher-card analytics-card"><p className="eyebrow">ANONYMOUS RESULT IMPORT</p><h2>문항 정확도와 상위 오개념</h2><label className="file-button">익명 결과 JSON 가져오기<input type="file" accept="application/json,.json" multiple onChange={(event) => importResults(event.target.files)} /></label>{importStatus && <p role="status">{importStatus}</p>}<div className="analytics-list">{aggregates.length ? aggregates.slice(0, 10).map((item) => <div key={item.id}><b>{item.id}</b><span>첫 시도 정확도 {item.accuracy}%</span><em>오류 {item.wrong}/{item.total}</em></div>) : <p>아직 {lesson}차시 응답이 없습니다.</p>}</div><div className="teacher-actions"><button disabled={!aggregates.length} onClick={exportCsv}>CSV 내보내기</button><button disabled={!aggregates.length} onClick={exportJson}>JSON 내보내기</button></div></article>
      </section>
      {questionBoardOpen && <section className="question-board-overlay" role="dialog" aria-modal="true" aria-labelledby="question-board-title"><div className="question-board-window"><header><div><p className="eyebrow">LESSON {lesson} · TEACHER VIEW</p><h1 id="question-board-title">전체 문항·정답 현황</h1></div><button onClick={() => setQuestionBoardOpen(false)} aria-label="전체 문항 창 닫기">×</button></header><section className="question-board-intro"><h2>수업 도입 설명</h2><p><b>{config.title}</b> — {config.story}</p><p><strong>핵심 산출:</strong> {config.outcome}</p><ol>{config.stages.map((stage) => <li key={stage.number}><b>{stage.number}단계 · {stage.name}</b><span>{stage.observeTitle}: {stage.observeText}</span></li>)}</ol></section><div className="question-board-list">{lessonQuestions.map((question, index) => {
        const correctStudents = participants.filter((participant) => answeredCorrectly(participant.records[question.id]));
        const wrongStudents = participants.map((participant) => ({ participant, attempts: wrongAttempts(participant.records[question.id]) })).filter((item) => item.attempts.length || item.participant.records[question.id]?.hadError);
        return <article key={question.id}><div className="question-board-meta"><span>{index + 1}/10</span><b>{question.id}</b><em>{question.stage}</em></div><h2>{question.prompt}</h2>{question.options?.length ? <ol className="teacher-options">{question.options.map((option, optionIndex) => <li key={optionIndex}><span>{circled[optionIndex] ?? `${optionIndex + 1}.`}</span>{String(option)}</li>)}</ol> : <p className="teacher-input-type">직접 입력·조작형 문항</p>}<div className="teacher-answer"><span>정답</span><b>{formatAnswer(question.answer)}</b></div><div className="answerer-row correct"><b>정답자 {correctStudents.length}명</b><span>{correctStudents.length ? correctStudents.map((item) => item.nickname).join(", ") : "아직 없음"}</span></div><div className="answerer-row wrong"><b>오답 선택</b><span>{wrongStudents.length ? wrongStudents.map(({ participant, attempts }) => `${participant.nickname}: ${attempts.length ? attempts.map((item) => choiceLabel(item.choiceCode)).join(" → ") : "번호 기록 없음"}`).join(" · ") : "아직 없음"}</span></div><details><summary>정답 피드백·오개념 설명</summary><p>{question.feedback_correct}</p><p>{question.misconception}</p></details></article>;
      })}</div></div></section>}
    </main>
  );
}
