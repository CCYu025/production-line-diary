/*
 * 控制室鏡頭的純數學（docs/os-mode-spec.md §4.3、§5.2–5.3、§5.6；X2）：不依賴 three，HubCanvas 的 Rig 每幀呼叫。
 *  - 休息位置：整面螢幕牆在目前畫面長寬比內都看得到（layout.fitRestCamera）。
 *  - 進入推近／離開拉遠：終點是「選中的那台螢幕」前方（layout.dollyTarget），不是畫面中央。
 *  - 選取偏航（≤ 3°、不位移）：easeToward 趨近，不擋輸入；減少動態效果時直接套用。
 *  - 待機巡視：慢速左右偏航，進入時淡入、輸入時快速收回。
 */
import { ENTER, EXIT } from "../transition/timing";
import { CAMERA_FOV, dollyTarget, easeToward, fitRestCamera, poseForChannel, selectYawDeg, type HudInsets, type Vec3 } from "./layout";
import type { ChannelId } from "../channels";
import { channelIndex } from "../channels";

export type HubMode = "hub" | "entering" | "exiting" | "station";

export { CAMERA_FOV };
/** 休息位置的長寬比下限（太窄的視窗不再往後退） */
export const MIN_REST_ASPECT = 1.2;

export const PATROL_YAW_MAX_DEG = 24;
export const PATROL_PERIOD_S = 40;
/** 巡視淡入（毫秒）與輸入後收回（毫秒） */
export const PATROL_FADE_IN_MS = 1500;
export const PATROL_RETURN_MS = 150;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** 0＝控制室原位，1＝推到選中螢幕前 */
export function cameraProgress(mode: HubMode, elapsedMs: number): number {
  switch (mode) {
    case "hub":
      return 0;
    case "entering":
      return ease(clamp01(elapsedMs / ENTER.E1[1]));
    case "station":
      return 1;
    case "exiting":
      return elapsedMs < EXIT.X4[0] ? 1 : 1 - ease(clamp01((elapsedMs - EXIT.X4[0]) / (EXIT.X4[1] - EXIT.X4[0])));
  }
}

export interface CameraPose {
  position: Vec3;
  lookAt: Vec3;
}

const restCache = new Map<string, CameraPose>();
/** 休息位置（依長寬比與 HUD 占的比例；解算一次後快取，Rig 每幀呼叫）。hud（H0）＝上方狀態列與下方控制台占的畫面比例。 */
export function restPose(aspect: number, hud?: HudInsets): CameraPose {
  const a = Math.round(Math.max(MIN_REST_ASPECT, aspect) * 1000) / 1000;
  const key = hud ? `${a}|${hud.top}|${hud.bottom}` : String(a);
  let p = restCache.get(key);
  if (!p) {
    p = fitRestCamera(CAMERA_FOV, a, { hud });
    restCache.set(key, p);
  }
  return p;
}

export function dollyPose(ch: ChannelId): CameraPose {
  return dollyTarget(poseForChannel(ch));
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

/** 進度 p（0＝休息位置、1＝選中螢幕前）的鏡頭位置與看向點。 */
export function poseAt(aspect: number, ch: ChannelId, p: number, hud?: HudInsets): CameraPose {
  const a = restPose(aspect, hud);
  const b = dollyPose(ch);
  return { position: lerpVec(a.position, b.position, p), lookAt: lerpVec(a.lookAt, b.lookAt, p) };
}

/** 巡視偏航（度）：原始波形，±PATROL_YAW_MAX_DEG，週期 PATROL_PERIOD_S。 */
export function patrolYawDeg(tSec: number): number {
  return PATROL_YAW_MAX_DEG * Math.sin((tSec * Math.PI * 2) / PATROL_PERIOD_S);
}

export interface RigState {
  /** 目前選取偏航（度） */
  selectYaw: number;
  /** 巡視權重 0..1 */
  patrolW: number;
}

export interface RigInput {
  channel: ChannelId;
  mode: HubMode;
  patrolling: boolean;
  reduced: boolean;
  dtMs: number;
  tSec: number;
}

/**
 * 前進一幀：回傳新的狀態與合成後的偏航（度，正＝往右）。
 *  - 減少動態效果：選取偏航直接到位（不緩動）、沒有巡視。
 *  - 巡視只在 hub 且 patrolling；沒有 patrolling 時 PATROL_RETURN_MS 內收回（輸入後立刻開始收，不擋任何輸入）。
 *  - 偏航乘上 (1 - progress)：進入推近時漸漸交給「看向選中螢幕」，離開拉遠時再漸漸出現，不跳。
 */
export function stepRig(state: RigState, input: RigInput, progress: number): { state: RigState; yawDeg: number } {
  const target = selectYawDeg(channelIndex(input.channel));
  const selectYaw = input.reduced ? target : easeToward(state.selectYaw, target, input.dtMs);
  const wantPatrol = input.patrolling && !input.reduced && input.mode === "hub";
  const patrolW = wantPatrol
    ? easeToward(state.patrolW, 1, input.dtMs, PATROL_FADE_IN_MS)
    : input.reduced
      ? 0
      : easeToward(state.patrolW, 0, input.dtMs, PATROL_RETURN_MS);
  const yawDeg = (selectYaw + patrolW * patrolYawDeg(input.tSec)) * (1 - progress);
  return { state: { selectYaw, patrolW }, yawDeg };
}
