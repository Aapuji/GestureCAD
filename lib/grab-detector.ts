// grabDetector.ts
// Right-hand grab / release detection from MediaPipe world landmarks.
// Grab only: no position or rotation yet. No dependencies.
//
// How it decides:
//  1. For each of the 4 fingers, measure how bent it is (sum of the three joint
//     bend angles, in degrees) and how far the fingertip is tucked toward the palm.
//  2. Take the median over the 4 fingers, so one badly tracked finger can't flip the result.
//  3. Convert both numbers to 0..1 using YOUR open-hand and closed-hand values (calibration),
//     average them into one `curl`, smooth it over time, then apply hysteresis + a
//     short confirmation delay so it doesn't flicker.

export interface Vec3 { x: number; y: number; z: number }

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const angleBetween = (a: Vec3, b: Vec3) =>
  Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- picking the right hand ----------

// MediaPipe's handedness label for the hand we track, used as-is (no mirroring or swapping).
export const RIGHT_HAND_LABEL = 'Right';

/** The parts of a HandLandmarker / GestureRecognizer result that we use. */
export interface HandsResultLike {
  worldLandmarks: Vec3[][];
  handedness?: { categoryName: string; score: number }[][];
  handednesses?: { categoryName: string; score: number }[][]; // older tasks-vision versions
}

export interface RightHand {
  world: Vec3[];  // 21 metric landmarks
  score: number;  // handedness confidence
  index: number;  // position in the result arrays (e.g. for result.gestures[index])
}

export function pickRightHand(result: HandsResultLike): RightHand | null {
  const handedness = result.handedness ?? result.handednesses ?? [];
  let best: RightHand | null = null;
  for (let i = 0; i < result.worldLandmarks.length; i++) {
    const cat = handedness[i]?.[0];
    if (!cat || cat.categoryName !== RIGHT_HAND_LABEL) continue;
    if (!best || cat.score > best.score) {
      best = { world: result.worldLandmarks[i], score: cat.score, index: i };
    }
  }
  return best;
}

// ---------- features ----------

export interface Features {
  bend: number;  // degrees, median finger: total bend over the 3 joints (0 = straight)
  tuck: number;  // median fingertip-to-palm-centre distance / hand size (smaller = more closed)
}

const FINGERS = [
  [5, 6, 7, 8],      // index:  MCP, PIP, DIP, TIP
  [9, 10, 11, 12],   // middle
  [13, 14, 15, 16],  // ring
  [17, 18, 19, 20],  // pinky
] as const;
const PALM = [0, 5, 9, 13, 17];

export function extractFeatures(w: Vec3[]): Features {
  // Palm centre and hand size.
  let cx = 0, cy = 0, cz = 0;
  for (const i of PALM) { cx += w[i].x; cy += w[i].y; cz += w[i].z; }
  const palm: Vec3 = { x: cx / PALM.length, y: cy / PALM.length, z: cz / PALM.length };
  const size = len(sub(w[9], w[0])) || 1; // wrist -> middle knuckle

  const bends: number[] = [];
  const tucks: number[] = [];
  for (const [mcp, pip, dip, tip] of FINGERS) {
    const metacarpal = sub(w[mcp], w[0]);
    const proximal = sub(w[pip], w[mcp]);
    const middle = sub(w[dip], w[pip]);
    const distal = sub(w[tip], w[dip]);
    const bend =
      angleBetween(metacarpal, proximal) +
      angleBetween(proximal, middle) +
      angleBetween(middle, distal);
    bends.push((bend * 180) / Math.PI);
    tucks.push(len(sub(w[tip], palm)) / size);
  }
  return { bend: median(bends), tuck: median(tucks) };
}

// ---------- calibration ----------

export interface Calibration { open: Features; closed: Features }

// Rough guesses for an average hand. Run the calibration on the test page for real values.
export const DEFAULT_CALIBRATION: Calibration = {
  open: { bend: 20, tuck: 1.05 },
  closed: { bend: 240, tuck: 0.4 },
};

const frac = (v: number, from: number, to: number) => clamp01((v - from) / (to - from));

/** 0 = fully open, 1 = fully closed (as measured in the calibration). */
export function curlOf(f: Features, c: Calibration): number {
  return (frac(f.bend, c.open.bend, c.closed.bend) + frac(f.tuck, c.open.tuck, c.closed.tuck)) / 2;
}

