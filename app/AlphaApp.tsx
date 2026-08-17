"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { getDefaultSliders, getLessonConfig, LESSONS } from "../lib/lesson-config.js";
import {
  capacitorOutputVoltage,
  capacitorRippleFraction,
  rectifierCurrents,
  switchingRelativeTransfer,
  transformerSecondaryVoltage,
  transmissionMetrics,
} from "../lib/science-models.js";
import { joinStudentClass, liveClassConfigured, type StudentClassHandle, type StudentLiveState } from "./firebase-live";
import { TeacherDashboard } from "./TeacherDashboard";

const CONTENT_VERSION = "quiz-v3-science-audit-2026-08-17";
const STORAGE_KEY = "physgame.lesson1.alpha.v2";
const APP_VERSION = 2;
const AR_PREVIEW_SECONDS = 5;

function timestamp() {
  return Date.now();
}

function publicAsset(path: string) {
  const relativePath = path.replace(/^\/+/, "");
  return new URL(relativePath, document.baseURI).toString();
}

const initialProgress = {
  version: APP_VERSION,
  contentVersion: CONTENT_VERSION,
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
  nickname: "",
  settings: { largeText: false, reducedMotion: false },
};

function makeInitialProgress(lesson = 1) {
  return {
    ...initialProgress,
    lesson,
    scanMarkerIndex: 0,
    sliders: getDefaultSliders(lesson),
  };
}

function progressStorageKey(lesson: number) {
  return lesson === 1 ? STORAGE_KEY : `physgame.lesson${lesson}.v2`;
}

function mergeStoredProgress(raw: string | null, lesson = 1) {
  const defaults = makeInitialProgress(lesson);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== APP_VERSION || parsed.contentVersion !== CONTENT_VERSION) return defaults;
    return {
      ...defaults,
      ...parsed,
      lesson,
      records: { ...defaults.records, ...parsed.records },
      predictions: { ...defaults.predictions, ...parsed.predictions },
      sliders: { ...defaults.sliders, ...parsed.sliders },
      settings: { ...defaults.settings, ...parsed.settings },
    };
  } catch {
    return defaults;
  }
}

function toStudentLiveState(progress: any, showHome: boolean): StudentLiveState {
  const responses = Object.fromEntries(Object.entries(progress.records ?? {}).map(([id, recordValue]) => {
    const record = recordValue as any;
    return [id, {
      attempts: Math.max(0, Math.min(3, Number(record.attempts ?? 0))),
      completed: Boolean(record.completed),
      score: Math.max(0, Math.min(10, Number(record.score ?? 0))),
      guided: Boolean(record.guided),
      hadError: Boolean(record.hadError),
      submissions: (Array.isArray(record.submissions) ? record.submissions : []).slice(0, 3).map((submission: any) => ({
        correct: Boolean(submission.correct),
        choiceCode: String(submission.choiceCode ?? "").slice(0, 12),
      })),
    }];
  }));
  return {
    lesson: Number(progress.lesson ?? 1),
    stageIndex: Math.max(0, Math.min(2, Number(progress.stageIndex ?? 0))),
    phase: !progress.started ? "waiting" : progress.completed ? "complete" : showHome ? "paused" : String(progress.phase ?? "waiting").slice(0, 24),
    questionIndex: progress.started ? Math.max(0, Math.min(9, Number(progress.questionIndex ?? 0))) : -1,
    completedCount: Object.values(progress.records ?? {}).filter((record: any) => record?.completed).length,
    score: Math.max(0, Math.min(100, Number(progress.score ?? 0))),
    mode: progress.mode === "ar" ? "ar" : "non-ar",
    responses,
  };
}

function normalizeNickname(value: string) {
  return value.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").slice(0, 12);
}

function submissionChoiceCode(question: any, value: any) {
  if (!Array.isArray(question.options) || !question.options.length) return "";
  if (question.type === "sequence" && Array.isArray(value)) {
    return value.map((item) => question.options.indexOf(item) + 1).filter((index) => index > 0).join(">");
  }
  if (question.type === "multiple_select" && Array.isArray(value)) {
    return value.map((item) => question.options.indexOf(item) + 1).filter((index) => index > 0).sort((a, b) => a - b).join(",");
  }
  if (typeof value === "string") {
    const index = question.options.indexOf(value);
    return index >= 0 ? String(index + 1) : "";
  }
  return "";
}

