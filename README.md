# 전기의 여정 — 3차시 AR 학습 게임

물리학 II 수업용 설치 없는 반응형 WebAR 학습 게임입니다. 여섯 마커와 `L1-Q01~L3-Q30`, 동일 내용의 비AR 모드, 교사용 진행 화면을 포함합니다.

공개 수업 주소: https://jeykorea-arch.github.io/physgame/

- 학생: 위 주소에서 1·2·3차시를 선택하거나 `?lesson=1`, `?lesson=2`, `?lesson=3`으로 바로 접속
- 교사: https://jeykorea-arch.github.io/physgame/?teacher=1

## 이 컴퓨터에서 실행

`start-local.cmd`를 더블클릭하거나 다음 명령을 실행합니다.

```powershell
cd C:\Users\seo\Desktop\my-think-thank\physgame\web-app
npm.cmd install
npm.cmd run dev:pages
```

브라우저에서 `http://localhost:5173`을 엽니다. 실제 스마트폰 카메라는 HTTPS인 공개 수업 주소에서 시험하세요.

## 구현 범위

- 1차시: 발전·고전압 송전·변압, L1-Q01~L1-Q10
- 2차시: 다이오드 정류·축전기 평활·트랜지스터 스위칭, L2-Q11~L2-Q20
- 3차시: 여섯 마커를 재활용한 고장 진단·계통 개념·전체 여정, L3-Q21~L3-Q30
- 관찰 → 예측 → 조작 → 퀴즈 → 피드백, 첫 시도 10점·재시도 7점·안내 완료 5점
- 차시별 `localStorage` 진행 복원, AR/비AR 동일 문항·정답·피드백
- 교사용 화면: 차시 QR, 45분 타이머, 수동 현황, 투사용 안내, 익명 결과 JSON 가져오기, 문항 통계 CSV/JSON 내보내기

## 교사용 집계의 한계

GitHub Pages는 정적 호스팅이라 학생 여러 기기의 진행을 자동 실시간 집계하거나 원격 제어하지 않습니다. 학생 결과 화면에서 내려받은 익명 JSON을 교사용 화면으로 가져오면 문항별 정확도와 오류 수를 계산합니다. 실시간 자동 집계가 필요하면 별도의 학교 승인 백엔드가 필요합니다.

## 검증 명령

- `npm.cmd run compile:targets`: 원본 6개 마커 순서와 해시 검증 후 `targets.mind` 재생성
- `npm.cmd test`: 30문항 정답·오답·재시도·배점·진행 복원·AR/비AR 일치·개인정보 규칙 검사
- `npm.cmd run lint`: 소스 정적 검사
- `npm.cmd run build:pages`: GitHub Pages 정적 빌드

## 환경변수와 개인정보

현재 앱에는 API 키가 필요하지 않습니다. 향후 비밀값은 Git에 포함되지 않는 `.env.local`에 저장하고, GitHub 배포 비밀값은 Actions secrets에 등록하세요. `VITE_` 접두사 값은 브라우저에 공개되므로 비밀 키를 넣으면 안 됩니다.

카메라는 MindAR 마커 인식에만 사용됩니다. 실명·학번·프레임·사진·영상은 저장하거나 전송하지 않습니다. 진행과 점수는 브라우저에만 저장되며, 교사용 결과 파일에도 실명·학번이 포함되지 않습니다.
