"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { getLessonConfig, LESSONS } from "../lib/lesson-config.js";

type StudentResult = {
  schema?: string;
  lesson: number;
  score: number;
  mode: string;
  records: Record<string, { completed?: boolean; hadError?: boolean; attempts?: number; score?: number }>;
};

const pad = (value: number) => String(value).padStart(2, "0");

function download(filename: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TeacherDashboard({ onExit }: { onExit: () => void }) {
  const [lesson, setLesson] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(45 * 60);
  const [running, setRunning] = useState(false);
  const [classCode] = useState(() => Math.random().toString(36).slice(2, 6).toUpperCase());
  const [counts, setCounts] = useState({ connected: 0, active: 0, completed: 0, issues: 0 });
  const [results, setResults] = useState<StudentResult[]>([]);
  const [message, setMessage] = useState("준비되면 1차시 링크에 접속하세요.");
  const [importStatus, setImportStatus] = useState("");
  const qrRef = useRef<HTMLCanvasElement>(null);
  const config = getLessonConfig(lesson);
  const studentUrl = useMemo(() => {
    const url = new URL(document.baseURI);
    url.search = `?lesson=${lesson}`;
    return url.toString();
  }, [lesson]);

  useEffect(() => {
    if (!qrRef.current) return;
    QRCode.toCanvas(qrRef.current, studentUrl, { width: 280, margin: 2, color: { dark: "#07141d", light: "#ffffff" } }).catch(() => undefined);
  }, [studentUrl]);

  useEffect(() => {
    if (!running || secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [running, secondsLeft]);

  const lessonResults = results.filter((result) => result.lesson === lesson);
  const aggregates = useMemo(() => {
    const map = new Map<string, { total: number; wrong: number; completed: number }>();
    lessonResults.forEach((result) => {
      Object.entries(result.records ?? {}).forEach(([id, record]) => {
        const current = map.get(id) ?? { total: 0, wrong: 0, completed: 0 };
        current.total += 1;
        current.wrong += record.hadError ? 1 : 0;
        current.completed += record.completed ? 1 : 0;
        map.set(id, current);
      });
    });
    return [...map.entries()].map(([id, value]) => ({
      id,
      accuracy: value.total ? Math.round(((value.total - value.wrong) / value.total) * 100) : 0,
      ...value,
    })).sort((a, b) => b.wrong - a.wrong || a.id.localeCompare(b.id));
  }, [lessonResults]);

  const importResults = async (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: StudentResult[] = [];
    for (const file of Array.from(files)) {
      try {
        const parsed = JSON.parse(await file.text());
        if (parsed?.schema === "physgame-anonymous-result-v1" && [1, 2, 3].includes(parsed.lesson) && parsed.records) accepted.push(parsed);
      } catch { /* 잘못된 파일은 아래 상태 메시지로 안내 */ }
    }
    setResults((current) => [...current, ...accepted]);
    setImportStatus(`${files.length}개 중 ${accepted.length}개의 익명 결과를 가져왔습니다.`);
  };

  const exportJson = () => download(`physgame-class-${classCode}-lesson${lesson}.json`, JSON.stringify({ schema: "physgame-teacher-summary-v1", classCode, lesson, counts, importedResults: lessonResults.length, aggregates }, null, 2), "application/json");
  const exportCsv = () => {
    const rows = [["question_id", "responses", "first_try_accuracy_percent", "had_error_count"], ...aggregates.map((item) => [item.id, item.total, item.accuracy, item.wrong])];
    download(`physgame-class-${classCode}-lesson${lesson}.csv`, `\ufeff${rows.map((row) => row.join(",")).join("\n")}`, "text/csv;charset=utf-8");
  };

  return (
    <main className="teacher-shell">
      <header className="teacher-header">
        <button className="brand-button" onClick={onExit}><span className="brand-mark">V</span><span><b>전기의 여정</b><small>TEACHER CONSOLE</small></span></button>
        <div><span>수업 코드</span><strong>{classCode}</strong></div>
      </header>

      <section className="teacher-alert" role="note">
        <strong>로컬 집계 모드</strong>
        <span>GitHub Pages에는 학생 기기 상태를 자동 수집하는 서버가 없습니다. 아래 수치는 교사가 직접 조정하며, 문항 통계는 학생이 내려받은 익명 결과 JSON을 가져와 계산합니다.</span>
      </section>

      <nav className="lesson-tabs" aria-label="차시 선택">
        {Object.values(LESSONS).map((item) => <button key={item.number} className={lesson === item.number ? "active" : ""} onClick={() => { setLesson(item.number); setMessage(`준비되면 ${item.number}차시 링크에 접속하세요.`); }}>{item.number}차시<br /><small>{item.title}</small></button>)}
      </nav>

      <section className="teacher-grid">
        <article className="teacher-card qr-card">
          <p className="eyebrow">STUDENT ENTRY</p>
          <h1>{lesson}차시 · {config.title}</h1>
          <canvas ref={qrRef} aria-label={`${lesson}차시 학생 접속 QR 코드`} />
          <a href={studentUrl} target="_blank" rel="noreferrer">{studentUrl}</a>
          <p>학생은 이름·학번 입력 없이 접속합니다.</p>
        </article>

        <article className="teacher-card timer-card">
          <p className="eyebrow">45 MIN CLASS TIMER</p>
          <div className="teacher-timer">{pad(Math.floor(secondsLeft / 60))}:{pad(secondsLeft % 60)}</div>
          <div className="timer-phases"><span>도입 0–3분</span><span>핵심 3–28분</span><span>정리 28–40분</span><span>여유 40–45분</span></div>
          <div className="teacher-actions"><button onClick={() => setRunning((value) => !value)}>{running ? "일시정지" : "시작"}</button><button onClick={() => { setRunning(false); setSecondsLeft(45 * 60); }}>초기화</button></div>
        </article>

        <article className="teacher-card roster-card">
          <p className="eyebrow">MANUAL STATUS</p>
          <h2>수업 현황</h2>
          {Object.entries({ connected: "접속", active: "진행", completed: "완료", issues: "기술 문제" }).map(([key, label]) => <div className="counter-row" key={key}><span>{label}</span><button aria-label={`${label} 한 명 줄이기`} onClick={() => setCounts((current) => ({ ...current, [key]: Math.max(0, current[key as keyof typeof current] - 1) }))}>−</button><strong>{counts[key as keyof typeof counts]}</strong><button aria-label={`${label} 한 명 늘리기`} onClick={() => setCounts((current) => ({ ...current, [key]: current[key as keyof typeof current] + 1 }))}>+</button></div>)}
        </article>

        <article className="teacher-card broadcast-card">
          <p className="eyebrow">PROJECTOR MESSAGE</p>
          <h2>{message}</h2>
          <div className="message-presets">{["다음 스테이지로 이동하세요.", "힌트를 확인하고 다시 시도하세요.", "인식이 어렵다면 비AR로 전환하세요."].map((text) => <button key={text} onClick={() => setMessage(text)}>{text}</button>)}</div>
          <small>학생 기기를 원격 제어하지 않습니다. 교실 화면에 보여 줄 안내 문구입니다.</small>
        </article>

        <article className="teacher-card analytics-card">
          <p className="eyebrow">ANONYMOUS RESULT IMPORT</p>
          <h2>문항 정확도와 상위 오개념</h2>
          <label className="file-button">익명 결과 JSON 가져오기<input type="file" accept="application/json,.json" multiple onChange={(event) => importResults(event.target.files)} /></label>
          {importStatus && <p role="status">{importStatus}</p>}
          <div className="analytics-list">{aggregates.length ? aggregates.slice(0, 10).map((item) => <div key={item.id}><b>{item.id}</b><span>첫 시도 정확도 {item.accuracy}%</span><em>오류 {item.wrong}/{item.total}</em></div>) : <p>아직 가져온 {lesson}차시 결과가 없습니다.</p>}</div>
          <div className="teacher-actions"><button disabled={!aggregates.length} onClick={exportCsv}>CSV 내보내기</button><button disabled={!aggregates.length} onClick={exportJson}>JSON 내보내기</button></div>
        </article>
      </section>
    </main>
  );
}
