# 전기의 여정 — 1차시 알파

물리학 II 수업에서 25분 이내에 검증할 수 있도록 만든 설치 없는 반응형 WebAR 학습 게임입니다. 01 발전소, 02 고전압 송전, 03 변압기 마커와 `L1-Q01~L1-Q10`을 포함합니다.

## 이 컴퓨터에서 바로 열기

`start-local.cmd`를 더블클릭하면 필요한 프로그램을 확인한 뒤 브라우저에서 `http://localhost:5173`을 엽니다. 실행 중에는 함께 열린 명령 창을 닫지 마세요.

직접 명령을 실행하려면 다음을 사용합니다.

```powershell
cd C:\Users\seo\Desktop\my-think-thank\physgame\web-app
npm.cmd install
npm.cmd run dev:pages
```

## GitHub Pages 배포

이 저장소의 `main` 브랜치에 변경 사항을 올리면 `.github/workflows/deploy-pages.yml`이 다음 작업을 자동으로 수행합니다.

1. 수업 로직과 AR 자산 검증
2. GitHub Pages 하위 주소에 맞는 정적 앱 빌드
3. HTTPS GitHub Pages 배포

배포에는 API 키가 필요하지 않습니다. 저장소를 처음 만든 뒤 GitHub의 **Settings → Pages → Build and deployment → Source**가 **GitHub Actions**로 설정되어 있어야 합니다.

## 검증 명령

- `npm.cmd run compile:targets`: 원본 6개 마커의 순서와 해시를 검증하고 `targets.mind`를 다시 만듭니다.
- `npm.cmd test`: 정답·오답·재시도·안내·배점, 진행 복원, AR/비AR 일치, 마커 순서와 개인정보 규칙을 검사합니다.
- `npm.cmd run build:pages`: GitHub Pages용 정적 사이트를 `pages-dist`에 만듭니다.
- `npm.cmd run build`: 기존 Sites/Vinext 운영 빌드를 만듭니다.

## 환경변수와 개인정보

현재 앱에는 API 키가 필요하지 않습니다. 향후 비밀값이 필요하면 `.env.example`의 변수 이름을 참고하여 Git에 포함되지 않는 `.env.local`에 값을 넣으세요. `VITE_` 접두사 변수는 브라우저 번들에 공개되므로 비밀 키를 넣으면 안 됩니다. GitHub 배포용 비밀값은 저장소의 Actions secrets에 별도로 등록해야 합니다.

카메라는 MindAR 마커 인식에만 사용됩니다. 프레임·사진·영상은 저장하거나 전송하지 않습니다. 문항 진행과 점수는 해당 브라우저의 `localStorage`에만 저장됩니다.