/** Build a calibration from samples collected while holding an open hand, then a fist. */
export function buildCalibration(
  open: Features[],
  closed: Features[],
): Calibration | { error: string } {
  if (open.length < 10 || closed.length < 10) {
    return { error: 'not enough frames with the right hand visible' };
  }
  const med = (fs: Features[]): Features => ({
    bend: median(fs.map((f) => f.bend)),
    tuck: median(fs.map((f) => f.tuck)),
  });
  const o = med(open), c = med(closed);
  if (c.bend - o.bend < 60 || o.tuck - c.tuck < 0.2) {
    return {
      error:
        `open and fist look too similar (open: bend ${o.bend.toFixed(0)}°, tuck ${o.tuck.toFixed(2)}; ` +
        `fist: bend ${c.bend.toFixed(0)}°, tuck ${c.tuck.toFixed(2)})`,
    };
  }
  return { open: o, closed: c };
}

// ---------- detector ----------

export interface GrabOptions {
  calibration: Calibration;
  grabOn: number;           // curl at/above which a grab can start (0..1)
  grabOff: number;          // curl at/below which a grab can end (keep < grabOn)
  grabConfirmMs: number;    // grab condition must hold this long
  releaseConfirmMs: number; // release condition must hold this long (a bit longer: dropping is worse)
  smoothingTauMs: number;   // time constant for smoothing curl
  lostTimeoutMs: number;    // hand missing this long -> reset (and release if grabbing)
}

export const DEFAULT_GRAB_OPTIONS: GrabOptions = {
  calibration: DEFAULT_CALIBRATION,
  grabOn: 0.4,
  grabOff: 0.22,
  grabConfirmMs: 50,
  releaseConfirmMs: 80,
  smoothingTauMs: 30,
  lostTimeoutMs: 250,
};

export interface GrabState {
  present: boolean;      // right hand detected this frame
  grabbing: boolean;
  justGrabbed: boolean;  // true for exactly one update
  justReleased: boolean; // true for exactly one update
  curl: number;          // 0 open .. 1 closed, calibrated and smoothed
  features: Features;    // raw numbers from the latest detected frame (for debugging/calibration)
}

export class GrabDetector {
  private o: GrabOptions;
  private curl = 0;
  private features: Features = { ...DEFAULT_CALIBRATION.open };
  private lastSeen: number | null = null;
  private grabbing = false;
  private pendingSince: number | null = null;

  constructor(opts: Partial<GrabOptions> = {}) {
    this.o = { ...DEFAULT_GRAB_OPTIONS, ...opts };
  }

  setCalibration(calibration: Calibration) {
    this.o = { ...this.o, calibration };
  }

  /** Change the grab / release thresholds on the fly (keep grabOff below grabOn). */
  setThresholds(grabOn: number, grabOff: number) {
    this.o = { ...this.o, grabOn, grabOff };
  }

  /** Call once per video frame with the right hand (or null) and the frame timestamp in ms. */
  update(hand: RightHand | null, t: number): GrabState {
    const o = this.o;

    if (!hand) {
      // Tolerate brief dropouts; give up after lostTimeoutMs.
      if (this.lastSeen !== null && t - this.lastSeen > o.lostTimeoutMs) {
        const wasGrabbing = this.grabbing;
        this.reset();
        return this.state(false, false, wasGrabbing);
      }
      return this.state(false, false, false);
    }

    this.features = extractFeatures(hand.world);
    const raw = curlOf(this.features, o.calibration);
    const a = this.lastSeen === null ? 1 : 1 - Math.exp(-Math.max(0, t - this.lastSeen) / o.smoothingTauMs);
    this.curl += (raw - this.curl) * a;
    this.lastSeen = t;

    // Hysteresis: the threshold depends on the current state.
    const want = this.grabbing ? this.curl > o.grabOff : this.curl >= o.grabOn;
    let justGrabbed = false, justReleased = false;
    if (want === this.grabbing) {
      this.pendingSince = null;
    } else {
      if (this.pendingSince === null) this.pendingSince = t;
      const needMs = want ? o.grabConfirmMs : o.releaseConfirmMs;
      if (t - this.pendingSince >= needMs) {
        this.grabbing = want;
        this.pendingSince = null;
        justGrabbed = want;
        justReleased = !want;
      }
    }
    return this.state(true, justGrabbed, justReleased);
  }

  private reset() {
    this.curl = 0;
    this.grabbing = false;
    this.pendingSince = null;
    this.lastSeen = null;
  }

  private state(present: boolean, justGrabbed: boolean, justReleased: boolean): GrabState {
    return {
      present,
      grabbing: this.grabbing,
      justGrabbed,
      justReleased,
      curl: this.curl,
      features: this.features,
    };
  }
}
