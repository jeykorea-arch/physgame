import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  capacitorOutputVoltage,
  capacitorRippleFraction,
  rectifierCurrents,
  switchingRelativeTransfer,
  transformerSecondaryVoltage,
  transmissionMetrics,
} from "../lib/science-models.js";

test("송전 모형은 같은 1,000 W에서 전압을 10배 높이면 전류 1/10, I²R 손실 1/100이 된다", () => {
  assert.deepEqual(transmissionMetrics(100), { current: 10, lineLoss: 100, lineVoltageDrop: 10 });
  assert.deepEqual(transmissionMetrics(1000), { current: 1, lineLoss: 1, lineVoltageDrop: 1 });
});

test("이상적 변압기 모형은 V₂/V₁=N₂/N₁을 따른다", () => {
  assert.equal(transformerSecondaryVoltage(2200, 1000, 100), 220);
  assert.equal(transformerSecondaryVoltage(2200, 1000, 500), 1100);
});

test("다이오드 정류 모형은 입력 방향이 바뀌어도 출력 전류 방향을 한쪽으로 나타낸다", () => {
  const positive = rectifierCurrents(60);
  const negative = rectifierCurrents(240);
  assert.ok(positive.inputCurrent > 0);
  assert.ok(negative.inputCurrent < 0);
  assert.ok(positive.outputCurrent > 0);
  assert.ok(negative.outputCurrent > 0);
  assert.ok(Math.abs(positive.outputCurrent - negative.outputCurrent) < 1e-12);
});

test("축전기 모형은 C가 클수록 같은 조건의 전압 변화가 작고 부하 전압이 정류 전압보다 낮아지지 않는다", () => {
  const small = capacitorRippleFraction(100);
  const medium = capacitorRippleFraction(500);
  const large = capacitorRippleFraction(1000);
  assert.deepEqual([small, medium, large], [0.5, 0.14, 0.07]);
  assert.ok(small > medium && medium > large);
  for (let phase = 0; phase <= Math.PI * 2; phase += Math.PI / 24) {
    const rectified = Math.abs(Math.cos(phase));
    assert.ok(capacitorOutputVoltage(phase, medium) + 1e-12 >= rectified);
  }
  assert.ok(capacitorOutputVoltage(Math.PI * 0.75, large) > capacitorOutputVoltage(Math.PI * 0.75, small));
});

test("트랜지스터 개념 모형은 켜진 시간 비율을 0~100% 안의 상대 전달량으로 제한한다", () => {
  assert.equal(switchingRelativeTransfer(-20), 0);
  assert.equal(switchingRelativeTransfer(50), 0.5);
  assert.equal(switchingRelativeTransfer(120), 1);
});

test("학생 그래픽에는 회로 연결·측정량·모형 조건이 명시되어 있다", async () => {
  const source = await readFile(new URL("../app/AlphaApp.tsx", import.meta.url), "utf8");
  const config = await readFile(new URL("../lib/lesson-config.js", import.meta.url), "utf8");
  assert.match(source, /터빈의 운동 → 자석과 코일의 상대 운동/);
  assert.match(source, /Math\.round\(8 \* value \/ 1000\)/);
  assert.match(source, /정류 전압과 축전기 출력 전압 비교/);
  assert.match(source, /축전기·부하 전압/);
  assert.match(source, /정류 전압 > 축전기 전압/);
  assert.match(source, /트랜지스터/);
  assert.match(source, /스위치/);
  assert.match(source, /실제 충전기는 코일·변압기·축전기·보호 회로도 함께 사용/);
  assert.match(source, /정상: 양쪽 구간 모두 출력/);
  assert.match(source, /단순화한 전압 모습/);
  assert.match(config, /이상적 다이오드 모형/);
  assert.match(config, /ΔV≈ΔQ\/C/);
  assert.match(config, /실제 충전기의 출력은 이 비율 하나만으로 결정되지 않습니다/);
});
