import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import {
  get,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
  type Unsubscribe,
} from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.databaseURL,
  firebaseConfig.projectId,
  firebaseConfig.appId,
];

export const liveClassConfigured = requiredConfig.every((value) => typeof value === "string" && value.length > 0);

export type LiveStudent = {
  uid: string;
  alias: string;
  connected: boolean;
  lesson: number;
  stageIndex: number;
  phase: string;
  questionIndex: number;
  completedCount: number;
  score: number;
  mode: "ar" | "non-ar";
  responses?: Record<string, LiveQuestionResponse>;
  lastSeen: number;
};

export type LiveSubmission = {
  correct: boolean;
  choiceCode: string;
};

export type LiveQuestionResponse = {
  attempts: number;
  completed: boolean;
  score: number;
  guided: boolean;
  hadError: boolean;
  submissions?: LiveSubmission[] | Record<string, LiveSubmission>;
};

export type StudentLiveState = Omit<LiveStudent, "uid" | "alias" | "lastSeen" | "connected">;

let authPromise: Promise<User> | null = null;

function services() {
  if (!liveClassConfigured) throw new Error("실시간 수업 환경변수가 설정되지 않았습니다.");
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return { auth: getAuth(app), database: getDatabase(app) };
}

async function anonymousUser() {
  if (authPromise) return authPromise;
  authPromise = new Promise<User>((resolve, reject) => {
    const { auth } = services();
    let finished = false;
    const stop = onAuthStateChanged(auth, async (user) => {
      if (finished) return;
      if (user) {
        finished = true;
        stop();
        resolve(user);
        return;
      }
      try {
        const credential = await signInAnonymously(auth);
        finished = true;
        stop();
        resolve(credential.user);
      } catch (error) {
        finished = true;
        stop();
        authPromise = null;
        reject(new Error(friendlyFirebaseError(error)));
      }
    });
  });
  return authPromise;
}

function normalizeClassCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeClassCode() {
  const values = crypto.getRandomValues(new Uint8Array(6));
  return [...values].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

function friendlyFirebaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission|PERMISSION_DENIED/i.test(message)) return "수업이 종료되었거나 수업 코드가 올바르지 않습니다.";
  if (/network|offline|unavailable/i.test(message)) return "인터넷 연결을 확인해 주세요.";
  return "실시간 수업 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

export async function joinStudentClass(classCodeInput: string, lesson: number, nicknameInput: string, initial: StudentLiveState) {
  const classCode = normalizeClassCode(classCodeInput);
  if (classCode.length !== 6) throw new Error("수업 코드가 올바르지 않습니다.");
  const user = await anonymousUser();
  const { database } = services();
  const publicRef = ref(database, `classes/${classCode}/public`);
  const publicSnapshot = await get(publicRef);
  const classInfo = publicSnapshot.val();
  if (!classInfo?.active) throw new Error("수업이 종료되었거나 수업 코드가 올바르지 않습니다.");
  if (Number(classInfo.lesson) !== lesson) throw new Error(`이 수업은 현재 ${classInfo.lesson}차시로 열려 있습니다.`);

  const studentRef = ref(database, `classes/${classCode}/students/${user.uid}`);
  const alias = nicknameInput.trim().replace(/\s+/g, " ").slice(0, 12);
  if (alias.length < 2) throw new Error("2~12자의 수업용 익명 닉네임을 입력해 주세요.");
  const payload = { ...initial, alias, connected: true, lastSeen: serverTimestamp() };
  await set(studentRef, payload);
  const disconnectAction = onDisconnect(studentRef);
  await disconnectAction.update({ connected: false, lastSeen: serverTimestamp() });

  let latest = initial;
  const heartbeat = window.setInterval(() => {
    update(studentRef, { connected: true, lastSeen: serverTimestamp() }).catch(() => undefined);
  }, 30000);

  return {
    classCode,
    alias,
    update: async (next: StudentLiveState) => {
      latest = next;
      try {
        await update(studentRef, { ...latest, connected: true, lastSeen: serverTimestamp() });
      } catch (error) {
        throw new Error(friendlyFirebaseError(error));
      }
    },
    leave: async () => {
      window.clearInterval(heartbeat);
      await disconnectAction.cancel().catch(() => undefined);
      await update(studentRef, { connected: false, lastSeen: serverTimestamp() }).catch(() => undefined);
    },
  };
}

export type StudentClassHandle = Awaited<ReturnType<typeof joinStudentClass>>;

export async function openTeacherClass(
  lesson: number,
  onStudents: (students: LiveStudent[]) => void,
  onError: (message: string) => void,
  preferredCode = "",
) {
  const user = await anonymousUser();
  const { database } = services();
  let classCode = normalizeClassCode(preferredCode);

  if (classCode) {
    try {
      await update(ref(database, `classes/${classCode}/public`), { lesson, active: true });
    } catch {
      classCode = "";
    }
  }

  if (!classCode) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = makeClassCode();
      try {
        await set(ref(database, `classes/${candidate}`), {
          ownerUid: user.uid,
          public: { lesson, active: true, createdAt: serverTimestamp() },
        });
        classCode = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!classCode) throw new Error(friendlyFirebaseError(lastError));
  }

  const studentsRef = ref(database, `classes/${classCode}/students`);
  const unsubscribe: Unsubscribe = onValue(
    studentsRef,
    (snapshot) => {
      const values = snapshot.val() ?? {};
      const students = Object.entries(values).map(([uid, value]) => ({ uid, ...(value as Omit<LiveStudent, "uid">) }));
      onStudents(students);
    },
    (error) => onError(friendlyFirebaseError(error)),
  );

  return {
    classCode,
    setLesson: async (nextLesson: number) => {
      await update(ref(database, `classes/${classCode}/public`), { lesson: nextLesson });
    },
    close: async () => {
      unsubscribe();
      await update(ref(database, `classes/${classCode}/public`), { active: false });
    },
    detach: () => unsubscribe(),
  };
}

export type TeacherClassHandle = Awaited<ReturnType<typeof openTeacherClass>>;
