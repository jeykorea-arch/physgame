import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { decode } from "@msgpack/msgpack";

const appRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("public/data/marker_manifest.json", appRoot), "utf8"));
const metadata = JSON.parse(await readFile(new URL("public/assets/targets.metadata.json", appRoot), "utf8"));
const targetBuffer = await readFile(new URL("public/assets/targets.mind", appRoot));

test("targetIndex 0~5와 여섯 마커 파일 순서·해시가 원본과 일치한다", async () => {
  assert.equal(manifest.markers.length, 6);
  assert.deepEqual(manifest.markers.map((item) => item.targetIndex), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(metadata.sources.map((item) => item.file), manifest.markers.map((item) => item.file));
  for (const source of metadata.sources) {
    const original = await readFile(new URL(`marker-sources/${source.file}`, appRoot));
    assert.equal(createHash("sha256").update(original).digest("hex"), source.sha256);
    assert.deepEqual([source.width, source.height], [1254, 1254]);
  }
});

test("targets.mind에는 6개 타깃이 실제로 포함되어 있다", () => {
  const decoded = decode(targetBuffer);
  assert.equal(decoded.v, 2);
  assert.equal(decoded.dataList.length, 6);
  assert.equal(targetBuffer.byteLength, metadata.output_bytes);
});

test("초기 핵심 자산은 15MB 목표 이하다", async () => {
  const files = [
    "public/assets/targets.mind",
    "public/vendor/aframe-v1.5.0.min.js",
    "public/vendor/mindar-image-aframe.prod.js",
    "public/data/quiz_bank_v1.json",
  ];
  let bytes = 0;
  for (const file of files) bytes += (await stat(new URL(file, appRoot))).size;
  assert.ok(bytes < 15 * 1024 * 1024, `${bytes} bytes`);
});

test("앱은 카메라 프레임 저장·업로드 API를 포함하지 않는다", async () => {
  const source = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  assert.doesNotMatch(source, /toDataURL|MediaRecorder|ImageCapture|FormData|WebSocket|sendBeacon/);
  const fetches = [...source.matchAll(/fetch\(([^)]+)\)/g)].map((match) => match[1]);
  assert.deepEqual(fetches, ["publicAsset(`data/quiz_bank_v1.json?v=${CONTENT_VERSION}`"]);
  assert.match(source, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
});

test("GitHub Pages 하위 경로에서도 모든 런타임 자산을 현재 문서 기준으로 찾는다", async () => {
  const source = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  const serviceWorker = await readFile(new URL("public/sw.js", appRoot), "utf8");
  const manifest = JSON.parse(await readFile(new URL("public/manifest.webmanifest", appRoot), "utf8"));
  assert.match(source, /new URL\(relativePath, document\.baseURI\)/);
  assert.match(source, /data\/quiz_bank_v1\.json\?v=\$\{CONTENT_VERSION\}/);
  assert.doesNotMatch(source, /(?:fetch|loadScript|register)\("\//);
  assert.match(serviceWorker, /self\.registration\.scope/);
  assert.match(serviceWorker, /physgame-three-lessons-v5-live-answer-trace/);
  assert.match(serviceWorker, /fetch\(event\.request\)[\s\S]*cache\.put\(event\.request, copy\)/);
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
});

test("10초 안내와 20초 비AR 강조 타이머가 구현되어 있다", async () => {
  const source = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  assert.match(source, /setTimeout\(\(\) => setScanTip\(1\), 10000\)/);
  assert.match(source, /setTimeout\(\(\) => setScanTip\(2\), 20000\)/);
  assert.match(source, /scanTip >= 2 \|\| cameraError/);
});

test("올바른 마커는 5초 AR 관찰 후에만 다음 화면으로 전환한다", async () => {
  const source = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  assert.match(source, /const AR_PREVIEW_SECONDS = 5/);
  assert.match(source, /AR_PREVIEW_SECONDS \* 1000/);
  assert.match(source, /target\.addEventListener\("targetLost", lost\)/);
  assert.match(source, /마커를 화면 안에 유지하세요/);
  assert.match(source, /params\.get\("qa"\) === "marker-found"/);
  assert.doesNotMatch(source, /setCameraStatus\(`\$\{stages\[index\]\.marker\} 인식 완료`\);\s*return \{ \.\.\.current, phase: "observe" \}/);
});

test("현재 단계가 아닌 마커의 AR 물체는 보이지 않는다", async () => {
  const source = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  assert.match(source, /visible="\$\{activeIndex === 0\}"/);
  assert.match(source, /visible="\$\{activeIndex === 1\}"/);
  assert.match(source, /visible="\$\{activeIndex === 2\}"/);
  assert.match(source, /visible="\$\{activeIndex === 3\}"/);
  assert.match(source, /visible="\$\{activeIndex === 4\}"/);
  assert.match(source, /visible="\$\{activeIndex === 5\}"/);
});

test("교사용 화면은 실명·학번 없이 익명 진행 상태만 실시간 집계한다", async () => {
  const studentSource = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  const teacherSource = await readFile(new URL("app/TeacherDashboard.tsx", appRoot), "utf8");
  const liveSource = await readFile(new URL("app/firebase-live.ts", appRoot), "utf8");
  const rules = JSON.parse(await readFile(new URL("firebase/database.rules.json", appRoot), "utf8"));
  assert.match(studentSource, /physgame-anonymous-result-v2/);
  assert.match(teacherSource, /실시간 익명 집계/);
  assert.match(teacherSource, /닉네임별 진행·점수/);
  assert.match(teacherSource, /학생별 오답 선택 기록/);
  assert.match(teacherSource, /전체 문항·정답 현황/);
  assert.match(teacherSource, /정답자 \{correctStudents\.length\}명/);
  assert.match(teacherSource, /아직 실시간 수업이 열리지 않았습니다/);
  assert.match(studentSource, /6자리 수업 코드/);
  assert.match(studentSource, /joinLiveClass/);
  assert.match(studentSource, /수업용 익명 닉네임/);
  assert.match(studentSource, /submissionChoiceCode/);
  assert.match(teacherSource, /오개념 설명 순서/);
  assert.match(teacherSource, /application\/json/);
  assert.match(liveSource, /classes\/\$\{classCode\}\/students\/\$\{user\.uid\}/);
  assert.match(liveSource, /signInAnonymously/);
  assert.match(liveSource, /LiveQuestionResponse/);
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.match(rules.rules.classes.$classCode.students.$uid[".write"], /auth\.uid === \$uid/);
  assert.match(rules.rules.classes.$classCode.students[".read"], /ownerUid/);
  assert.ok(rules.rules.classes.$classCode.students.$uid.responses);
  assert.doesNotMatch(`${studentSource}\n${teacherSource}\n${liveSource}`, /MediaRecorder|ImageCapture|FormData|sendBeacon|studentName|studentId/);
});

test("작은 화면에서도 과학 그래픽 아래 수치가 캔버스 안에 배치된다", async () => {
  const source = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  const styles = await readFile(new URL("app/globals.css", appRoot), "utf8");
  assert.match(source, /const labelBottom = height - 19/);
  assert.match(source, /ctx\.fillText\(`V₂=\$\{secondaryVoltage\.toFixed\(0\)\} V~`, width \* 0\.62, labelBottom\)/);
  assert.match(styles, /\.science-canvas \{[^}]*height: 270px/s);
  assert.match(styles, /\.science-canvas-rectifier \{ height: 500px; \}/);
  assert.match(styles, /@media \(max-width: 370px\)[\s\S]*\.science-canvas \{ height: 260px; \}/);
});