function LiveClassNotice({ classCode, status }: { classCode: string; status: string }) {
  if (!classCode) return null;
  const connected = status.startsWith("연결됨");
  return <div className={`student-live-notice ${connected ? "connected" : ""}`} role="status"><span>{connected ? "●" : "○"}</span><b>실시간 수업 {classCode}</b><small>{status}</small></div>;
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
            <a-entity id="ar-target-3" mindar-image-target="targetIndex: 3">
              <a-entity visible="${activeIndex === 3}">
                <a-box color="#f5f0df" width="0.62" height="0.035" depth="0.035" rotation="0 0 45"></a-box>
                <a-box color="#f5f0df" width="0.62" height="0.035" depth="0.035" rotation="0 0 -45"></a-box>
                <a-sphere color="#ffd54a" radius="0.042" position="-0.3 0 0.07" animation__bridge1="property: position; from: -0.3 0 0.07; to: 0 0.3 0.07; loop: true; dur: 650; easing: linear"></a-sphere>
                <a-sphere color="#42d3c9" radius="0.042" position="0 0.3 0.07" animation__bridge2="property: position; from: 0 0.3 0.07; to: 0.3 0 0.07; loop: true; dur: 650; delay: 650; easing: linear"></a-sphere>
                <a-torus color="#ffd54a" radius="0.34" radius-tubular="0.012" rotation="90 0 0" animation__path="property: scale; from: 0.86 0.86 0.86; to: 1.08 1.08 1.08; dir: alternate; loop: true; dur: 700"></a-torus>
              </a-entity>
            </a-entity>
            <a-entity id="ar-target-4" mindar-image-target="targetIndex: 4">
              <a-entity visible="${activeIndex === 4}">
                <a-cylinder color="#42d3c9" radius="0.2" height="0.36" rotation="90 0 0" animation__charge="property: scale; from: 0.82 0.82 0.82; to: 1.12 1.12 1.12; dir: alternate; loop: true; dur: 900"></a-cylinder>
                <a-ring color="#ffd54a" radius-inner="0.24" radius-outer="0.27" rotation="90 0 0" animation__ripple="property: scale; from: 0.7 0.7 0.7; to: 1.35 1.35 1.35; loop: true; dur: 1150"></a-ring>
                <a-sphere color="#f5f0df" radius="0.035" position="-0.34 0 0.08" animation__chargeflow="property: position; from: -0.34 0 0.08; to: 0.34 0 0.08; dir: alternate; loop: true; dur: 950; easing: easeInOutSine"></a-sphere>
              </a-entity>
            </a-entity>
            <a-entity id="ar-target-5" mindar-image-target="targetIndex: 5">
              <a-entity visible="${activeIndex === 5}">
                <a-box color="#ffd54a" width="0.3" height="0.3" depth="0.08" animation__switch="property: rotation; from: 0 0 -18; to: 0 0 18; dir: alternate; loop: true; dur: 420; easing: easeInOutSine"></a-box>
                <a-box color="#42d3c9" width="0.82" height="0.025" depth="0.025" position="0 -0.24 0"></a-box>
                <a-sphere color="#f5f0df" radius="0.04" position="-0.38 -0.24 0.05" animation__pulse1="property: position; from: -0.38 -0.24 0.05; to: 0.38 -0.24 0.05; loop: true; dur: 780; easing: linear"></a-sphere>
                <a-sphere color="#ffd54a" radius="0.03" position="-0.38 -0.24 0.05" animation__pulse2="property: position; from: -0.38 -0.24 0.05; to: 0.38 -0.24 0.05; loop: true; dur: 780; delay: 390; easing: linear"></a-sphere>
              </a-entity>
            </a-entity>
          </a-scene>`;

        scene = host.querySelector("a-scene");
        await new Promise<void>((resolve) => {
          if (scene.hasLoaded) resolve();
          else scene.addEventListener("loaded", () => resolve(), { once: true });
        });
        if (cancelled) return;

        for (let index = 0; index < 6; index += 1) {
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

function ScienceCanvas({ visualType, stageName, value, reducedMotion }: any) {
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

      const drawPath = (points: Array<{ x: number; y: number }>, color = "#435765", lineWidth = 2) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
        ctx.stroke();
      };

      const plotWave = (left: number, top: number, plotWidth: number, plotHeight: number, sample: (phase: number) => number, color = cyan) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let x = 0; x <= plotWidth; x += 2) {
          const phase = (x / plotWidth) * Math.PI * 4;
          const y = top + plotHeight / 2 - sample(phase) * (plotHeight * 0.42);
          if (x === 0) ctx.moveTo(left + x, y);
          else ctx.lineTo(left + x, y);
        }
        ctx.stroke();
      };

      if (visualType === "generator") {
        const speed = value / 100;
        const turbineX = width * 0.2;
        const rotorX = width * 0.72;
        const rotorY = 92;
        ctx.fillStyle = ink;
        ctx.font = "800 12px system-ui, sans-serif";
        ctx.fillText("터빈의 운동 → 자석과 코일의 상대 운동", 14, 20);
        ctx.strokeStyle = yellow;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(turbineX, 88, 29, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < 6; i += 1) {
          const angle = (i * Math.PI) / 3 + speed * Math.PI * 0.8;
          ctx.beginPath();
          ctx.moveTo(turbineX, 88);
          ctx.lineTo(turbineX + Math.cos(angle) * 25, 88 + Math.sin(angle) * 25);
          ctx.stroke();
        }
        arrow(turbineX + 34, 88, rotorX - 44, 88, speed > 0 ? yellow : muted);
        ctx.fillStyle = "#173748"; ctx.fillRect(rotorX - 42, 45, 30, 27); ctx.fillRect(rotorX + 12, 109, 30, 27);
        ctx.fillStyle = cyan; ctx.font = "900 13px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.fillText("N", rotorX - 27, 63); ctx.fillText("S", rotorX + 27, 127); ctx.textAlign = "start";
        ctx.strokeStyle = cyan; ctx.lineWidth = 1.5;
        for (let i = -1; i <= 1; i += 1) arrow(rotorX - 23 + i * 12, 76, rotorX + 23 + i * 12, 104, cyan);
        ctx.save(); ctx.translate(rotorX, rotorY); ctx.rotate(speed * Math.PI * 0.8);
        ctx.strokeStyle = speed > 0 ? yellow : muted; ctx.lineWidth = 3; ctx.strokeRect(-18, -28, 36, 56); ctx.restore();
        ctx.fillStyle = muted; ctx.font = "650 9px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.fillText("터빈", turbineX, 132); ctx.fillText("자석·회전 코일", rotorX, 150); ctx.textAlign = "start";
        ctx.strokeStyle = "#304656"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(14, 171); ctx.lineTo(width - 14, 171); ctx.stroke();
        plotWave(16, 180, width - 32, 56, (phase) => Math.sin(phase) * speed, speed > 0 ? yellow : muted);
        ctx.fillStyle = speed > 0 ? yellow : muted; ctx.font = "750 10px system-ui, sans-serif";
        ctx.fillText(speed > 0 ? `유도 전압의 상대 크기 ${value}%` : "회전 정지 → 자기 선속 변화 0 → 유도 전압 0", 14, height - 13);
      } else if (visualType === "transmission" || visualType === "gridDiagnosis") {
        const { current, lineLoss: loss } = transmissionMetrics(value);
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
        const chartHeight = Math.max(60, height - 150);
        const currentHeight = chartHeight * (current / 10);
        const lossHeight = chartHeight * (loss / 100);
        ctx.fillStyle = cyan;
        const chartBase = height - 66;
        ctx.fillRect(width * 0.28 - 22, chartBase - currentHeight, 44, currentHeight);
        ctx.fillStyle = yellow;
        ctx.fillRect(width * 0.7 - 22, chartBase - lossHeight, 44, lossHeight);
        ctx.fillStyle = ink;
        ctx.fillText(`I = ${current.toFixed(1)} A`, width * 0.16, height - 41);
        ctx.fillText(`손실 = ${loss.toFixed(1)} W`, width * 0.52, height - 41);
        ctx.fillStyle = muted;
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.fillText("전류 눈금 0~10 A", Math.max(8, width * 0.12), height - 17);
        ctx.fillText("손실 눈금 0~100 W", Math.max(8, width * 0.53), height - 17);
        if (visualType === "gridDiagnosis") {
          ctx.fillStyle = muted;
          ctx.font = "700 11px system-ui, sans-serif";
          ctx.fillText("송전원 V", 14, 105);
          ctx.fillText("선로 강하 ΔV=IR", Math.max(14, width - 122), 105);
        }
      } else if (visualType === "transformer") {
        const secondaryVoltage = transformerSecondaryVoltage(2200, 1000, value);
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
        const turnsShown = Math.max(1, Math.round(8 * value / 1000));
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
      } else if (visualType === "rectifier") {
        const { inputCurrent, outputCurrent } = rectifierCurrents(value);
        const nearZero = Math.abs(inputCurrent) < 0.05;
        const positiveDirection = inputCurrent > 0;
        const graphLeft = 18;
        const graphWidth = width - graphLeft * 2;
        const graphTop = 54;
        const graphHeight = 62;
        const graphBaseline = graphTop + graphHeight / 2;
        const currentX = graphLeft + (Math.max(0, Math.min(360, value)) / 360) * graphWidth;
        const currentY = graphBaseline - inputCurrent * graphHeight * 0.42;
        const circuitTop = 218;
        const circuitMiddle = 282;
        const circuitBottom = 346;
        const bridgeCenterX = width * 0.49;
        const bridgeHalfWidth = Math.min(50, width * 0.18);
        const leftNode = { x: bridgeCenterX - bridgeHalfWidth, y: circuitMiddle };
        const rightNode = { x: bridgeCenterX + bridgeHalfWidth, y: circuitMiddle };
        const topNode = { x: bridgeCenterX, y: circuitTop };
        const bottomNode = { x: bridgeCenterX, y: circuitBottom };
        const sourceY = 410;
        const sourceRadius = 19;
        const loadX = width - 27;
        const activeColor = nearZero ? muted : yellow;

        const drawLine = (points: Array<{ x: number; y: number }>, color = "#435765", lineWidth = 2) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
          ctx.stroke();
        };
        const drawNode = (point: { x: number; y: number }, color = ink) => {
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2); ctx.fill();
        };
        const drawDiode = (from: { x: number; y: number }, to: { x: number; y: number }, label: string, active: boolean, labelSide: number) => {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const length = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx);
          const color = active ? yellow : "#738390";
          ctx.save();
          ctx.translate(from.x, from.y);
          ctx.rotate(angle);
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = active ? 3 : 2;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(length * 0.38, 0); ctx.moveTo(length * 0.62, 0); ctx.lineTo(length, 0); ctx.stroke();
          const center = length / 2;
          ctx.beginPath(); ctx.moveTo(center - 9, -8); ctx.lineTo(center - 9, 8); ctx.lineTo(center + 5, 0); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(center + 7, -9); ctx.lineTo(center + 7, 9); ctx.stroke();
          ctx.restore();
          const midpointX = (from.x + to.x) / 2;
          const midpointY = (from.y + to.y) / 2;
          ctx.fillStyle = color;
          ctx.font = "800 10px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(label, midpointX + (-dy / length) * 15 * labelSide, midpointY + (dx / length) * 15 * labelSide + 3);
          ctx.textAlign = "start";
        };

        ctx.fillStyle = ink;
        ctx.font = "800 12px system-ui, sans-serif";
        ctx.fillText("입력 교류의 한 주기와 현재 순간 θ", 14, 19);
        ctx.fillStyle = muted;
        ctx.font = "650 10px system-ui, sans-serif";
        ctx.fillText("θ: 한 주기(0°~360°)에서 현재 위치", 14, 37);
        ctx.strokeStyle = "#304656";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(graphLeft, graphBaseline); ctx.lineTo(graphLeft + graphWidth, graphBaseline); ctx.stroke();
        ctx.strokeStyle = cyan;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let x = 0; x <= graphWidth; x += 2) {
          const phase = (x / graphWidth) * Math.PI * 2;
          const y = graphBaseline - Math.sin(phase) * graphHeight * 0.42;
          if (x === 0) ctx.moveTo(graphLeft + x, y); else ctx.lineTo(graphLeft + x, y);
        }
        ctx.stroke();
        ctx.strokeStyle = ink;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(currentX, graphTop - 4); ctx.lineTo(currentX, graphTop + graphHeight + 3); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cyan;
        ctx.beginPath(); ctx.arc(currentX, currentY, 5, 0, Math.PI * 2); ctx.fill();
        ctx.font = "650 8px system-ui, sans-serif";
        ctx.textAlign = "center";
        [0, 90, 180, 270, 360].forEach((degree) => ctx.fillText(`${degree}°`, graphLeft + (degree / 360) * graphWidth, 128));
        ctx.textAlign = "start";
        ctx.fillStyle = nearZero ? muted : cyan;
        ctx.font = "750 10px system-ui, sans-serif";
        ctx.fillText(`θ=${value}° · 입력 ${inputCurrent.toFixed(2)} A · ${nearZero ? "순간적으로 0" : positiveDirection ? "A→B" : "B→A"}`, 14, 149);

        ctx.strokeStyle = "#304656";
        ctx.beginPath(); ctx.moveTo(14, 163); ctx.lineTo(width - 14, 163); ctx.stroke();
        ctx.fillStyle = ink;
        ctx.font = "800 12px system-ui, sans-serif";
        ctx.fillText("실제 회로에서 현재 전류가 지나는 길", 14, 183);
        ctx.fillStyle = nearZero ? muted : yellow;
        ctx.font = "700 10px system-ui, sans-serif";
        ctx.fillText(`전류계: ${outputCurrent.toFixed(2)} A · 부하에서는 항상 위→아래`, 14, 201);

        const sourceLeft = { x: bridgeCenterX - sourceRadius, y: sourceY };
        const sourceRight = { x: bridgeCenterX + sourceRadius, y: sourceY };
        const leftInputRoute = [leftNode, { x: leftNode.x, y: sourceY }, sourceLeft];
        const rightInputRoute = [rightNode, { x: rightNode.x, y: sourceY }, sourceRight];
        const outputTopRoute = [topNode, { x: loadX, y: circuitTop }, { x: loadX, y: 241 }];
        const outputBottomRoute = [{ x: loadX, y: 332 }, { x: loadX, y: circuitBottom }, bottomNode];

        drawLine(leftInputRoute); drawLine(rightInputRoute); drawLine(outputTopRoute); drawLine(outputBottomRoute);
        if (!nearZero) {
          const startRoute = positiveDirection ? [sourceLeft, { x: leftNode.x, y: sourceY }, leftNode] : [sourceRight, { x: rightNode.x, y: sourceY }, rightNode];
          const returnRoute = positiveDirection ? [rightNode, { x: rightNode.x, y: sourceY }, sourceRight] : [leftNode, { x: leftNode.x, y: sourceY }, sourceLeft];
          drawLine(startRoute, yellow, 4); drawLine([positiveDirection ? leftNode : rightNode, topNode], yellow, 4);
          drawLine([topNode, { x: loadX, y: circuitTop }, { x: loadX, y: 241 }], yellow, 4);
          drawLine([{ x: loadX, y: 279 }, { x: loadX, y: 293 }], yellow, 4);
          drawLine([{ x: loadX, y: 332 }, { x: loadX, y: circuitBottom }, bottomNode], yellow, 4);
          drawLine([bottomNode, positiveDirection ? rightNode : leftNode], yellow, 4); drawLine(returnRoute, yellow, 4);
        }

        drawDiode(leftNode, topNode, "D1", !nearZero && positiveDirection, -1);
        drawDiode(rightNode, topNode, "D2", !nearZero && !positiveDirection, 1);
        drawDiode(bottomNode, leftNode, "D3", !nearZero && !positiveDirection, -1);
        drawDiode(bottomNode, rightNode, "D4", !nearZero && positiveDirection, 1);
        [leftNode, rightNode, topNode, bottomNode].forEach((node) => drawNode(node, nearZero ? muted : ink));

        ctx.strokeStyle = activeColor;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(loadX, 260, 18, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = activeColor;
        ctx.font = "900 15px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.fillText("A", loadX, 265); ctx.textAlign = "start";
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(loadX, 293); ctx.lineTo(loadX - 7, 299); ctx.lineTo(loadX + 7, 305); ctx.lineTo(loadX - 7, 311); ctx.lineTo(loadX + 7, 317); ctx.lineTo(loadX - 7, 323); ctx.lineTo(loadX, 332); ctx.stroke();
        ctx.fillStyle = yellow;
        ctx.font = "900 11px system-ui, sans-serif";
        ctx.fillText("+", loadX - 14, 224); ctx.fillText("−", loadX - 14, 349);
        ctx.fillStyle = muted;
        ctx.font = "700 9px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.fillText("전류계", loadX, 286); ctx.fillText("부하 R", loadX - 16, 326); ctx.textAlign = "start";
        if (!nearZero) arrow(loadX - 19, 241, loadX - 19, 324, yellow);

        ctx.strokeStyle = muted;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bridgeCenterX, sourceY, sourceRadius, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = cyan;
        ctx.font = "900 18px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.fillText("~", bridgeCenterX, sourceY + 6); ctx.textAlign = "start";
        ctx.fillStyle = muted;
        ctx.font = "700 9px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.fillText("교류 입력", bridgeCenterX, 440); ctx.textAlign = "start";
        if (!nearZero) {
          const start = positiveDirection ? sourceLeft : sourceRight;
          ctx.fillStyle = yellow;
          ctx.beginPath(); ctx.arc(start.x, start.y, 5, 0, Math.PI * 2); ctx.fill();
          ctx.font = "800 9px system-ui, sans-serif";
          ctx.fillText(positiveDirection ? "A 시작" : "B 시작", positiveDirection ? Math.max(8, start.x - 31) : start.x + 5, sourceY - 8);
        }

        ctx.fillStyle = nearZero ? muted : yellow;
        ctx.font = "800 10px system-ui, sans-serif";
        const firstPathLine = nearZero ? `θ=${value}°: 입력과 출력 전류가 순간적으로 0 A` : positiveDirection ? "현재 길: 입력 A → D1 → 전류계·부하 ↓" : "현재 길: 입력 B → D2 → 전류계·부하 ↓";
        const secondPathLine = nearZero ? "슬라이더를 옮겨 전류 길을 확인하세요." : positiveDirection ? "→ D4 → 입력 B (출력 방향은 항상 같음)" : "→ D3 → 입력 A (출력 방향은 항상 같음)";
        ctx.fillText(firstPathLine, 14, height - 32);
        ctx.fillText(secondPathLine, 14, height - 15);
      } else if (visualType === "smoothing") {
        const rippleFraction = capacitorRippleFraction(value);
        const graphLeft = 18;
        const graphTop = 46;
        const graphWidth = width - 36;
        const graphHeight = 112;
        const voltageY = (voltage: number) => graphTop + graphHeight - 8 - voltage * (graphHeight - 20);
        const drawVoltageCurve = (sample: (phase: number) => number, color: string, dashed = false) => {
          ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.setLineDash(dashed ? [5, 4] : []); ctx.beginPath();
          for (let x = 0; x <= graphWidth; x += 2) {
            const phase = (x / graphWidth) * Math.PI * 4;
            const y = voltageY(sample(phase));
            if (x === 0) ctx.moveTo(graphLeft + x, y); else ctx.lineTo(graphLeft + x, y);
          }
          ctx.stroke(); ctx.setLineDash([]);
        };
        ctx.fillStyle = ink; ctx.font = "800 12px system-ui, sans-serif";
        ctx.fillText("정류 전압과 축전기 출력 전압 비교", 14, 20);
        ctx.fillStyle = muted; ctx.font = "650 9px system-ui, sans-serif";
        ctx.fillText("같은 부하·주파수에서 전기 용량 C만 비교", 14, 36);
        ctx.strokeStyle = "#304656"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(graphLeft, graphTop + graphHeight - 8); ctx.lineTo(graphLeft + graphWidth, graphTop + graphHeight - 8); ctx.stroke();
        drawVoltageCurve((phase) => Math.abs(Math.cos(phase)), muted, true);
        drawVoltageCurve((phase) => capacitorOutputVoltage(phase, rippleFraction), cyan);
        ctx.fillStyle = muted; ctx.font = "700 8px system-ui, sans-serif"; ctx.fillText("--- 정류 전압", 18, 170);
        ctx.fillStyle = cyan; ctx.fillText("━ 축전기·부하 전압", Math.max(105, width - 122), 170);
        ctx.fillStyle = yellow; ctx.font = "800 8px system-ui, sans-serif";
        [0, graphWidth / 2, graphWidth].forEach((offset) => { ctx.beginPath(); ctx.arc(graphLeft + offset, voltageY(1), 3, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillText("정류 전압이 다시 높아질 때 충전", 14, 187);

        const topRail = 226;
        const bottomRail = 346;
        const rectifierRight = 76;
        const capacitorX = width * 0.55;
        const loadX = width - 29;
        ctx.fillStyle = "#102936"; ctx.fillRect(12, 252, 64, 66);
        ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.strokeRect(12, 252, 64, 66);
        ctx.fillStyle = ink; ctx.font = "800 9px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("다이오드", 44, 277); ctx.fillText("정류 회로", 44, 292); ctx.textAlign = "start";
        drawPath([{ x: rectifierRight, y: 270 }, { x: rectifierRight, y: topRail }, { x: loadX, y: topRail }], "#526875", 2);
        drawPath([{ x: rectifierRight, y: 300 }, { x: rectifierRight, y: bottomRail }, { x: loadX, y: bottomRail }], "#526875", 2);
        drawPath([{ x: capacitorX, y: topRail }, { x: capacitorX, y: 276 }], cyan, 3);
        drawPath([{ x: capacitorX, y: 294 }, { x: capacitorX, y: bottomRail }], cyan, 3);
        ctx.strokeStyle = cyan; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(capacitorX - 17, 278); ctx.lineTo(capacitorX + 17, 278); ctx.moveTo(capacitorX - 17, 292); ctx.lineTo(capacitorX + 17, 292); ctx.stroke();
        ctx.fillStyle = cyan; ctx.font = "900 11px system-ui, sans-serif";
        ctx.fillText("+", capacitorX - 26, 279); ctx.fillText("−", capacitorX - 26, 296);
        ctx.font = "800 10px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(`C=${value} μF`, capacitorX, 316); ctx.textAlign = "start";
        drawPath([{ x: loadX, y: topRail }, { x: loadX, y: 267 }], yellow, 3);
        ctx.strokeStyle = yellow; ctx.lineWidth = 2.5; ctx.beginPath();
        ctx.moveTo(loadX, 267); ctx.lineTo(loadX - 7, 274); ctx.lineTo(loadX + 7, 282); ctx.lineTo(loadX - 7, 290); ctx.lineTo(loadX + 7, 298); ctx.lineTo(loadX - 7, 306); ctx.lineTo(loadX, 315); ctx.stroke();
        drawPath([{ x: loadX, y: 315 }, { x: loadX, y: bottomRail }], yellow, 3);
        ctx.fillStyle = yellow; ctx.font = "800 9px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("부하 R", loadX, 329); ctx.textAlign = "start";
        arrow(rectifierRight + 8, topRail, capacitorX - 20, topRail, cyan);
        arrow(capacitorX + 18, topRail, loadX - 5, topRail, yellow);
        arrow(loadX - 16, 247, loadX - 16, 326, yellow);
        ctx.fillStyle = cyan; ctx.font = "750 9px system-ui, sans-serif"; ctx.fillText("충전: 정류 전압 > 축전기 전압", 14, 372);
        ctx.fillStyle = yellow; ctx.fillText("방전: 정류 전압이 낮을 때 축전기 → 부하", 14, 389);
        ctx.fillStyle = muted; ctx.font = "700 9px system-ui, sans-serif";
        ctx.fillText(`상대 전압 변화 약 ${(rippleFraction * 100).toFixed(0)}% · ΔV≈ΔQ/C`, 14, height - 14);
      } else if (visualType === "switching") {
        const duty = switchingRelativeTransfer(value);
        ctx.fillStyle = ink; ctx.font = "800 12px system-ui, sans-serif"; ctx.fillText("트랜지스터를 켜고 끄는 제어 신호", 14, 20);
        ctx.fillStyle = muted; ctx.font = "650 9px system-ui, sans-serif"; ctx.fillText("한 주기에서 켜진 시간의 비율을 비교", 14, 37);
        const pulseLeft = 14; const pulseTop = 52; const pulseWidth = width - 28; const cell = pulseWidth / 5;
        ctx.strokeStyle = cyan; ctx.lineWidth = 3; ctx.beginPath();
        for (let i = 0; i < 5; i += 1) {
          const x = pulseLeft + i * cell;
          ctx.moveTo(x, pulseTop + 54); ctx.lineTo(x, pulseTop + 8); ctx.lineTo(x + cell * duty, pulseTop + 8); ctx.lineTo(x + cell * duty, pulseTop + 54); ctx.lineTo(x + cell, pulseTop + 54);
        }
        ctx.stroke();
        ctx.fillStyle = cyan; ctx.font = "800 9px system-ui, sans-serif"; ctx.fillText(`켜짐 ${value}%`, 14, 124);
        ctx.fillStyle = muted; ctx.fillText(`꺼짐 ${100 - value}%`, Math.max(80, width - 66), 124);
        ctx.strokeStyle = "#304656"; ctx.beginPath(); ctx.moveTo(14, 139); ctx.lineTo(width - 14, 139); ctx.stroke();
        ctx.fillStyle = ink; ctx.font = "800 10px system-ui, sans-serif"; ctx.fillText("전류 경로를 여닫는 개념 모형", 14, 159);
        const topY = 190;
        const bottomY = 258;
        const sourceX = 31;
        const switchLeft = 78;
        const switchRight = 108;
        const converterLeft = 125;
        const converterRight = width - 57;
        const batteryX = width - 27;
        ctx.fillStyle = "#102936"; ctx.fillRect(12, topY - 18, 38, bottomY - topY + 36);
        ctx.strokeStyle = cyan; ctx.lineWidth = 2; ctx.strokeRect(12, topY - 18, 38, bottomY - topY + 36);
        ctx.fillStyle = cyan; ctx.font = "900 9px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("외부", sourceX, 207); ctx.fillText("직류", sourceX, 220); ctx.fillText("+", sourceX, topY - 4); ctx.fillText("−", sourceX, bottomY + 11); ctx.textAlign = "start";
        drawPath([{ x: sourceX, y: topY }, { x: switchLeft - 4, y: topY }], cyan, 3);
        ctx.fillStyle = cyan; ctx.beginPath(); ctx.arc(switchLeft, topY, 4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(switchRight, topY, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = yellow; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(switchLeft + 1, topY - 1); ctx.lineTo(switchRight - 4, topY - 14); ctx.stroke();
        ctx.fillStyle = yellow; ctx.font = "800 8px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("트랜지스터", (switchLeft + switchRight) / 2, topY + 22); ctx.fillText("스위치", (switchLeft + switchRight) / 2, topY + 33); ctx.textAlign = "start";
        drawPath([{ x: switchRight + 4, y: topY }, { x: converterLeft, y: topY }], cyan, 3);
        ctx.fillStyle = "#173748"; ctx.fillRect(converterLeft, topY - 23, converterRight - converterLeft, 46);
        ctx.fillStyle = ink; ctx.font = "800 8px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("전압 변환", (converterLeft + converterRight) / 2, topY - 3); ctx.fillText("·에너지 전달", (converterLeft + converterRight) / 2, topY + 10); ctx.textAlign = "start";
        drawPath([{ x: converterRight, y: topY }, { x: batteryX, y: topY }, { x: batteryX, y: topY + 10 }], yellow, 3);
        ctx.fillStyle = "#102936"; ctx.fillRect(batteryX - 15, topY + 10, 30, bottomY - topY - 20);
        ctx.strokeStyle = yellow; ctx.lineWidth = 2.5; ctx.strokeRect(batteryX - 15, topY + 10, 30, bottomY - topY - 20);
        ctx.fillStyle = yellow; ctx.font = "900 10px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("+", batteryX, topY + 25); ctx.fillText("−", batteryX, bottomY - 13); ctx.fillText("배터리", batteryX, bottomY + 13); ctx.textAlign = "start";
        drawPath([{ x: batteryX, y: bottomY - 10 }, { x: batteryX, y: bottomY }, { x: sourceX, y: bottomY }], "#526875", 2.5);
        arrow(sourceX + 16, topY - 10, switchLeft - 7, topY - 10, yellow);
        arrow(switchRight + 5, topY - 10, converterLeft - 2, topY - 10, yellow);
        arrow(batteryX - 18, bottomY, sourceX + 18, bottomY, muted);
        ctx.fillStyle = ink; ctx.font = "800 10px system-ui, sans-serif"; ctx.fillText(`이상적 개념 모형의 상대 전달량 ≈ ${value}%`, 14, 285);
        ctx.fillStyle = muted; ctx.font = "650 9px system-ui, sans-serif";
        ctx.fillText("실제 충전기는 코일·변압기·축전기·보호 회로도 함께 사용", 14, height - 14);
      } else if (visualType === "faults") {
        const fault = Math.round(value);
        const labels = ["다이오드 하나 끊김", "축전기 제거", "트랜지스터 계속 켜짐"];
        ctx.fillStyle = yellow; ctx.font = "800 15px system-ui, sans-serif"; ctx.fillText(`LOG 0${fault} · ${labels[fault - 1]}`, 14, 28);
        ctx.strokeStyle = "#304656"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(14, 55); ctx.lineTo(width - 14, 55); ctx.stroke();
        if (fault === 1) {
          plotWave(16, 70, width - 32, 105, (phase) => Math.abs(Math.sin(phase)) * 0.9 - 0.42, cyan);
          plotWave(16, 70, width - 32, 105, (phase) => Math.max(0, Math.sin(phase)) * 0.9 - 0.42, yellow);
          ctx.fillStyle = cyan; ctx.font = "700 9px system-ui, sans-serif"; ctx.fillText("정상: 양쪽 구간 모두 출력", 14, 196);
          ctx.fillStyle = yellow; ctx.fillText("고장: 한쪽 구간 출력이 빠짐", 14, 214);
          ctx.fillStyle = ink; ctx.font = "800 11px system-ui, sans-serif"; ctx.fillText("평균 출력↓ · 축전기 사용 시 전압 변화↑", 14, height - 18);
        } else if (fault === 2) {
          plotWave(16, 70, width - 32, 105, (phase) => 0.35 - 0.12 * ((((phase % Math.PI) + Math.PI) % Math.PI) / Math.PI), cyan);
          plotWave(16, 70, width - 32, 105, (phase) => Math.abs(Math.sin(phase)) * 0.95 - 0.45, yellow);
          ctx.fillStyle = cyan; ctx.font = "700 9px system-ui, sans-serif"; ctx.fillText("정상: 축전기가 낮아지는 전압을 보충", 14, 196);
          ctx.fillStyle = yellow; ctx.fillText("제거: 정류 전압을 그대로 따라감", 14, 214);
          ctx.fillStyle = ink; ctx.font = "800 11px system-ui, sans-serif"; ctx.fillText("출력 전압 변화가 크게 증가", 14, height - 18);
        } else {
          const pulseWidth = width - 32;
          ctx.strokeStyle = cyan; ctx.lineWidth = 3; ctx.beginPath();
          for (let i = 0; i < 4; i += 1) { const x = 16 + i * pulseWidth / 4; ctx.moveTo(x, 130); ctx.lineTo(x, 82); ctx.lineTo(x + pulseWidth / 8, 82); ctx.lineTo(x + pulseWidth / 8, 130); ctx.lineTo(x + pulseWidth / 4, 130); }
          ctx.stroke();
          ctx.strokeStyle = yellow; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(16, 72); ctx.lineTo(width - 16, 72); ctx.stroke();
          ctx.fillStyle = cyan; ctx.font = "700 9px system-ui, sans-serif"; ctx.fillText("정상 제어: 켜짐·꺼짐 반복", 14, 158);
          ctx.fillStyle = yellow; ctx.fillText("고장: 계속 켜진 신호", 14, 176);
          ctx.fillStyle = ink; ctx.font = "800 11px system-ui, sans-serif"; ctx.fillText("전류 조절·보호 어려움 → 큰 전류·발열 가능", 14, height - 18);
        }
      } else if (visualType === "journey") {
        const step = Math.round(value);
        const labels = ["발전기: 에너지 전환", "변압·송전: 높임·낮춤", "다이오드: 한쪽 전압", "축전기: 전압 변화 줄임", "트랜지스터: 전류 조절"];
        const colors = [yellow, cyan, yellow, cyan, yellow];
        ctx.fillStyle = ink; ctx.font = "800 10px system-ui, sans-serif";
        ctx.fillText("전체 경로에서 지금 확인하는 역할", 14, 17);
        labels.forEach((label, index) => {
          const y = 28 + index * 24;
          const active = index + 1 <= step;
          ctx.fillStyle = active ? colors[index] : "#294151";
          ctx.fillRect(14, y, width - 28, 19);
          ctx.fillStyle = active ? "#08131d" : muted;
          ctx.font = "850 9px system-ui, sans-serif";
          ctx.fillText(`${index + 1}`, 20, y + 13);
          ctx.fillText(label, 38, y + 13);
        });
        const waveLeft = 14; const waveTop = 160; const waveWidth = width - 28;
        ctx.strokeStyle = "#304656"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(waveLeft, 196); ctx.lineTo(waveLeft + waveWidth, 196); ctx.stroke();
        if (step <= 2) plotWave(waveLeft, waveTop, waveWidth, 72, (phase) => Math.sin(phase), cyan);
        else if (step === 3) plotWave(waveLeft, waveTop, waveWidth, 72, (phase) => Math.abs(Math.sin(phase)) * 0.95 - 0.45, yellow);
        else if (step === 4) plotWave(waveLeft, waveTop, waveWidth, 72, (phase) => 0.48 - 0.22 * ((phase % Math.PI) / Math.PI), cyan);
        else plotWave(waveLeft, waveTop, waveWidth, 72, (phase) => 0.42 + 0.025 * Math.sin(phase * 3), yellow);
        ctx.fillStyle = muted; ctx.font = "700 9px system-ui, sans-serif"; ctx.fillText(`${step}단계의 단순화한 전압 모습`, 14, height - 10);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [reducedMotion, value, visualType]);

  return <canvas ref={canvasRef} className={`science-canvas science-canvas-${visualType}`} role="img" aria-label={`${stageName} 과학 시뮬레이션`} />;
}

function QuestionInput({ question, value, setValue }: any) {
  if (question.type === "short_answer_rubric") {
    return (
      <label className="short-answer-field">
        <span>세 문장 이내로 전체 여정을 설명하세요.</span>
        <textarea
          value={value}
          maxLength={360}
          rows={6}
          onChange={(event) => setValue(event.target.value)}
          placeholder="전력망에서는 전압을 높이고 … 충전기에서는 전류를 …"
        />
        <small>‘높이고·낮추고·한쪽으로·메우고·조절’의 다섯 역할을 모두 포함하세요. 자동 판정은 수업 중 참고용이며 최종 서술 평가는 교사가 확인합니다.</small>
      </label>
    );
  }

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

function QuestionCard({ question, number, lessonNumber, record, onAttempt, onGuidedComplete, onNext }: any) {
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
          {number === 10 ? `${lessonNumber}차시 결과 보기` : "다음으로"}
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

function Header({ progress, elapsedMinutes, lessonNumber, onHome }: any) {
  const completedCount = Object.values(progress.records).filter((record: any) => record.completed).length;
  const percent = Math.round((completedCount / 10) * 100);
  return (
    <header className="app-header">
      <button className="brand-button" type="button" onClick={onHome} aria-label="시작 화면으로">
        <span className="brand-mark">V</span>
        <span><b>전기의 여정</b><small>LESSON {String(lessonNumber).padStart(2, "0")}</small></span>
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
  const [selectedLesson, setSelectedLesson] = useState(1);
  const [progress, setProgress] = useState<any>(makeInitialProgress(1));
  const [hydrated, setHydrated] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [showTeacher, setShowTeacher] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [scanTip, setScanTip] = useState(0);
  const [wrongMarker, setWrongMarker] = useState("");
  const [arPreviewIndex, setArPreviewIndex] = useState<number | null>(null);
  const [arPreviewSeconds, setArPreviewSeconds] = useState(AR_PREVIEW_SECONDS);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [classCode, setClassCode] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [liveClassStatus, setLiveClassStatus] = useState("");
  const studentLiveRef = useRef<StudentClassHandle | null>(null);
  const progressRef = useRef(progress);
  const showHomeRef = useRef(showHome);

  useEffect(() => {
    progressRef.current = progress;
    showHomeRef.current = showHome;
  }, [progress, showHome]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lessonParam = Number(params.get("lesson"));
    const requestedLesson = [1, 2, 3].includes(lessonParam) ? lessonParam : 1;
    const qa = params.get("qa");
    setClassCode((params.get("class") ?? "").trim().toUpperCase());
    const isLocalQa = Boolean(qa) && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const isQaRun = Boolean(qa);
    setQaMode(isQaRun);
    setSelectedLesson(requestedLesson);
    setShowTeacher(params.get("teacher") === "1");
    const qaStageMatch = qa?.match(/^stage-([1-3])-manipulate$/);
    if (isLocalQa && qaStageMatch) {
      const stageIndex = Number(qaStageMatch[1]) - 1;
      const qaStages = getLessonConfig(requestedLesson).stages;
      const qaStage = qaStages[stageIndex];
      const qaValueParam = Number(params.get("qaValue"));
      const qaValue = Number.isFinite(qaValueParam) ? Math.max(qaStage.sliderMin, Math.min(qaStage.sliderMax, qaValueParam)) : qaStage.sliderDefault;
      setProgress({
        ...makeInitialProgress(requestedLesson),
        started: true,
        mode: "fallback",
        stageIndex,
        phase: "manipulate",
        questionIndex: qaStages[stageIndex].questions[0],
        predictions: { [stageIndex]: qaStage.predictionAnswer },
        sliders: { ...getDefaultSliders(requestedLesson), [stageIndex]: qaValue },
        startedAt: Date.now(),
      });
      setShowHome(false);
    } else if (isLocalQa && qa === "marker-found") {
      setProgress({ ...makeInitialProgress(requestedLesson), started: true, mode: "ar", phase: "scan", startedAt: Date.now() });
      setShowHome(false);
    } else {
      setProgress(isQaRun ? makeInitialProgress(requestedLesson) : mergeStoredProgress(localStorage.getItem(progressStorageKey(requestedLesson)), requestedLesson));
    }
    setHydrated(true);
    fetch(publicAsset(`data/quiz_bank_v1.json?v=${CONTENT_VERSION}`))
      .then((response) => {
        if (!response.ok) throw new Error("퀴즈 데이터를 불러오지 못했습니다.");
        return response.json();
      })
      .then(setBank)
      .catch((error) => setLoadError(error.message));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(publicAsset("sw.js")).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated || !classCode || showTeacher || normalizeNickname(progress.nickname ?? "").trim().length < 2) return;
    if (!liveClassConfigured) {
      setLiveClassStatus("실시간 연결 설정을 불러오지 못했습니다. 일반 모드로 계속할 수 있습니다.");
      return;
    }
    let cancelled = false;
    setLiveClassStatus("연결 중…");
    const connectTimer = window.setTimeout(() => joinStudentClass(classCode, Number(progressRef.current.lesson ?? selectedLesson), normalizeNickname(progressRef.current.nickname), toStudentLiveState(progressRef.current, showHomeRef.current))
      .then((handle) => {
        if (cancelled) {
          handle.leave().catch(() => undefined);
          return;
        }
        studentLiveRef.current = handle;
        setLiveClassStatus(`연결됨 · ${handle.alias}`);
      })
      .catch((error) => {
        if (cancelled) return;
        setLiveClassStatus(error instanceof Error ? error.message : "실시간 수업 연결에 실패했습니다.");
        const url = new URL(window.location.href);
        url.searchParams.delete("class");
        history.replaceState(null, "", `${url.pathname}${url.search ? url.search : ""}`);
        setClassCode("");
      }), 400);
    return () => {
      cancelled = true;
      window.clearTimeout(connectTimer);
      const handle = studentLiveRef.current;
      studentLiveRef.current = null;
      handle?.leave().catch(() => undefined);
    };
  }, [classCode, hydrated, progress.lesson, progress.nickname, selectedLesson, showTeacher]);

  useEffect(() => {
    const handle = studentLiveRef.current;
    if (!handle) return;
    const timer = window.setTimeout(() => {
      handle.update(toStudentLiveState(progress, showHome)).catch((error) => {
        setLiveClassStatus(error instanceof Error ? error.message : "실시간 상태 전송에 실패했습니다.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [progress, showHome]);

  useEffect(() => {
    if (!hydrated || qaMode) return;
    localStorage.setItem(progressStorageKey(progress.lesson ?? 1), JSON.stringify(progress));
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
  }, [arPreviewIndex, progress.completed, progress.mode, progress.phase, progress.scanMarkerIndex, progress.stageIndex, progress.started, retryKey, showHome]);

  useEffect(() => {
    if (arPreviewIndex === null) {
      setArPreviewSeconds(AR_PREVIEW_SECONDS);
      return;
    }
    setArPreviewSeconds(AR_PREVIEW_SECONDS);
    const ticker = window.setInterval(() => setArPreviewSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    const finish = window.setTimeout(() => {
      setProgress((current: any) => {
        const config = getLessonConfig(current.lesson);
        const currentStage = config.stages[current.stageIndex];
        const markerPosition = current.scanMarkerIndex ?? 0;
        const expectedTarget = currentStage.markers[markerPosition]?.targetIndex;
        if (current.mode !== "ar" || current.phase !== "scan" || expectedTarget !== arPreviewIndex) return current;
        if (markerPosition < currentStage.markers.length - 1) {
          return { ...current, scanMarkerIndex: markerPosition + 1 };
        }
        return { ...current, phase: "observe", scanMarkerIndex: 0 };
      });
      setArPreviewIndex(null);
      setCameraStatus("");
    }, AR_PREVIEW_SECONDS * 1000);
    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(finish);
    };
  }, [arPreviewIndex]);

  const lessonConfig = getLessonConfig(progress.lesson ?? selectedLesson);
  const stages = lessonConfig.stages;
  const lessonQuestions = useMemo(() => (bank ? getLessonQuestions(bank, progress.lesson ?? selectedLesson) : []), [bank, progress.lesson, selectedLesson]);
  const stage = stages[progress.stageIndex] ?? stages[0];
  const currentMarker = stage.markers[progress.scanMarkerIndex ?? 0] ?? stage.markers[0];
  const question = lessonQuestions[progress.questionIndex];
  const stageValue = Number(progress.sliders[progress.stageIndex] ?? stage.sliderDefault);

  const mutate = useCallback((patch: any) => {
    setProgress((current: any) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  }, []);

  const scrollToContentTop = useCallback(() => {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: progressRef.current.settings.reducedMotion ? "auto" : "smooth" }));
  }, []);

  const moveToPhase = useCallback((phase: string) => {
    mutate({ phase });
    scrollToContentTop();
  }, [mutate, scrollToContentTop]);

  const start = (mode: "ar" | "fallback") => {
    setProgress({
      ...makeInitialProgress(selectedLesson),
      started: true,
      mode,
      phase: mode === "ar" ? "scan" : "observe",
      startedAt: Date.now(),
      nickname: normalizeNickname(progress.nickname),
      settings: progress.settings,
    });
    setCameraError("");
    setCameraStatus("");
    setArPreviewIndex(null);
    setShowHome(false);
  };

  const joinLiveClass = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = joinCodeInput.trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
    if (normalized.length !== 6) {
      setLiveClassStatus("교사 화면의 6자리 수업 코드를 입력하세요.");
      return;
    }
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ lesson: String(selectedLesson), class: normalized }).toString();
    history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
    setJoinCodeInput(normalized);
    setClassCode(normalized);
    setLiveClassStatus("연결 중…");
  };

  const resume = () => {
    setShowHome(false);
    setCameraError("");
    if (progress.mode === "ar" && progress.phase === "scan") setRetryKey((key) => key + 1);
  };

  const reset = () => {
    if (!window.confirm(`이 기기에 저장된 ${lessonConfig.number}차시 진행과 점수를 지울까요?`)) return;
    localStorage.removeItem(progressStorageKey(lessonConfig.number));
    setProgress(makeInitialProgress(lessonConfig.number));
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
      const config = getLessonConfig(current.lesson);
      const currentStage = config.stages[current.stageIndex];
      const expected = currentStage.markers[current.scanMarkerIndex ?? 0];
      if (index !== expected.targetIndex) {
        setWrongMarker(`지금은 ${expected.label} 마커가 필요합니다.`);
        return current;
      }
      setWrongMarker("");
      setCameraStatus(`${expected.label} AR 작동을 관찰하세요.`);
      setArPreviewIndex((previewing) => previewing ?? index);
      return current;
    });
  }, []);

  const handleLost = useCallback((index: number) => {
    setProgress((current: any) => {
      const config = getLessonConfig(current.lesson);
      const currentStage = config.stages[current.stageIndex];
      const expected = currentStage.markers[current.scanMarkerIndex ?? 0];
      if (index !== expected.targetIndex) {
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
    const submission = { correct: isAnswerCorrect(question, value), choiceCode: submissionChoiceCode(question, value) };
    const submissions = [...(currentRecord.submissions ?? []), submission].slice(0, 3);
    if (submission.correct) {
      const earned = scoreForCorrectAttempt(currentRecord.attempts);
      mutate((current: any) => ({
        score: current.score + earned,
        records: {
          ...current.records,
          [question.id]: { attempts: currentRecord.attempts + 1, completed: true, score: earned, guided: false, hadError: currentRecord.attempts > 0, submissions },
        },
      }));
      return;
    }
    const attempts = currentRecord.attempts + 1;
    mutate((current: any) => ({
      records: {
        ...current.records,
        [question.id]: { ...currentRecord, attempts, completed: false, guidedAvailable: attempts >= 2, hadError: true, submissions },
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
    if (progress.questionIndex === lessonQuestions.length - 1) {
      mutate({ completed: true, completedAt: timestamp(), phase: "complete" });
      scrollToContentTop();
      return;
    }
    const nextIndex = progress.questionIndex + 1;
    const isStageEnd = !stage.questions.includes(nextIndex);
    mutate({ questionIndex: nextIndex, phase: isStageEnd ? "stageComplete" : "quiz" });
    scrollToContentTop();
  };

  const nextStage = () => {
    const nextStageIndex = progress.stageIndex + 1;
    mutate({ stageIndex: nextStageIndex, scanMarkerIndex: 0, phase: progress.mode === "ar" ? "scan" : "observe" });
    setArPreviewIndex(null);
    setCameraError("");
    setCameraStatus("");
    setRetryKey((key) => key + 1);
    window.scrollTo({ top: 0, behavior: progress.settings.reducedMotion ? "auto" : "smooth" });
  };

  const exportAnonymousResult = () => {
    const payload = {
      schema: "physgame-anonymous-result-v2",
      nickname: normalizeNickname(progress.nickname),
      lesson: lessonConfig.number,
      score: progress.score,
      mode: progress.mode,
      durationMinutes: Math.max(1, Math.round(((progress.completedAt || timestamp()) - progress.startedAt) / 60000)),
      records: progress.records,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `physgame-lesson${lessonConfig.number}-anonymous-result.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!hydrated || (!bank && !loadError)) {
    return <main className="loading-screen"><div className="pulse-mark">V</div><p>전기의 여정을 준비하고 있습니다…</p></main>;
  }

  if (loadError) {
    return <main className="loading-screen"><div className="error-card"><h1>데이터를 열지 못했습니다</h1><p>{loadError}</p><button onClick={() => location.reload()}>다시 불러오기</button></div></main>;
  }

  if (showTeacher) {
    return <TeacherDashboard bank={bank} onExit={() => { setShowTeacher(false); history.replaceState(null, "", new URL(document.baseURI).pathname); }} />;
  }

  if (showHome || !progress.started) {
    const selectedConfig = getLessonConfig(selectedLesson);
    const estimated = Math.ceil((expectedLessonSeconds(bank, selectedLesson) + 450) / 60);
    const nicknameReady = normalizeNickname(progress.nickname ?? "").trim().length >= 2;
    const chooseLesson = (lessonNumber: number) => {
      setSelectedLesson(lessonNumber);
      const nextProgress = mergeStoredProgress(localStorage.getItem(progressStorageKey(lessonNumber)), lessonNumber);
      setProgress({ ...nextProgress, nickname: nextProgress.nickname || progress.nickname });
      history.replaceState(null, "", `?lesson=${lessonNumber}`);
    };
    return (
      <main className={`welcome-shell ${progress.settings.largeText ? "large-text" : ""}`}>
        <section className="hero-panel">
          <div className="hero-topline"><span>PHYSICS II · AR MISSION</span><span>CLASS ALPHA</span></div>
          <div className="battery-display" aria-label={`${selectedLesson}차시`}><span>0{selectedLesson}</span><small>/3</small></div>
          <p className="eyebrow">전기의 여정 · {selectedLesson}차시</p>
          <h1>{selectedConfig.title}</h1>
          <p className="hero-copy">{selectedConfig.story} 관찰·예측·조작·퀴즈·피드백을 세 번 반복해 핵심 경로를 복구합니다.</p>
          <div className="mission-facts">
            <span><b>{new Set(selectedConfig.stages.flatMap((item: any) => item.markers.map((markerItem: any) => markerItem.targetIndex))).size}</b><small>마커</small></span>
            <span><b>10</b><small>문항</small></span>
            <span><b>{estimated}–24</b><small>예상 분</small></span>
          </div>
        </section>

        <section className="start-panel">
          <LiveClassNotice classCode={classCode} status={liveClassStatus} />
          <label className="nickname-panel">
            <strong>수업용 익명 닉네임</strong>
            <span>실명·학번 대신 친구와 구별되는 2~12자 별칭을 입력하세요.</span>
            <input aria-label="수업용 익명 닉네임" autoComplete="off" maxLength={12} placeholder="예: 별빛여우" value={progress.nickname ?? ""} onChange={(event) => mutate({ nickname: normalizeNickname(event.target.value) })} />
            <small>{nicknameReady ? `교사용 화면에는 ‘${normalizeNickname(progress.nickname)}’(으)로 표시됩니다.` : "닉네임을 입력해야 활동을 시작할 수 있습니다."}</small>
          </label>
          {!classCode && <div className="lesson-picker" aria-label="학습 차시 선택">
            {Object.values(LESSONS).map((item: any) => <button key={item.number} className={selectedLesson === item.number ? "active" : ""} onClick={() => chooseLesson(item.number)}><b>{item.number}차시</b><span>{item.title}</span></button>)}
          </div>}
          {!classCode && liveClassConfigured && <form className="student-join-panel" onSubmit={joinLiveClass}>
            <strong>교사용 진행판에 연결하기</strong>
            <p>기본 주소로 접속했다면 교사 화면의 6자리 수업 코드를 입력하세요. QR로 접속한 경우에는 자동 연결됩니다.</p>
            <div><input aria-label="6자리 수업 코드" inputMode="text" autoCapitalize="characters" autoComplete="off" maxLength={6} placeholder="예: A2B3C4" value={joinCodeInput} onChange={(event) => setJoinCodeInput(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ""))} /><button type="submit">수업 연결</button></div>
            {liveClassStatus && <small role="alert">{liveClassStatus}</small>}
          </form>}
          {progress.started && !progress.completed && (
            <div className="resume-card">
              <span>이 기기의 {selectedLesson}차시 진행 기록이 있습니다</span>
              <strong>{stages[progress.stageIndex].name} · {progress.score}점</strong>
              <button className="primary-button" disabled={!nicknameReady} onClick={resume}>이어하기</button>
            </div>
          )}
          {progress.completed && (
            <div className="resume-card complete-resume">
              <span>{selectedLesson}차시 완료 기록</span><strong>{progress.score}/100점</strong><button className="primary-button" disabled={!nicknameReady} onClick={resume}>결과 다시 보기</button>
            </div>
          )}
          {!progress.started && (
            <>
              <div className="privacy-note">
                <span className="privacy-icon">◎</span>
                <div><strong>카메라는 마커 인식에만 사용합니다</strong><p>실명·학번·사진·영상은 저장하거나 전송하지 않습니다. 수업 QR로 접속하면 위 익명 닉네임·단계·점수·문항별 선택 번호와 정오만 교사용 진행판에 공유됩니다.</p></div>
              </div>
              <div className="safety-note"><strong>안전</strong><span>카메라를 보며 걷지 않기 · 콘센트 접촉 및 충전기 분해 금지</span></div>
              <button className="primary-button camera-button" disabled={!nicknameReady} onClick={() => start("ar")}><span>카메라로 시작</span><small>{selectedConfig.stages.flatMap((item: any) => item.markers).map((item: any) => item.number).join("·")} 마커를 단계별 인식</small></button>
              <button className="secondary-button" disabled={!nicknameReady} onClick={() => start("fallback")}><span>카메라 없이 시작</span><small>같은 관찰·조작·10문항 진행</small></button>
            </>
          )}
          {(progress.started || progress.completed) && <button className="text-button danger-text" onClick={reset}>이 기기의 진행 기록 지우기</button>}
          <details className="accessibility-settings">
            <summary>화면 설정</summary>
            <label><input type="checkbox" checked={progress.settings.largeText} onChange={(event) => mutate({ settings: { ...progress.settings, largeText: event.target.checked } })} /> 글자 크게 보기</label>
            <label><input type="checkbox" checked={progress.settings.reducedMotion} onChange={(event) => mutate({ settings: { ...progress.settings, reducedMotion: event.target.checked } })} /> 애니메이션 줄이기</label>
          </details>
          <button className="teacher-entry" onClick={() => { setShowTeacher(true); history.replaceState(null, "", "?teacher=1"); }}>교사용 진행 화면 열기</button>
        </section>
      </main>
    );
  }

  if (progress.completed) {
    const wrongConcepts = lessonQuestions.filter((item: any) => progress.records[item.id]?.hadError).slice(0, 3);
    const totalMinutes = Math.max(1, Math.round(((progress.completedAt || progress.startedAt) - progress.startedAt) / 60000));
    return (
      <main className={`app-shell ${progress.settings.largeText ? "large-text" : ""}`}>
        <Header progress={progress} lessonNumber={lessonConfig.number} elapsedMinutes={totalMinutes} onHome={() => setShowHome(true)} />
        <LiveClassNotice classCode={classCode} status={liveClassStatus} />
        <section className="result-hero">
          <p className="eyebrow">MISSION COMPLETE</p>
          <div className="result-number">{progress.score}<small>/100</small></div>
          <h1>{lessonConfig.title} 복구 완료</h1>
          <p>AR 사용 여부와 관계없이 같은 열 문항과 피드백을 완료했습니다.</p>
        </section>
        <section className="result-grid">
          <article><span>완료 문항</span><strong>10 / 10</strong></article>
          <article><span>수행 시간</span><strong>{totalMinutes}분</strong></article>
          <article><span>진행 모드</span><strong>{progress.mode === "ar" ? "AR" : "비AR"}</strong></article>
        </section>
        <section className="panel takeaway-panel">
          <p className="eyebrow">{lessonConfig.number}차시 필수 산출</p>
          <h2>{lessonConfig.outcome}</h2>
          <div className="formula-row"><span>{lessonConfig.number === 1 ? "P=VI → I²R" : lessonConfig.number === 2 ? "교류 입력 → 한 방향 전류 → 출력 변화 줄이기 → 전류 조절" : "높이고 → 낮추고 → 한쪽으로 → 메우고 → 조절"}</span></div>
        </section>
        <section className="panel review-panel">
          <p className="eyebrow">교사 설명 전에 다시 볼 개념</p>
          {wrongConcepts.length ? wrongConcepts.map((item: any) => <div key={item.id}><b>{item.id}</b><span>{item.misconception}</span></div>) : <p>첫 시도 정답 10/10입니다. 이번 차시의 핵심 경로를 자신의 말로 설명해 보세요.</p>}
        </section>
        <div className="result-actions"><button className="primary-button" onClick={exportAnonymousResult}>교사용 익명 결과 저장</button><button className="secondary-button" onClick={() => setShowHome(true)}>시작 화면</button><button className="text-button danger-text" onClick={reset}>진행 기록 지우기</button></div>
      </main>
    );
  }

  return (
    <main className={`app-shell ${progress.settings.largeText ? "large-text" : ""} ${progress.settings.reducedMotion ? "reduced-motion" : ""}`}>
      <Header progress={progress} lessonNumber={lessonConfig.number} elapsedMinutes={elapsedMinutes} onHome={() => setShowHome(true)} />
      <LiveClassNotice classCode={classCode} status={liveClassStatus} />
      <nav className="stage-rail" aria-label={`${lessonConfig.number}차시 단계`}>
        {stages.map((item, index) => <span key={item.number} className={index < progress.stageIndex ? "done" : index === progress.stageIndex ? "active" : ""}><b>{index < progress.stageIndex ? "✓" : item.number}</b><small>{item.name}</small></span>)}
      </nav>

      {progress.phase === "scan" && progress.mode === "ar" && (
        <section className="scan-section">
          <div className="scan-viewport">
            {!cameraError && <ARScene activeIndex={currentMarker.targetIndex} retryKey={retryKey} onFound={handleFound} onLost={handleLost} onStatus={handleCameraStatus} onError={handleCameraError} />}
            <div className={`scan-frame ${arPreviewIndex !== null ? "previewing" : ""}`} aria-hidden="true"><i /><i /><i /><i /></div>
            {arPreviewIndex !== null && <div className="ar-preview-card" role="status"><strong>AR 관찰 중 · {arPreviewSeconds}초</strong><span>마커를 화면 안에 유지하세요</span></div>}
            <div className="marker-badge"><b>{currentMarker.number}</b><span>{currentMarker.name}{stage.markers.length > 1 ? ` · ${progress.scanMarkerIndex + 1}/${stage.markers.length}` : ""}</span></div>
          </div>
          <div className="scan-copy">
            <p className="eyebrow">마커 인식</p>
            <h1>{currentMarker.label} 카드를<br />화면 안에 맞추세요</h1>
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
            <ScienceCanvas visualType={stage.visualType} stageName={stage.name} value={stageValue} reducedMotion={progress.settings.reducedMotion} />
            <p>{stage.observeText}</p>
            <div className="simulation-label">과학 설명용 별도 시뮬레이션 · 마커 삽화와 분리</div>
          </div>
          <button className="primary-button" onClick={() => moveToPhase("predict")}>관찰 완료 · 예측하기</button>
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
          <button className="primary-button" disabled={!progress.predictions[progress.stageIndex]} onClick={() => moveToPhase("manipulate")}>예측 저장 · 조작하기</button>
        </section>
      )}

      {progress.phase === "manipulate" && (
        <section className="content-section">
          <div className="phase-heading"><span>3 / 5</span><p>조작·검증</p><h1>변수를 바꾸고 수치를 비교하세요</h1></div>
          <div className="panel diagram-panel">
            <ScienceCanvas visualType={stage.visualType} stageName={stage.name} value={stageValue} reducedMotion={progress.settings.reducedMotion} />
            <div className="range-control">
              <span><label htmlFor={`stage-range-${progress.stageIndex}`}>{stage.sliderLabel}</label><output htmlFor={`stage-range-${progress.stageIndex}`}>{stageValue}{stage.sliderUnit}</output></span>
              <input id={`stage-range-${progress.stageIndex}`} type="range" min={stage.sliderMin} max={stage.sliderMax} step={stage.sliderStep} value={stageValue} onChange={(event) => mutate({ sliders: { ...progress.sliders, [progress.stageIndex]: Number(event.target.value) } })} />
            </div>
            <p className="manipulation-note">{stage.manipulationNote}</p>
            {progress.predictions[progress.stageIndex] && <div className={`prediction-check ${progress.predictions[progress.stageIndex] === stage.predictionAnswer ? "correct" : "revise"}`}><span>내 예측</span><b>{progress.predictions[progress.stageIndex]}</b><small>{progress.predictions[progress.stageIndex] === stage.predictionAnswer ? "수치 변화와 일치합니다." : `수치 변화와 비교하세요. 올바른 방향은 ‘${stage.predictionAnswer}’입니다.`}</small></div>}
          </div>
          <button className="primary-button" onClick={() => moveToPhase("quiz")}>검증 완료 · 퀴즈 풀기</button>
        </section>
      )}

      {progress.phase === "quiz" && question && (
        <section className="content-section quiz-section">
          <div className="phase-heading compact"><span>4–5 / 5</span><p>퀴즈 · 피드백</p><h1>{stage.name}</h1></div>
          <QuestionCard key={question.id} question={question} number={progress.questionIndex + 1} lessonNumber={lessonConfig.number} record={progress.records[question.id]} onAttempt={attemptQuestion} onGuidedComplete={guidedComplete} onNext={nextQuestion} />
        </section>
      )}

      {progress.phase === "stageComplete" && (
        <section className="stage-complete-section">
          <div className="stage-seal">✓</div>
          <p className="eyebrow">STAGE {stage.number} RESTORED</p>
          <h1>{stage.name}<br />복구 완료</h1>
          <p>{stage.observeText}</p>
          <div className="stage-score"><span>현재 점수</span><b>{progress.score}/100</b></div>
          <button className="primary-button" onClick={nextStage}>다음 단계 · {stages[progress.stageIndex + 1]?.name}</button>
        </section>
      )}
    </main>
  );
}
