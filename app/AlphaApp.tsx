"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GUIDED_SCORE,
  expectedLessonSeconds,
  formatAnswer,
  getGuidedSteps,
  getLessonQuestions,
  isAnswerCorrect,
  scoreForCorrectAttempt,
  shuffledSequence,
} from "../lib/quiz-engine.js";

const STORAGE_KEY = "physgame.lesson1.alpha.v1";
const APP_VERSION = 1;
const AR_PREVIEW_SECONDS = 5;

function publicAsset(path: string) {
  const relativePath = path.replace(/^\/+/, "");
  return new URL(relativePath, document.baseURI).toString();
}

const stages = [
  {
    number: "01",
    name: "발전소 기동",
    marker: "01 발전소",
    targetIndex: 0,
    questions: [0, 1],
    observeTitle: "운동이 전기로 전달되는 경로",
    observeText: "터빈의 역학적 에너지가 회전자를 움직이고, 변화하는 자기 선속이 유도 기전력을 만듭니다. 발전기는 에너지를 새로 만들지 않습니다.",
    prediction: "터빈과 회전자가 멈추면 지속적인 유도 기전력은 어떻게 될까요?",
    predictionOptions: ["사라진다", "그대로 유지된다", "무한히 커진다"],
    predictionAnswer: "사라진다",
    sliderLabel: "터빈 회전 속도",
    sliderMin: 0,
    sliderMax: 100,
    sliderStep: 10,
    sliderDefault: 50,
    sliderUnit: "%",
    manipulationNote: "회전 속도가 0이면 자기 선속의 변화율과 유도 전압도 0이 됩니다.",
  },
  {
    number: "02",
    name: "송전망 최적화",
    marker: "02 고전압 송전",
    targetIndex: 1,
    questions: [2, 3, 4, 5],
    observeTitle: "같은 전력, 다른 전압과 손실",
    observeText: "전력 P=VI가 일정하면 전압 V를 높일수록 전류 I가 줄고, 송전선 열 손실 I²R은 더 크게 줄어듭니다.",
    prediction: "같은 전력을 보낼 때 송전 전압을 높이면 전류는 어떻게 될까요?",
    predictionOptions: ["줄어든다", "늘어난다", "변하지 않는다"],
    predictionAnswer: "줄어든다",
    sliderLabel: "송전 전압",
    sliderMin: 100,
    sliderMax: 1000,
    sliderStep: 100,
    sliderDefault: 500,
    sliderUnit: " V",
    manipulationNote: "시뮬레이션 조건: 전달 전력 1,000 W, 송전선 저항 1 Ω.",
  },
  {
    number: "03",
    name: "배전 변압",
    marker: "03 변압기",
    targetIndex: 2,
    questions: [6, 7, 8, 9],
    observeTitle: "권수비로 바꾸는 교류 전압",
    observeText: "이상적 변압기에서 V₂/V₁=N₂/N₁입니다. 변화하는 자기 선속이 두 코일을 연결하며, 일정한 직류는 지속적인 변압을 만들지 못합니다.",
    prediction: "1차 조건이 같을 때 2차 코일의 권수를 줄이면 2차 전압은 어떻게 될까요?",
    predictionOptions: ["낮아진다", "높아진다", "변하지 않는다"],
    predictionAnswer: "낮아진다",
    sliderLabel: "2차 코일 권수 N₂",
    sliderMin: 50,
    sliderMax: 500,
    sliderStep: 50,
    sliderDefault: 100,
    sliderUnit: "회",
    manipulationNote: "시뮬레이션 조건: 이상적 변압기, V₁=2,200 V, N₁=1,000회.",
  },
];

const initialProgress = {
  version: APP_VERSION,
  started: false,
  completed: false,
  mode: null as "ar" | "fallback" | null,
  stageIndex: 0,
  phase: "scan",
  questionIndex: 0,
  score: 0,
  records: {} as Record<string, any>,
  predictions: {} as Record<string, string>,
  sliders: { 0: 50, 1: 500, 2: 100 } as Record<number, number>,
  startedAt: null as number | null,
  completedAt: null as number | null,
  settings: { largeText: false, reducedMotion: false },
};

function mergeStoredProgress(raw: string | null) {
  if (!raw) return initialProgress;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== APP_VERSION) return initialProgress;
    return {
      ...initialProgress,
      ...parsed,
      records: { ...initialProgress.records, ...parsed.records },
      predictions: { ...initialProgress.predictions, ...parsed.predictions },
      sliders: { ...initialProgress.sliders, ...parsed.sliders },
      settings: { ...initialProgress.settings, ...parsed.settings },
    };
  } catch {
    return initialProgress;
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === "true") return resolve();
    const script = existing ?? document.createElement("script");
    const onLoad = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", () => reject(new Error(`${src} 로드 실패`)), { once: true });
    if (!existing) {
      script.src = src;
      script.async = false;
      document.head.appendChild(script);
    }
  });
}

function describeCameraError(error: any) {
  if (!window.isSecureContext) return "카메라는 HTTPS 또는 이 기기의 localhost에서만 열 수 있습니다.";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "카메라 권한이 거부되었습니다. 브라우저 주소창의 카메라 설정을 ‘허용’으로 바꾸거나 비AR 모드를 선택하세요.";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "사용할 수 있는 카메라를 찾지 못했습니다. 비AR 모드로 같은 활동을 진행할 수 있습니다.";
  }
  return "카메라를 시작하지 못했습니다. 다른 앱의 카메라 사용을 종료한 뒤 다시 시도하거나 비AR 모드로 전환하세요.";
}

