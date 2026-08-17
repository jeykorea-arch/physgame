const marker = (number, name, targetIndex) => ({ number, name, label: `${number} ${name}`, targetIndex });

export const LESSONS = {
  1: {
    number: 1,
    title: "멀리 보내는 전기",
    story: "발전소에서 시작한 전기를 손실 적게 도시의 220 V 교류로 전달합니다.",
    outcome: "같은 전력을 보낼 때 전압을 높이면 전류가 줄고, 송전선의 I²R 손실은 전류의 제곱에 따라 더 크게 줄어든다.",
    teacherTopics: ["전력과 에너지", "P=VI와 I²R 손실", "변압기 권수비", "교류와 자기 선속"],
    stages: [
      {
        number: "01", name: "발전소 기동", markers: [marker("01", "발전소", 0)], questions: [0, 1], visualType: "generator",
        observeTitle: "운동이 전기로 전달되는 경로",
        observeText: "터빈의 역학적 에너지가 회전자를 움직이고, 변화하는 자기 선속이 유도 기전력을 만듭니다. 발전기는 에너지를 새로 만들지 않습니다.",
        prediction: "터빈과 회전자가 멈추면 지속적인 유도 기전력은 어떻게 될까요?",
        predictionOptions: ["사라진다", "그대로 유지된다", "무한히 커진다"], predictionAnswer: "사라진다",
        sliderLabel: "터빈 회전 속도", sliderMin: 0, sliderMax: 100, sliderStep: 10, sliderDefault: 50, sliderUnit: "%",
        manipulationNote: "회전 속도가 0이면 자기 선속의 변화율과 유도 전압도 0이 됩니다.",
      },
      {
        number: "02", name: "송전망 최적화", markers: [marker("02", "고전압 송전", 1)], questions: [2, 3, 4, 5], visualType: "transmission",
        observeTitle: "같은 전력, 다른 전압과 손실",
        observeText: "전력 P=VI가 일정하면 전압 V를 높일수록 전류 I가 줄고, 송전선 열 손실 I²R은 더 크게 줄어듭니다.",
        prediction: "같은 전력을 보낼 때 송전 전압을 높이면 전류는 어떻게 될까요?",
        predictionOptions: ["줄어든다", "늘어난다", "변하지 않는다"], predictionAnswer: "줄어든다",
        sliderLabel: "송전 전압", sliderMin: 100, sliderMax: 1000, sliderStep: 100, sliderDefault: 500, sliderUnit: " V",
        manipulationNote: "시뮬레이션 조건: 전달 전력 1,000 W, 송전선 저항 1 Ω.",
      },
      {
        number: "03", name: "배전 변압", markers: [marker("03", "변압기", 2)], questions: [6, 7, 8, 9], visualType: "transformer",
        observeTitle: "권수비로 바꾸는 교류 전압",
        observeText: "이상적 변압기에서 V₂/V₁=N₂/N₁입니다. 변화하는 자기 선속이 두 코일을 연결하며, 일정한 직류는 지속적인 변압을 만들지 못합니다.",
        prediction: "1차 조건이 같을 때 2차 코일의 권수를 줄이면 2차 전압은 어떻게 될까요?",
        predictionOptions: ["낮아진다", "높아진다", "변하지 않는다"], predictionAnswer: "낮아진다",
        sliderLabel: "2차 코일 권수 N₂", sliderMin: 50, sliderMax: 500, sliderStep: 50, sliderDefault: 100, sliderUnit: "회",
        manipulationNote: "시뮬레이션 조건: 이상적 변압기, V₁=2,200 V, N₁=1,000회.",
      },
    ],
  },
  2: {
    number: 2,
    title: "콘센트에서 충전기로",
    story: "가정에 도착한 교류를 스마트폰이 사용할 수 있는 한 방향의 전류로 바꿉니다.",
    outcome: "다이오드는 전류 방향을 한쪽으로 만들고, 축전기는 출력 전압의 출렁임을 줄이며, 트랜지스터는 전류의 흐름을 조절한다.",
    teacherTopics: ["교류의 방향이 바뀔 때 전류가 흐르는 두 길", "한 방향이지만 크기가 변하는 전류", "축전기의 충전·방전과 출력 전압 변화", "트랜지스터의 전류 조절"],
    stages: [
      {
        number: "04", name: "다이오드 정류", markers: [marker("04", "다이오드 정류", 3)], questions: [0, 1, 2, 3, 4], visualType: "rectifier",
        observeTitle: "교류의 방향이 바뀔 때 전류가 흐르는 두 길",
        observeText: "교류 입력은 한 주기 동안 방향이 두 번 바뀝니다. 네 개의 다이오드 회로에서는 입력 A 또는 B에서 시작해 서로 다른 두 다이오드를 지나지만, 전류계와 부하에서는 전류가 항상 같은 방향으로 흐릅니다.",
        prediction: "입력 전류가 +방향인 순간 전류가 지나는 다이오드는 무엇일까요?",
        predictionOptions: ["D1과 D4", "D2와 D3", "D1과 D2"], predictionAnswer: "D1과 D4",
        sliderLabel: "교류 한 주기 속 현재 각도 θ", sliderMin: 0, sliderMax: 360, sliderStep: 30, sliderDefault: 60, sliderUnit: "°",
        manipulationNote: "θ(위상각)는 교류 한 주기 0°~360°에서 현재 순간의 위치입니다. θ를 옮겨 입력 A/B 중 어디에서 시작하고 어느 다이오드와 전류계를 지나는지 따라가 보세요. 부하의 출력 전류 방향은 항상 위에서 아래로 같습니다.",
      },
      {
        number: "05", name: "축전기의 충전과 방전", markers: [marker("05", "축전기의 충전과 방전", 4)], questions: [5, 6], visualType: "smoothing",
        observeTitle: "출력 전압의 출렁임 줄이기",
        observeText: "축전기는 입력 전압이 클 때 전하를 저장하고 입력 전압이 작아질 때 저장한 전하를 회로에 내보냅니다. 그 결과 출력 전압의 출렁임이 줄지만 완전히 사라지지는 않습니다.",
        prediction: "다른 조건이 같을 때 축전기의 전기 용량을 작게 만들면 출력 전압의 출렁임은 어떻게 될까요?",
        predictionOptions: ["커진다", "작아진다", "항상 0이다"], predictionAnswer: "커진다",
        sliderLabel: "축전기의 전기 용량 C", sliderMin: 100, sliderMax: 1000, sliderStep: 100, sliderDefault: 500, sliderUnit: " μF",
        manipulationNote: "같은 조건에서 전기 용량이 클수록 저장할 수 있는 전하가 많아 출력 전압의 변화가 작아집니다.",
      },
      {
        number: "06", name: "트랜지스터의 전류 조절", markers: [marker("06", "트랜지스터의 전류 조절", 5)], questions: [7, 8, 9], visualType: "switching",
        observeTitle: "전류를 빠르게 켜고 끄며 조절하기",
        observeText: "트랜지스터는 외부 전원에서 오는 전류를 빠르게 켰다 껐다 하여 전류가 흐르는 시간과 전달되는 에너지의 양을 조절합니다.",
        prediction: "전류를 빠르게 켜고 끄는 방식이 발열 손실을 줄일 수 있는 까닭은 무엇일까요?",
        predictionOptions: ["큰 전압과 큰 전류가 동시에 걸리는 시간을 줄인다", "에너지를 새로 만든다", "모든 저항을 0으로 만든다"], predictionAnswer: "큰 전압과 큰 전류가 동시에 걸리는 시간을 줄인다",
        sliderLabel: "전류가 흐르는 시간의 비율", sliderMin: 10, sliderMax: 90, sliderStep: 10, sliderDefault: 50, sliderUnit: "%",
        manipulationNote: "한 주기 중 트랜지스터가 켜져 전류가 흐르는 시간의 비율을 바꾸면 전달되는 에너지의 양도 달라집니다.",
      },
    ],
  },
  3: {
    number: 3,
    title: "고장 난 충전망을 진단하라",
    story: "복구된 시스템의 결함 로그와 파형을 분석해 발전소부터 배터리까지의 경로를 완성합니다.",
    outcome: "전력망에서는 전압을 높이고 낮추며, 충전기에서는 전류 방향을 한쪽으로 만들고 출력 전압의 낮아지는 부분을 메운 뒤 전류를 조절한다.",
    teacherTopics: ["고장별 파형 변화", "V²/R에서 V의 대상", "전력망과 충전기 내부 변압 구분", "최종 개념 지도"],
    stages: [
      {
        number: "A", name: "부품 고장 수사", markers: [marker("04", "다이오드 정류", 3), marker("05", "축전기의 충전과 방전", 4), marker("06", "트랜지스터의 전류 조절", 5)], questions: [0, 1, 2], visualType: "faults",
        observeTitle: "고장 부품이 남기는 파형 단서",
        observeText: "다이오드 하나가 끊어지면 입력의 일부 구간에서 전류가 흐르지 않고, 축전기를 빼면 출력 전압의 변화가 커집니다. 트랜지스터가 계속 켜진 상태로 고정되면 전류 조절과 보호가 어려워집니다.",
        prediction: "축전기가 회로에서 빠지면 가장 먼저 커지는 것은 무엇일까요?",
        predictionOptions: ["출력 전압의 변화", "축전기 용량", "송전 전압"], predictionAnswer: "출력 전압의 변화",
        sliderLabel: "결함 로그", sliderMin: 1, sliderMax: 3, sliderStep: 1, sliderDefault: 1, sliderUnit: "번",
        manipulationNote: "1 다이오드 하나가 끊어진 경우 · 2 축전기를 뺀 경우 · 3 트랜지스터가 계속 켜진 경우의 출력과 위험을 비교합니다.",
      },
      {
        number: "B", name: "계통 개념 함정", markers: [marker("02", "고전압 송전", 1), marker("03", "변압기", 2)], questions: [3, 4, 5], visualType: "gridDiagnosis",
        observeTitle: "송전 전압과 선로 전압 강하 구분",
        observeText: "P=V²/R의 V는 해당 저항 양단의 전압입니다. 발전소의 송전 전압과 송전선 저항에서 생기는 전압 강하를 같은 V로 두면 잘못된 결론이 나옵니다.",
        prediction: "같은 전력을 보내며 송전 전압을 낮추면 선로 전류와 I²R 손실은 어떻게 될까요?",
        predictionOptions: ["둘 다 증가한다", "둘 다 감소한다", "변하지 않는다"], predictionAnswer: "둘 다 증가한다",
        sliderLabel: "송전 전압", sliderMin: 100, sliderMax: 1000, sliderStep: 100, sliderDefault: 500, sliderUnit: " V",
        manipulationNote: "전달 전력 1,000 W, 선로 저항 1 Ω 조건입니다. 송전원 전압과 선로의 전압 강하를 구분하세요.",
      },
      {
        number: "C", name: "전체 여정 복원", markers: [marker("01", "발전소", 0), marker("06", "트랜지스터의 전류 조절", 5)], questions: [6, 7, 8, 9], visualType: "journey",
        observeTitle: "높이고·낮추고·한쪽으로·메우고·조절하기",
        observeText: "전력망의 변압과 충전기 안의 전류 변화는 위치와 역할이 다릅니다. 전류의 방향과 출력 전압의 변화 크기를 기준으로 전체 여정을 연결합니다.",
        prediction: "다이오드를 지난 직후와 축전기를 지난 뒤를 구분하는 가장 직접적인 그래프 단서는 무엇일까요?",
        predictionOptions: ["출력 전압 변화의 크기", "송전탑의 높이", "발전기 회전자 수"], predictionAnswer: "출력 전압 변화의 크기",
        sliderLabel: "에너지 여정 단계", sliderMin: 1, sliderMax: 5, sliderStep: 1, sliderDefault: 1, sliderUnit: "/5",
        manipulationNote: "1 발전 · 2 고전압 송전과 전압 낮추기 · 3 한 방향 전류 만들기 · 4 출력 변화 줄이기 · 5 전류 조절을 연결합니다.",
      },
    ],
  },
};

export function getLessonConfig(number) {
  return LESSONS[number] ?? LESSONS[1];
}

export function getDefaultSliders(lessonNumber) {
  return Object.fromEntries(getLessonConfig(lessonNumber).stages.map((stage, index) => [index, stage.sliderDefault]));
}
