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
import { getDefaultSliders, getLessonConfig, LESSONS } from "../lib/lesson-config.js";
import { TeacherDashboard } from "./TeacherDashboard";

const STORAGE_KEY = "physgame.lesson1.alpha.v1";
const APP_VERSION = 1;
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

function makeInitialProgress(lesson = 1) {
  return {
    ...initialProgress,
    lesson,
    scanMarkerIndex: 0,
    sliders: getDefaultSliders(lesson),
  };
}

function progressStorageKey(lesson: number) {
  return lesson === 1 ? STORAGE_KEY : `physgame.lesson${lesson}.v1`;
}

function mergeStoredProgress(raw: string | null, lesson = 1) {
  const defaults = makeInitialProgress(lesson);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== APP_VERSION) return defaults;
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
      } else if (visualType === "transmission" || visualType === "gridDiagnosis") {
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
        if (visualType === "gridDiagnosis") {
          ctx.fillStyle = muted;
          ctx.font = "700 11px system-ui, sans-serif";
          ctx.fillText("송전원 V", 14, 105);
          ctx.fillText("선로 강하 ΔV=IR", Math.max(14, width - 122), 105);
        }
      } else if (visualType === "transformer") {
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
      } else if (visualType === "rectifier") {
        const positiveHalf = value % 360 < 180;
        ctx.fillStyle = ink;
        ctx.fillText("입력 교류", 14, 25);
        ctx.fillText("정류 직후", Math.max(14, width * 0.57), 25);
        ctx.strokeStyle = "#304656";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(12, 74); ctx.lineTo(width * 0.43, 74); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(width * 0.55, 74); ctx.lineTo(width - 12, 74); ctx.stroke();
        plotWave(14, 35, width * 0.38, 78, (phase) => Math.sin(phase), cyan);
        plotWave(width * 0.57, 35, width * 0.38, 78, (phase) => Math.abs(Math.sin(phase)) * 0.95 - 0.45, yellow);
        const cx = width / 2;
        const cy = height - 78;
        const size = Math.min(56, width * 0.18);
        ctx.strokeStyle = ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy - size); ctx.lineTo(cx + size, cy); ctx.lineTo(cx, cy + size); ctx.lineTo(cx - size, cy); ctx.closePath(); ctx.stroke();
        const pathColor = yellow;
        ctx.fillStyle = positiveHalf ? pathColor : muted;
        ctx.fillText("D1", cx - size + 8, cy - 20); ctx.fillText("D4", cx + 18, cy + 30);
        ctx.fillStyle = positiveHalf ? muted : pathColor;
        ctx.fillText("D2", cx + 18, cy - 20); ctx.fillText("D3", cx - size + 8, cy + 30);
        arrow(cx - size - 42, cy, cx - size + 2, cy, positiveHalf ? cyan : yellow);
        arrow(cx + size - 2, cy, cx + size + 42, cy, yellow);
        ctx.fillStyle = muted; ctx.font = "700 11px system-ui, sans-serif";
        ctx.fillText(positiveHalf ? "도통 경로 D1 → 부하 → D4" : "도통 경로 D2 → 부하 → D3", Math.max(12, cx - 83), height - 12);
      } else if (visualType === "smoothing") {
        const ripple = Math.max(0.08, Math.min(0.7, 260 / value));
        ctx.fillStyle = ink; ctx.fillText("맥동 직류", 14, 25); ctx.fillText("평활 출력", width * 0.58, 25);
        plotWave(14, 38, width * 0.38, 94, (phase) => Math.abs(Math.sin(phase)) * 0.95 - 0.45, muted);
        plotWave(width * 0.56, 38, width * 0.4, 94, (phase) => 0.55 - ripple * ((phase % Math.PI) / Math.PI), cyan);
        ctx.fillStyle = cyan;
        ctx.fillRect(width * 0.18, 160, 18, 70);
        ctx.fillRect(width * 0.18 - 12, 172, 42, 5);
        ctx.fillRect(width * 0.18 - 12, 210, 42, 5);
        arrow(width * 0.31, 193, width * 0.58, 193, yellow);
        ctx.fillStyle = ink; ctx.fillText(`C=${value} μF`, 14, height - 18);
        ctx.fillStyle = yellow; ctx.fillText(`상대 리플 ${(ripple * 100).toFixed(0)}%`, Math.max(14, width - 112), height - 18);
      } else if (visualType === "switching") {
        const duty = value / 100;
        ctx.fillStyle = ink; ctx.fillText("게이트 신호", 14, 25); ctx.fillText("에너지 펄스", width * 0.57, 25);
        const pulseLeft = 14; const pulseTop = 55; const pulseWidth = width - 28; const cell = pulseWidth / 5;
        ctx.strokeStyle = cyan; ctx.lineWidth = 3; ctx.beginPath();
        for (let i = 0; i < 5; i += 1) {
          const x = pulseLeft + i * cell;
          ctx.moveTo(x, pulseTop + 55); ctx.lineTo(x, pulseTop + 8); ctx.lineTo(x + cell * duty, pulseTop + 8); ctx.lineTo(x + cell * duty, pulseTop + 55); ctx.lineTo(x + cell, pulseTop + 55);
        }
        ctx.stroke();
        for (let i = 0; i < 5; i += 1) {
          ctx.fillStyle = i % 2 ? yellow : cyan;
          ctx.fillRect(18 + i * ((width - 46) / 5), 150, Math.max(8, ((width - 56) / 5) * duty), 42);
        }
        arrow(24, 220, width - 24, 220, yellow);
        ctx.fillStyle = muted; ctx.font = "700 11px system-ui, sans-serif";
        ctx.fillText("ON: 작은 전압 강하", 14, height - 17);
        ctx.fillText("OFF: 작은 전류", Math.max(14, width - 108), height - 17);
      } else if (visualType === "faults") {
        const fault = Math.round(value);
        const labels = ["다이오드 단선", "축전기 제거", "트랜지스터 ON 고정"];
        ctx.fillStyle = yellow; ctx.font = "800 15px system-ui, sans-serif"; ctx.fillText(`LOG 0${fault} · ${labels[fault - 1]}`, 14, 28);
        ctx.strokeStyle = "#304656"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(14, 55); ctx.lineTo(width - 14, 55); ctx.stroke();
        if (fault === 1) {
          plotWave(16, 72, width - 32, 116, (phase) => Math.max(0, Math.sin(phase)) * 0.9 - 0.42, yellow);
          ctx.fillStyle = ink; ctx.fillText("일부 반주기 경로 소실", 14, height - 44); ctx.fillStyle = muted; ctx.fillText("평균 출력↓ · 리플↑", 14, height - 18);
        } else if (fault === 2) {
          plotWave(16, 72, width - 32, 116, (phase) => Math.abs(Math.sin(phase)) * 0.95 - 0.45, yellow);
          ctx.fillStyle = ink; ctx.fillText("골짜기를 메우는 방전 없음", 14, height - 44); ctx.fillStyle = muted; ctx.fillText("출력 리플 크게 증가", 14, height - 18);
        } else {
          ctx.fillStyle = yellow; ctx.fillRect(18, 86, width - 36, 62);
          ctx.fillStyle = "#08131d"; ctx.font = "900 24px system-ui, sans-serif"; ctx.fillText("ON", width / 2 - 20, 126);
          ctx.fillStyle = ink; ctx.font = "700 13px system-ui, sans-serif"; ctx.fillText("스위칭·보호 제어 상실", 14, height - 44); ctx.fillStyle = muted; ctx.fillText("과전류·발열 위험", 14, height - 18);
        }
      } else if (visualType === "journey") {
        const step = Math.round(value);
        const labels = ["발전", "송전·강압", "정류", "평활", "출력 제어"];
        const colors = [yellow, cyan, yellow, cyan, yellow];
        const usable = width - 36;
        labels.forEach((label, index) => {
          const x = 18 + (index * usable) / 5;
          ctx.fillStyle = index + 1 <= step ? colors[index] : "#294151";
          ctx.fillRect(x, 52, usable / 5 - 5, 42);
          ctx.save(); ctx.translate(x + 8, 110); ctx.rotate(-0.32); ctx.fillStyle = ink; ctx.font = "800 10px system-ui, sans-serif"; ctx.fillText(label, 0, 0); ctx.restore();
        });
        const waveLeft = 14; const waveTop = 155; const waveWidth = width - 28;
        if (step <= 2) plotWave(waveLeft, waveTop, waveWidth, 84, (phase) => Math.sin(phase), cyan);
        else if (step === 3) plotWave(waveLeft, waveTop, waveWidth, 84, (phase) => Math.abs(Math.sin(phase)) * 0.95 - 0.45, yellow);
        else if (step === 4) plotWave(waveLeft, waveTop, waveWidth, 84, (phase) => 0.48 - 0.22 * ((phase % Math.PI) / Math.PI), cyan);
        else plotWave(waveLeft, waveTop, waveWidth, 84, () => 0.42, yellow);
        ctx.fillStyle = muted; ctx.font = "700 11px system-ui, sans-serif"; ctx.fillText(`${step}. ${labels[step - 1]} 단계의 대표 파형`, 14, height - 16);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [reducedMotion, value, visualType]);

  return <canvas ref={canvasRef} className="science-canvas" role="img" aria-label={`${stageName} 과학 시뮬레이션`} />;
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
          placeholder="전력망에서는 전압을 … 충전기에서는 …"
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lessonParam = Number(params.get("lesson"));
    const requestedLesson = [1, 2, 3].includes(lessonParam) ? lessonParam : 1;
    const qa = params.get("qa");
    const isLocalQa = Boolean(qa) && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const isQaRun = Boolean(qa);
    setQaMode(isQaRun);
    setSelectedLesson(requestedLesson);
    setShowTeacher(params.get("teacher") === "1");
    if (isLocalQa && (qa === "stage-2-manipulate" || qa === "stage-3-manipulate")) {
      const stageIndex = qa === "stage-2-manipulate" ? 1 : 2;
      const qaStages = getLessonConfig(requestedLesson).stages;
      setProgress({
        ...makeInitialProgress(requestedLesson),
        started: true,
        mode: "fallback",
        stageIndex,
        phase: "manipulate",
        questionIndex: stageIndex === 1 ? 2 : 6,
        predictions: { [stageIndex]: qaStages[stageIndex].predictionAnswer },
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

  const start = (mode: "ar" | "fallback") => {
    setProgress({
      ...makeInitialProgress(selectedLesson),
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
    if (progress.questionIndex === lessonQuestions.length - 1) {
      mutate({ completed: true, completedAt: timestamp(), phase: "complete" });
      return;
    }
    const nextIndex = progress.questionIndex + 1;
    const isStageEnd = !stage.questions.includes(nextIndex);
    mutate({ questionIndex: nextIndex, phase: isStageEnd ? "stageComplete" : "quiz" });
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
      schema: "physgame-anonymous-result-v1",
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
    const chooseLesson = (lessonNumber: number) => {
      setSelectedLesson(lessonNumber);
      setProgress(mergeStoredProgress(localStorage.getItem(progressStorageKey(lessonNumber)), lessonNumber));
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
          <div className="lesson-picker" aria-label="학습 차시 선택">
            {Object.values(LESSONS).map((item: any) => <button key={item.number} className={selectedLesson === item.number ? "active" : ""} onClick={() => chooseLesson(item.number)}><b>{item.number}차시</b><span>{item.title}</span></button>)}
          </div>
          {progress.started && !progress.completed && (
            <div className="resume-card">
              <span>이 기기의 {selectedLesson}차시 진행 기록이 있습니다</span>
              <strong>{stages[progress.stageIndex].name} · {progress.score}점</strong>
              <button className="primary-button" onClick={resume}>이어하기</button>
            </div>
          )}
          {progress.completed && (
            <div className="resume-card complete-resume">
              <span>{selectedLesson}차시 완료 기록</span><strong>{progress.score}/100점</strong><button className="primary-button" onClick={resume}>결과 다시 보기</button>
            </div>
          )}
          {!progress.started && (
            <>
              <div className="privacy-note">
                <span className="privacy-icon">◎</span>
                <div><strong>카메라는 마커 인식에만 사용합니다</strong><p>실명·학번·사진·영상은 저장하거나 서버로 보내지 않습니다. 진행과 점수는 이 기기에만 저장됩니다.</p></div>
              </div>
              <div className="safety-note"><strong>안전</strong><span>카메라를 보며 걷지 않기 · 콘센트 접촉 및 충전기 분해 금지</span></div>
              <button className="primary-button camera-button" onClick={() => start("ar")}><span>카메라로 시작</span><small>{selectedConfig.stages.flatMap((item: any) => item.markers).map((item: any) => item.number).join("·")} 마커를 단계별 인식</small></button>
              <button className="secondary-button" onClick={() => start("fallback")}><span>카메라 없이 시작</span><small>같은 관찰·조작·10문항 진행</small></button>
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
          <div className="formula-row"><span>{lessonConfig.number === 1 ? "P=VI → I²R" : lessonConfig.number === 2 ? "AC → 정류 → 평활 → 스위칭" : "높이고 → 낮추고 → 한쪽으로 → 메우고 → 조절"}</span></div>
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
            <ScienceCanvas visualType={stage.visualType} stageName={stage.name} value={stageValue} reducedMotion={progress.settings.reducedMotion} />
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
