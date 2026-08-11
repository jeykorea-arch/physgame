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
  assert.deepEqual(fetches, ['publicAsset("data/quiz_bank_v1.json"']);
  assert.match(source, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
});

test("GitHub Pages 하위 경로에서도 모든 런타임 자산을 현재 문서 기준으로 찾는다", async () => {
  const source = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  const serviceWorker = await readFile(new URL("public/sw.js", appRoot), "utf8");
  const manifest = JSON.parse(await readFile(new URL("public/manifest.webmanifest", appRoot), "utf8"));
  assert.match(source, /new URL\(relativePath, document\.baseURI\)/);
  assert.doesNotMatch(source, /(?:fetch|loadScript|register)\("\//);
  assert.match(serviceWorker, /self\.registration\.scope/);
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
});

test("10초 안내와 20초 비AR 강조 타이머가 구현되어 있다", async () => {
  const source = await readFile(new URL("app/AlphaApp.tsx", appRoot), "utf8");
  assert.match(source, /setTimeout\(\(\) => setScanTip\(1\), 10000\)/);
  assert.match(source, /setTimeout\(\(\) => setScanTip\(2\), 20000\)/);
  assert.match(source, /scanTip >= 2 \|\| cameraError/);
});