function ARScene({ activeIndex, retryKey, onFound, onLost, onStatus, onError }: any) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let host: HTMLDivElement | null = null;
    let scene: any = null;
    let system: any = null;
    let systemStarted = false;
    const listeners: Array<[Element, string, EventListener]> = [];

    const start = async () => {
      try {
        onStatus("AR 엔진 준비 중…");
        await loadScript(publicAsset("vendor/aframe-v1.5.0.min.js"));
        await loadScript(publicAsset("vendor/mindar-image-aframe.prod.js"));
        if (cancelled || !hostRef.current) return;
        host = hostRef.current;

        const params = new URLSearchParams(window.location.search);
        if (params.get("qa") === "permission-denied" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
          throw new DOMException("QA simulated denial", "NotAllowedError");
        }
        if (params.get("qa") === "recognition-timeout" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
          onStatus("QA 카메라 준비 완료 · 마커 인식 대기");
          return;
        }
        if (params.get("qa") === "marker-found" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
          onStatus("QA 마커 인식 재현");
          window.setTimeout(() => onFound(activeIndex), 120);
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("No camera", "NotFoundError");

        onStatus("카메라 권한 확인 중…");
        const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        probe.getTracks().forEach((track) => track.stop());
        if (cancelled || !host) return;

        host.innerHTML = `
          <a-scene embedded
            mindar-image="imageTargetSrc: ${publicAsset("assets/targets.mind")}; maxTrack: 1; autoStart: false; uiLoading: no; uiScanning: no; uiError: no;"
            color-space="sRGB" renderer="colorManagement: true; physicallyCorrectLights: true; alpha: true"
            vr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false">
            <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
            <a-entity id="ar-target-0" mindar-image-target="targetIndex: 0">
              <a-entity visible="${activeIndex === 0}">
                <a-torus color="#ffd54a" radius="0.28" radius-tubular="0.035" rotation="90 0 0" animation__spin="property: rotation; to: 90 0 360; loop: true; dur: 1800; easing: linear"></a-torus>
                <a-torus color="#42d3c9" radius="0.16" radius-tubular="0.018" rotation="90 0 0" animation__pulse="property: scale; from: 0.82 0.82 0.82; to: 1.18 1.18 1.18; dir: alternate; loop: true; dur: 650"></a-torus>
                <a-cylinder color="#f5f0df" radius="0.045" height="0.68" rotation="0 0 90"></a-cylinder>
                <a-sphere color="#42d3c9" radius="0.035" position="-0.34 0 0.06" animation__flow="property: position; from: -0.34 0 0.06; to: 0.34 0 0.06; loop: true; dur: 1100; easing: linear"></a-sphere>
              </a-entity>
            </a-entity>
            <a-entity id="ar-target-1" mindar-image-target="targetIndex: 1">
              <a-entity visible="${activeIndex === 1}">
                <a-box color="#42d3c9" width="0.86" height="0.035" depth="0.035"></a-box>
                <a-box color="#42d3c9" width="0.86" height="0.025" depth="0.025" position="0 -0.14 0"></a-box>
                <a-sphere color="#ffd54a" radius="0.05" position="-0.38 0 0.05" animation__flow1="property: position; from: -0.38 0 0.05; to: 0.38 0 0.05; loop: true; dur: 1400; easing: linear"></a-sphere>
                <a-sphere color="#f5f0df" radius="0.035" position="-0.38 -0.14 0.05" animation__flow2="property: position; from: -0.38 -0.14 0.05; to: 0.38 -0.14 0.05; loop: true; dur: 1400; delay: 450; easing: linear"></a-sphere>
                <a-sphere color="#ffd54a" radius="0.028" position="-0.38 0 0.05" animation__flow3="property: position; from: -0.38 0 0.05; to: 0.38 0 0.05; loop: true; dur: 1400; delay: 850; easing: linear"></a-sphere>
              </a-entity>
            </a-entity>
            <a-entity id="ar-target-2" mindar-image-target="targetIndex: 2">
              <a-entity visible="${activeIndex === 2}">
                <a-torus color="#42d3c9" radius="0.22" radius-tubular="0.025" position="-0.23 0 0" animation__wobble1="property: rotation; from: -14 -8 0; to: 14 8 0; dir: alternate; loop: true; dur: 720; easing: easeInOutSine"></a-torus>
                <a-torus color="#ffd54a" radius="0.14" radius-tubular="0.025" position="0.23 0 0" animation__wobble2="property: rotation; from: 14 8 0; to: -14 -8 0; dir: alternate; loop: true; dur: 720; easing: easeInOutSine"></a-torus>
                <a-torus color="#f5f0df" radius="0.31" radius-tubular="0.009" rotation="90 0 0" animation__flux="property: scale; from: 0.78 0.78 0.78; to: 1.16 1.16 1.16; dir: alternate; loop: true; dur: 900"></a-torus>
                <a-sphere color="#42d3c9" radius="0.035" position="-0.1 0 0.06" animation__transfer="property: position; from: -0.1 0 0.06; to: 0.12 0 0.06; dir: alternate; loop: true; dur: 620; easing: easeInOutSine"></a-sphere>
              </a-entity>
            </a-entity>
          </a-scene>`;

        scene = host.querySelector("a-scene");
        await new Promise<void>((resolve) => {
          if (scene.hasLoaded) resolve();
          else scene.addEventListener("loaded", () => resolve(), { once: true });
        });
        if (cancelled) return;

        for (let index = 0; index < 3; index += 1) {
          const target = host.querySelector(`#ar-target-${index}`)!;
          const found = (() => onFound(index)) as EventListener;
          const lost = (() => onLost(index)) as EventListener;
          target.addEventListener("targetFound", found);
          target.addEventListener("targetLost", lost);
          listeners.push([target, "targetFound", found]);
          listeners.push([target, "targetLost", lost]);
        }

        system = scene.systems?.["mindar-image-system"];
        if (!system) throw new Error("MindAR system unavailable");
        await system.start();
        systemStarted = true;
        onStatus(`마커 ${String(activeIndex + 1).padStart(2, "0")}를 비춰 주세요.`);
      } catch (error) {
        if (!cancelled) onError(describeCameraError(error));
      }
    };

    start();
    return () => {
      cancelled = true;
      for (const [element, type, listener] of listeners) element.removeEventListener(type, listener);
      try {
        if (systemStarted) system?.stop();
      } catch {
        // 이미 종료된 카메라는 추가 조치가 필요 없다.
      }
      if (host) host.innerHTML = "";
    };
  }, [activeIndex, retryKey, onError, onFound, onLost, onStatus]);

  return <div className="ar-scene-host" ref={hostRef} aria-label="MindAR 카메라 화면" />;
}

function ScienceCanvas({ stageIndex, value, reducedMotion }: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
      const ctx = canvas.getContext("2d")!;
      ctx.scale(ratio, ratio);
      const width = box.width;
      const height = box.height;
      const ink = "#f5f0df";
      const cyan = "#42d3c9";
      const yellow = "#ffd54a";
      const muted = "#9ca8b5";
      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.font = "700 13px system-ui, sans-serif";

      const arrow = (x1: number, y1: number, x2: number, y2: number, color = cyan) => {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 10 * Math.cos(angle - Math.PI / 6), y2 - 10 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - 10 * Math.cos(angle + Math.PI / 6), y2 - 10 * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      };

      if (stageIndex === 0) {
        const speed = value / 100;
        ctx.strokeStyle = yellow;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(width * 0.24, 92, 42, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 6; i += 1) {
          const angle = (i * Math.PI) / 3 + speed * 0.7;
          ctx.beginPath();
          ctx.moveTo(width * 0.24, 92);
          ctx.lineTo(width * 0.24 + Math.cos(angle) * 38, 92 + Math.sin(angle) * 38);
          ctx.stroke();
        }
        arrow(width * 0.38, 92, width * 0.52, 92);
        ctx.strokeStyle = cyan;
        ctx.lineWidth = 3;
        for (let i = 0; i < 7; i += 1) {
          ctx.beginPath();
          ctx.arc(width * 0.66 + i * 4, 92, 28, -Math.PI / 2, Math.PI / 2);
          ctx.stroke();
        }
        arrow(width * 0.78, 92, width * 0.91, 92, speed > 0 ? yellow : muted);
        ctx.fillStyle = ink;
        ctx.fillText("터빈·회전자", Math.max(12, width * 0.12), 158);
        ctx.fillText("코일·자기 선속", width * 0.53, 158);
        ctx.fillStyle = muted;
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.fillText(`변화율 ${Math.round(value)}%`, width * 0.57, 181);
        ctx.fillStyle = speed > 0 ? yellow : muted;
        ctx.fillText(speed > 0 ? "유도 전압 발생" : "유도 전압 0", width * 0.65, 207);
      } else if (stageIndex === 1) {
        const current = 1000 / value;
        const loss = current * current;
        ctx.fillStyle = ink;
        ctx.fillText("발전소", 14, 34);
        ctx.fillText("도시", width - 48, 34);
        ctx.strokeStyle = cyan;
        ctx.lineWidth = Math.max(2, Math.min(10, current));
        ctx.beginPath();
        ctx.moveTo(28, 72);
        ctx.lineTo(width - 28, 72);
        ctx.stroke();
        arrow(42, 72, width - 42, 72, yellow);
        const currentHeight = Math.min(85, current * 8);
        const lossHeight = Math.min(85, loss * 0.8);
        ctx.fillStyle = cyan;
        const chartBase = height - 66;
        ctx.fillRect(width * 0.28 - 22, chartBase - currentHeight, 44, currentHeight);
        ctx.fillStyle = yellow;
        ctx.fillRect(width * 0.7 - 22, chartBase - lossHeight, 44, lossHeight);
        ctx.fillStyle = ink;
        ctx.fillText(`I = ${current.toFixed(1)} A`, width * 0.16, height - 41);
        ctx.fillText(`손실 = ${loss.toFixed(1)} W`, width * 0.52, height - 41);
        ctx.fillStyle = muted;
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.fillText("P=VI", width * 0.24, height - 17);
        ctx.fillText("P손실=I²R", width * 0.61, height - 17);
      } else {
        const secondaryVoltage = (2200 * value) / 1000;
        const labelTop = height - 48;
        const labelBottom = height - 19;
        const coreTop = 28;
        const coreBottom = labelTop - 22;
        const coreHeight = Math.max(105, coreBottom - coreTop);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 6;
        ctx.strokeRect(width * 0.37, coreTop, width * 0.26, coreHeight);
        ctx.strokeStyle = cyan;
        ctx.lineWidth = 3;
        for (let i = 0; i < 8; i += 1) {
          ctx.beginPath();
          ctx.arc(width * 0.32, coreTop + 26 + i * ((coreHeight - 52) / 7), 18, -Math.PI / 2, Math.PI / 2);
          ctx.stroke();
        }
        ctx.strokeStyle = yellow;
        const turnsShown = Math.max(2, Math.round(value / 70));
        for (let i = 0; i < turnsShown; i += 1) {
          ctx.beginPath();
          ctx.arc(width * 0.68, coreTop + 26 + i * ((coreHeight - 52) / Math.max(1, turnsShown - 1)), 18, Math.PI / 2, -Math.PI / 2);
          ctx.stroke();
        }
        arrow(width * 0.43, coreTop + coreHeight / 2, width * 0.57, coreTop + coreHeight / 2, cyan);
        ctx.fillStyle = ink;
        ctx.fillText("N₁=1,000회", width * 0.08, labelTop);
        ctx.fillText(`N₂=${value}회`, width * 0.65, labelTop);
        ctx.fillStyle = cyan;
        ctx.fillText("V₁=2,200 V~", width * 0.06, labelBottom);
        ctx.fillStyle = yellow;
        ctx.fillText(`V₂=${secondaryVoltage.toFixed(0)} V~`, width * 0.62, labelBottom);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [reducedMotion, stageIndex, value]);

  return <canvas ref={canvasRef} className="science-canvas" role="img" aria-label={`${stages[stageIndex].name} 과학 시뮬레이션`} />;
}

function QuestionInput({ question, value, setValue }: any) {
  if (question.type === "numeric") {
    return (
      <label className="numeric-field">
        <span>숫자 답</span>
        <span className="input-with-unit">
          <input inputMode="decimal" value={value ?? ""} onChange={(event) => setValue(event.target.value)} aria-label="숫자 답" />
          <b>{question.id === "L1-Q03" ? "A" : "V"}</b>
        </span>
      </label>
    );
  }

  if (question.type === "numeric_pair") {
    const pair = Array.isArray(value) ? value : ["", ""];
    return (
      <div className="pair-fields">
        {["전류 10 A일 때", "전류 1 A일 때"].map((label, index) => (
          <label className="numeric-field" key={label}>
            <span>{label}</span>
            <span className="input-with-unit">
              <input
                inputMode="decimal"
                value={pair[index] ?? ""}
                onChange={(event) => {
                  const next = [...pair];
                  next[index] = event.target.value;
                  setValue(next);
                }}
                aria-label={`${label} 손실 전력`}
              />
              <b>W</b>
            </span>
          </label>
        ))}
      </div>
    );
  }

  if (question.type === "sequence") {
    const sequence = Array.isArray(value) && value.length ? value : shuffledSequence(question);
    return (
      <ol className="sequence-list">
        {sequence.map((item: string, index: number) => (
          <li key={item}>
            <span className="sequence-number">{index + 1}</span>
            <span>{item}</span>
            <span className="sequence-actions">
              <button
                type="button"
                className="icon-button"
                disabled={index === 0}
                aria-label={`${item} 위로 이동`}
                onClick={() => {
                  const next = [...sequence];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  setValue(next);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={index === sequence.length - 1}
                aria-label={`${item} 아래로 이동`}
                onClick={() => {
                  const next = [...sequence];
                  [next[index + 1], next[index]] = [next[index], next[index + 1]];
                  setValue(next);
                }}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
    );
  }

  if (question.type === "multiple_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="option-list">
        {question.options.map((option: string) => {
          const checked = selected.includes(option);
          return (
            <label className={`option ${checked ? "selected" : ""}`} key={option}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => setValue(checked ? selected.filter((item: string) => item !== option) : [...selected, option])}
              />
              <span className="choice-mark">{checked ? "✓" : "□"}</span>
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div className="option-list">
      {question.options.map((option: string, index: number) => (
        <button
          type="button"
          className={`option option-button ${value === option ? "selected" : ""}`}
          key={option}
          aria-pressed={value === option}
          onClick={() => setValue(option)}
        >
          <span className="choice-mark">{String.fromCharCode(65 + index)}</span>
          <span>{option}</span>
        </button>
      ))}
    </div>
  );
}

function hasAnswer(question: any, value: any) {
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => String(item).trim() !== "");
  return String(value ?? "").trim() !== "";
}

function QuestionCard({ question, number, record, onAttempt, onGuidedComplete, onNext }: any) {
  const [value, setValue] = useState<any>(() => (question.type === "sequence" ? shuffledSequence(question) : question.type === "numeric_pair" ? ["", ""] : question.type === "multiple_select" ? [] : ""));

  const attempts = record?.attempts ?? 0;
  const completed = Boolean(record?.completed);
  const guided = Boolean(record?.guidedAvailable) && !completed;

  if (completed) {
    return (
      <section className="panel feedback-panel" aria-live="polite">
        <div className="feedback-score">+{record.score}점</div>
        <p className="eyebrow">{question.id} · 피드백</p>
        <h2>{record.guided ? "안내를 따라 개념 복구 완료" : "예측 검증 완료"}</h2>
        <p className="feedback-copy">{question.feedback_correct}</p>
        <div className="principle-box">
          <span>핵심 원리</span>
          <strong>{question.misconception}</strong>
          <small>위 문장은 흔한 오개념입니다. 정답 피드백과 반대로 구분해 기억하세요.</small>
        </div>
        <button className="primary-button" type="button" onClick={onNext}>
          {number === 10 ? "1차시 결과 보기" : "다음으로"}
        </button>
      </section>
    );
  }

  if (guided) {
    return (
      <section className="panel guided-panel" aria-live="polite">
        <p className="eyebrow">{question.id} · 단계별 안내</p>
        <h2>식과 원리를 따라 복구하세요</h2>
        <ol>
          {getGuidedSteps(question).map((step: string) => <li key={step}>{step}</li>)}
        </ol>
        <div className="answer-reveal">
          <span>확인할 답</span>
          <strong>{formatAnswer(question.answer)}</strong>
        </div>
        <button className="primary-button" type="button" onClick={onGuidedComplete}>안내 확인하고 완료 · +5점</button>
      </section>
    );
  }

  return (
    <section className="panel question-panel">
      <div className="question-meta">
        <span>{question.id}</span>
        <span>문항 {number}/10</span>
        <span>{attempts === 0 ? "첫 시도 10점" : "두 번째 시도 7점"}</span>
      </div>
      <h2>{question.prompt}</h2>
      <QuestionInput question={question} value={value} setValue={setValue} />
      {attempts > 0 && (
        <div className="inline-hint" role="status">
          <strong>첫 단서</strong>
          <p>{question.feedback_incorrect}</p>
        </div>
      )}
      <button className="primary-button" type="button" disabled={!hasAnswer(question, value)} onClick={() => onAttempt(value)}>
        답 확인하기
      </button>
    </section>
  );
}

function Header({ progress, elapsedMinutes, onHome }: any) {
  const completedCount = Object.values(progress.records).filter((record: any) => record.completed).length;
  const percent = Math.round((completedCount / 10) * 100);
  return (
    <header className="app-header">
      <button className="brand-button" type="button" onClick={onHome} aria-label="시작 화면으로">
        <span className="brand-mark">V</span>
        <span><b>전기의 여정</b><small>LESSON 01</small></span>
      </button>
      <div className="header-stats">
        <span><small>복구</small><b>{percent}%</b></span>
        <span><small>점수</small><b>{progress.score}/100</b></span>
        <span><small>경과</small><b>{elapsedMinutes}분</b></span>
      </div>
    </header>
  );
}

export function AlphaApp() {
  const [bank, setBank] = useState<any>(null);
  const [loadError, setLoadError] = useState("");
  const [progress, setProgress] = useState<any>(initialProgress);
  const [hydrated, setHydrated] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [cameraStatus, setCameraStatus] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [scanTip, setScanTip] = useState(0);
  const [wrongMarker, setWrongMarker] = useState("");
  const [arPreviewIndex, setArPreviewIndex] = useState<number | null>(null);
  const [arPreviewSeconds, setArPreviewSeconds] = useState(AR_PREVIEW_SECONDS);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qa = params.get("qa");
    const isLocalQa = Boolean(qa) && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const isQaRun = Boolean(qa);
    setQaMode(isQaRun);
    if (isLocalQa && (qa === "stage-2-manipulate" || qa === "stage-3-manipulate")) {
      const stageIndex = qa === "stage-2-manipulate" ? 1 : 2;
      setProgress({
        ...initialProgress,
        started: true,
        mode: "fallback",
        stageIndex,
        phase: "manipulate",
        questionIndex: stageIndex === 1 ? 2 : 6,
        predictions: { [stageIndex]: stages[stageIndex].predictionAnswer },
        startedAt: Date.now(),
      });
      setShowHome(false);
    } else if (isLocalQa && qa === "marker-found") {
      setProgress({ ...initialProgress, started: true, mode: "ar", phase: "scan", startedAt: Date.now() });
      setShowHome(false);
    } else {
      setProgress(isQaRun ? initialProgress : mergeStoredProgress(localStorage.getItem(STORAGE_KEY)));
    }
    setHydrated(true);
    fetch(publicAsset("data/quiz_bank_v1.json"))
      .then((response) => {
        if (!response.ok) throw new Error("퀴즈 데이터를 불러오지 못했습니다.");
        return response.json();
      })
      .then(setBank)
      .catch((error) => setLoadError(error.message));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(publicAsset("sw.js")).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated || qaMode) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [hydrated, progress, qaMode]);

  useEffect(() => {
    const update = () => setElapsedMinutes(progress.startedAt ? Math.max(0, Math.floor((Date.now() - progress.startedAt) / 60000)) : 0);
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, [progress.startedAt]);

  useEffect(() => {
    if (!progress.started || progress.completed || showHome || progress.mode !== "ar" || progress.phase !== "scan" || arPreviewIndex !== null) {
      setScanTip(0);
      return;
    }
    setScanTip(0);
    const ten = window.setTimeout(() => setScanTip(1), 10000);
    const twenty = window.setTimeout(() => setScanTip(2), 20000);
    return () => {
      window.clearTimeout(ten);
      window.clearTimeout(twenty);
    };
  }, [arPreviewIndex, progress.completed, progress.mode, progress.phase, progress.stageIndex, progress.started, retryKey, showHome]);

  useEffect(() => {
    if (arPreviewIndex === null) {
      setArPreviewSeconds(AR_PREVIEW_SECONDS);
      return;
    }
    setArPreviewSeconds(AR_PREVIEW_SECONDS);
    const ticker = window.setInterval(() => setArPreviewSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    const finish = window.setTimeout(() => {
      setProgress((current: any) => {
        if (current.mode !== "ar" || current.phase !== "scan" || current.stageIndex !== arPreviewIndex) return current;
        return { ...current, phase: "observe" };
      });
      setArPreviewIndex(null);
      setCameraStatus("");
    }, AR_PREVIEW_SECONDS * 1000);
    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(finish);
    };
  }, [arPreviewIndex]);

  const lessonQuestions = useMemo(() => (bank ? getLessonQuestions(bank, 1) : []), [bank]);
  const stage = stages[progress.stageIndex] ?? stages[0];
  const question = lessonQuestions[progress.questionIndex];
  const stageValue = Number(progress.sliders[progress.stageIndex] ?? stage.sliderDefault);

  const mutate = useCallback((patch: any) => {
    setProgress((current: any) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  }, []);

  const start = (mode: "ar" | "fallback") => {
    setProgress({
      ...initialProgress,
      started: true,
      mode,
      phase: mode === "ar" ? "scan" : "observe",
      startedAt: Date.now(),
      settings: progress.settings,
    });
    setCameraError("");
    setCameraStatus("");
    setArPreviewIndex(null);
    setShowHome(false);
  };

  const resume = () => {
    setShowHome(false);
    setCameraError("");
    if (progress.mode === "ar" && progress.phase === "scan") setRetryKey((key) => key + 1);
  };

  const reset = () => {
    if (!window.confirm("이 기기에 저장된 1차시 진행과 점수를 지울까요?")) return;
    localStorage.removeItem(STORAGE_KEY);
    setProgress(initialProgress);
    setShowHome(true);
  };

  const switchToFallback = () => {
    setArPreviewIndex(null);
    mutate({ mode: "fallback", phase: progress.phase === "scan" ? "observe" : progress.phase });
    setCameraError("");
    setCameraStatus("비AR 모드: 문항·정답·피드백은 AR과 같습니다.");
  };

  const handleFound = useCallback((index: number) => {
    setProgress((current: any) => {
      if (index !== current.stageIndex) {
        setWrongMarker(`지금은 ${stages[current.stageIndex].marker} 마커가 필요합니다.`);
        return current;
      }
      setWrongMarker("");
      setCameraStatus(`${stages[index].marker} AR 작동을 관찰하세요.`);
      setArPreviewIndex((previewing) => previewing ?? index);
      return current;
    });
  }, []);

  const handleLost = useCallback((index: number) => {
    setProgress((current: any) => {
      if (index !== current.stageIndex) {
        setWrongMarker("");
        return current;
      }
      setArPreviewIndex((previewing) => previewing === index ? null : previewing);
      setCameraStatus("마커가 화면을 벗어났습니다. 5초 동안 화면 안에 유지해 주세요.");
      return current;
    });
  }, []);

  const handleCameraError = useCallback((message: string) => {
    setCameraError(message);
    setCameraStatus("");
  }, []);

  const handleCameraStatus = useCallback((message: string) => setCameraStatus(message), []);

  const attemptQuestion = (value: any) => {
    const currentRecord = progress.records[question.id] ?? { attempts: 0, completed: false };
    if (isAnswerCorrect(question, value)) {
      const earned = scoreForCorrectAttempt(currentRecord.attempts);
      mutate((current: any) => ({
        score: current.score + earned,
        records: {
          ...current.records,
          [question.id]: { attempts: currentRecord.attempts + 1, completed: true, score: earned, guided: false, hadError: currentRecord.attempts > 0 },
        },
      }));
      return;
    }
    const attempts = currentRecord.attempts + 1;
    mutate((current: any) => ({
      records: {
        ...current.records,
        [question.id]: { ...currentRecord, attempts, completed: false, guidedAvailable: attempts >= 2, hadError: true },
      },
    }));
  };

  const guidedComplete = () => {
    const currentRecord = progress.records[question.id];
    mutate((current: any) => ({
      score: current.score + GUIDED_SCORE,
      records: {
        ...current.records,
        [question.id]: { ...currentRecord, attempts: 3, completed: true, score: GUIDED_SCORE, guided: true, guidedAvailable: false, hadError: true },
      },
    }));
  };

  const nextQuestion = () => {
    if (progress.questionIndex === 9) {
      mutate({ completed: true, completedAt: Date.now(), phase: "complete" });
      return;
    }
    const nextIndex = progress.questionIndex + 1;
    const isStageEnd = !stage.questions.includes(nextIndex);
    mutate({ questionIndex: nextIndex, phase: isStageEnd ? "stageComplete" : "quiz" });
  };

  const nextStage = () => {
    const nextStageIndex = progress.stageIndex + 1;
    mutate({ stageIndex: nextStageIndex, phase: progress.mode === "ar" ? "scan" : "observe" });
    setArPreviewIndex(null);
    setCameraError("");
    setCameraStatus("");
    setRetryKey((key) => key + 1);
    window.scrollTo({ top: 0, behavior: progress.settings.reducedMotion ? "auto" : "smooth" });
  };

  if (!hydrated || (!bank && !loadError)) {
    return <main className="loading-screen"><div className="pulse-mark">V</div><p>1차시 미션을 준비하고 있습니다…</p></main>;
  }

  if (loadError) {
    return <main className="loading-screen"><div className="error-card"><h1>데이터를 열지 못했습니다</h1><p>{loadError}</p><button onClick={() => location.reload()}>다시 불러오기</button></div></main>;
  }

  if (showHome || !progress.started) {
    const estimated = Math.ceil(expectedLessonSeconds(bank, 1) / 60);
    return (
      <main className={`welcome-shell ${progress.settings.largeText ? "large-text" : ""}`}>
        <section className="hero-panel">
          <div className="hero-topline"><span>PHYSICS II · AR MISSION</span><span>ALPHA 1.0</span></div>
          <div className="battery-display" aria-label="스마트폰 배터리 1퍼센트"><span>01</span><small>%</small></div>
          <p className="eyebrow">전기의 여정 · 1차시</p>
          <h1>멀리 보내는<br />전기를 복구하라</h1>
          <p className="hero-copy">발전소에서 시작한 전기가 손실을 줄이며 도시의 220 V 교류가 되기까지. 세 개의 미션, 열 개의 진단으로 복구합니다.</p>
          <div className="mission-facts">
            <span><b>3</b><small>마커</small></span>
            <span><b>10</b><small>문항</small></span>
            <span><b>{estimated}–24</b><small>예상 분</small></span>
          </div>
        </section>

        <section className="start-panel">
          {progress.started && !progress.completed && (
            <div className="resume-card">
              <span>이 기기에 진행 기록이 있습니다</span>
              <strong>{stages[progress.stageIndex].name} · {progress.score}점</strong>
              <button className="primary-button" onClick={resume}>이어하기</button>
            </div>
          )}
          {progress.completed && (
            <div className="resume-card complete-resume">
              <span>1차시 완료 기록</span><strong>{progress.score}/100점</strong><button className="primary-button" onClick={resume}>결과 다시 보기</button>
            </div>
          )}
          {!progress.started && (
            <>
              <div className="privacy-note">
                <span className="privacy-icon">◎</span>
                <div><strong>카메라는 마커 인식에만 사용합니다</strong><p>실명·학번·사진·영상은 저장하거나 서버로 보내지 않습니다. 진행과 점수는 이 기기에만 저장됩니다.</p></div>
              </div>
              <div className="safety-note"><strong>안전</strong><span>카메라를 보며 걷지 않기 · 콘센트 접촉 및 충전기 분해 금지</span></div>
              <button className="primary-button camera-button" onClick={() => start("ar")}><span>카메라로 시작</span><small>01·02·03 마커를 순서대로 인식</small></button>
              <button className="secondary-button" onClick={() => start("fallback")}><span>카메라 없이 시작</span><small>같은 관찰·조작·10문항 진행</small></button>
            </>
          )}
          {(progress.started || progress.completed) && <button className="text-button danger-text" onClick={reset}>이 기기의 진행 기록 지우기</button>}
          <details className="accessibility-settings">
            <summary>화면 설정</summary>
            <label><input type="checkbox" checked={progress.settings.largeText} onChange={(event) => mutate({ settings: { ...progress.settings, largeText: event.target.checked } })} /> 글자 크게 보기</label>
            <label><input type="checkbox" checked={progress.settings.reducedMotion} onChange={(event) => mutate({ settings: { ...progress.settings, reducedMotion: event.target.checked } })} /> 애니메이션 줄이기</label>
          </details>
        </section>
      </main>
    );
  }

  if (progress.completed) {
    const wrongConcepts = lessonQuestions.filter((item: any) => progress.records[item.id]?.hadError).slice(0, 3);
    const totalMinutes = Math.max(1, Math.round(((progress.completedAt || progress.startedAt) - progress.startedAt) / 60000));
    return (
      <main className={`app-shell ${progress.settings.largeText ? "large-text" : ""}`}>
        <Header progress={progress} elapsedMinutes={totalMinutes} onHome={() => setShowHome(true)} />
        <section className="result-hero">
          <p className="eyebrow">MISSION COMPLETE</p>
          <div className="result-number">{progress.score}<small>/100</small></div>
          <h1>도시 전력망 복구 완료</h1>
          <p>AR 사용 여부와 관계없이 같은 열 문항과 피드백을 완료했습니다.</p>
        </section>
        <section className="result-grid">
          <article><span>완료 문항</span><strong>10 / 10</strong></article>
          <article><span>수행 시간</span><strong>{totalMinutes}분</strong></article>
          <article><span>진행 모드</span><strong>{progress.mode === "ar" ? "AR" : "비AR"}</strong></article>
        </section>
        <section className="panel takeaway-panel">
          <p className="eyebrow">1차시 필수 산출</p>
          <h2>같은 전력을 보낼 때 전압을 높이면 전류가 줄고, 송전선의 I²R 손실은 전류의 제곱에 따라 더 크게 줄어든다.</h2>
          <div className="formula-row"><span>P=VI</span><b>→</b><span>P<sub>손실</sub>=I²R</span></div>
        </section>
        <section className="panel review-panel">
          <p className="eyebrow">교사 설명 전에 다시 볼 개념</p>
          {wrongConcepts.length ? wrongConcepts.map((item: any) => <div key={item.id}><b>{item.id}</b><span>{item.misconception}</span></div>) : <p>첫 시도 정답 10/10입니다. 변압과 전압 강하의 차이를 말로 설명해 보세요.</p>}
        </section>
        <div className="result-actions"><button className="secondary-button" onClick={() => setShowHome(true)}>시작 화면</button><button className="text-button danger-text" onClick={reset}>진행 기록 지우기</button></div>
      </main>
    );
  }

  return (
    <main className={`app-shell ${progress.settings.largeText ? "large-text" : ""} ${progress.settings.reducedMotion ? "reduced-motion" : ""}`}>
      <Header progress={progress} elapsedMinutes={elapsedMinutes} onHome={() => setShowHome(true)} />
      <nav className="stage-rail" aria-label="1차시 단계">
        {stages.map((item, index) => <span key={item.number} className={index < progress.stageIndex ? "done" : index === progress.stageIndex ? "active" : ""}><b>{index < progress.stageIndex ? "✓" : item.number}</b><small>{item.name}</small></span>)}
      </nav>

      {progress.phase === "scan" && progress.mode === "ar" && (
        <section className="scan-section">
          <div className="scan-viewport">
            {!cameraError && <ARScene activeIndex={progress.stageIndex} retryKey={retryKey} onFound={handleFound} onLost={handleLost} onStatus={handleCameraStatus} onError={handleCameraError} />}
            <div className={`scan-frame ${arPreviewIndex !== null ? "previewing" : ""}`} aria-hidden="true"><i /><i /><i /><i /></div>
            {arPreviewIndex !== null && <div className="ar-preview-card" role="status"><strong>AR 관찰 중 · {arPreviewSeconds}초</strong><span>마커를 화면 안에 유지하세요</span></div>}
            <div className="marker-badge"><b>{stage.number}</b><span>{stage.marker}</span></div>
          </div>
          <div className="scan-copy">
            <p className="eyebrow">마커 인식</p>
            <h1>{stage.marker} 카드를<br />화면 안에 맞추세요</h1>
            <p className="status-line" role="status">{cameraError || wrongMarker || cameraStatus || "카메라를 준비하고 있습니다…"}</p>
            {scanTip >= 1 && !cameraError && arPreviewIndex === null && <div className="scan-tip"><strong>인식이 늦어지고 있어요</strong><span>카드를 평평하게 · 빛 반사 피하기 · 30~50 cm 거리 유지</span></div>}
            {cameraError && <button className="secondary-button" onClick={() => { setCameraError(""); setRetryKey((key) => key + 1); }}>카메라 다시 시도</button>}
            <button className={`fallback-button ${scanTip >= 2 || cameraError ? "emphasis" : ""}`} onClick={switchToFallback}>비AR로 같은 미션 계속하기</button>
            <small className="privacy-inline">카메라 영상·사진 비저장 / 비전송</small>
          </div>
        </section>
      )}

      {progress.phase === "observe" && (
        <section className="content-section">
          <div className="phase-heading"><span>1 / 5</span><p>관찰</p><h1>{stage.observeTitle}</h1></div>
          <div className="panel diagram-panel">
            <ScienceCanvas stageIndex={progress.stageIndex} value={stageValue} reducedMotion={progress.settings.reducedMotion} />
            <p>{stage.observeText}</p>
            <div className="simulation-label">과학 설명용 별도 시뮬레이션 · 마커 삽화와 분리</div>
          </div>
          <button className="primary-button" onClick={() => mutate({ phase: "predict" })}>관찰 완료 · 예측하기</button>
          {progress.mode === "fallback" && <p className="mode-note">비AR 모드 · AR과 같은 관찰 자료입니다.</p>}
        </section>
      )}

      {progress.phase === "predict" && (
        <section className="content-section">
          <div className="phase-heading"><span>2 / 5</span><p>예측</p><h1>결과를 보기 전에 선택하세요</h1></div>
          <section className="panel prediction-panel">
            <h2>{stage.prediction}</h2>
            <div className="option-list">
              {stage.predictionOptions.map((option) => <button type="button" key={option} className={`option option-button ${progress.predictions[progress.stageIndex] === option ? "selected" : ""}`} onClick={() => mutate({ predictions: { ...progress.predictions, [progress.stageIndex]: option } })}><span className="choice-mark">{progress.predictions[progress.stageIndex] === option ? "✓" : "○"}</span><span>{option}</span></button>)}
            </div>
            {progress.predictions[progress.stageIndex] && <p className="prediction-saved">예측 저장됨 · 다음 화면의 수치로 검증합니다.</p>}
          </section>
          <button className="primary-button" disabled={!progress.predictions[progress.stageIndex]} onClick={() => mutate({ phase: "manipulate" })}>예측 저장 · 조작하기</button>
        </section>
      )}

      {progress.phase === "manipulate" && (
        <section className="content-section">
          <div className="phase-heading"><span>3 / 5</span><p>조작·검증</p><h1>변수를 바꾸고 수치를 비교하세요</h1></div>
          <div className="panel diagram-panel">
            <ScienceCanvas stageIndex={progress.stageIndex} value={stageValue} reducedMotion={progress.settings.reducedMotion} />
            <div className="range-control">
              <span><label htmlFor={`stage-range-${progress.stageIndex}`}>{stage.sliderLabel}</label><output htmlFor={`stage-range-${progress.stageIndex}`}>{stageValue}{stage.sliderUnit}</output></span>
              <input id={`stage-range-${progress.stageIndex}`} type="range" min={stage.sliderMin} max={stage.sliderMax} step={stage.sliderStep} value={stageValue} onChange={(event) => mutate({ sliders: { ...progress.sliders, [progress.stageIndex]: Number(event.target.value) } })} />
            </div>
            <p className="manipulation-note">{stage.manipulationNote}</p>
            {progress.predictions[progress.stageIndex] && <div className={`prediction-check ${progress.predictions[progress.stageIndex] === stage.predictionAnswer ? "correct" : "revise"}`}><span>내 예측</span><b>{progress.predictions[progress.stageIndex]}</b><small>{progress.predictions[progress.stageIndex] === stage.predictionAnswer ? "수치 변화와 일치합니다." : `수치 변화와 비교하세요. 올바른 방향은 ‘${stage.predictionAnswer}’입니다.`}</small></div>}
          </div>
          <button className="primary-button" onClick={() => mutate({ phase: "quiz" })}>검증 완료 · 퀴즈 풀기</button>
        </section>
      )}

      {progress.phase === "quiz" && question && (
        <section className="content-section quiz-section">
          <div className="phase-heading compact"><span>4–5 / 5</span><p>퀴즈 · 피드백</p><h1>{stage.name}</h1></div>
          <QuestionCard key={question.id} question={question} number={progress.questionIndex + 1} record={progress.records[question.id]} onAttempt={attemptQuestion} onGuidedComplete={guidedComplete} onNext={nextQuestion} />
        </section>
      )}

      {progress.phase === "stageComplete" && (
        <section className="stage-complete-section">
          <div className="stage-seal">✓</div>
          <p className="eyebrow">STAGE {stage.number} RESTORED</p>
          <h1>{stage.name}<br />복구 완료</h1>
          <p>{progress.stageIndex === 0 ? "발전기는 운동 에너지를 전기 에너지로 전달합니다." : "같은 전력에서 전압을 높이면 전류와 송전 손실이 줄어듭니다."}</p>
          <div className="stage-score"><span>현재 점수</span><b>{progress.score}/100</b></div>
          <button className="primary-button" onClick={nextStage}>다음 마커 · {stages[progress.stageIndex + 1]?.marker}</button>
        </section>
      )}
    </main>
  );
}
