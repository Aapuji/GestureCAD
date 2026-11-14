// handTracker.ts
// Turns MediaPipe hand landmarks + timestamps into a per-frame hand state:
// grab / release events, smoothed 3D position, orientation, and per-frame deltas.
// Pure TS, no dependencies.
//
// Coordinate convention (MediaPipe): x right, y down, z away from the camera.
// Use toYUp() / quatToYUp() to convert to a y-up engine such as three.js.

// ---------- minimal math ----------
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
});
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const qIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });
const qConj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const qMul = (a: Quat, b: Quat): Quat => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const qNlerp = (a: Quat, b: Quat, t: number): Quat => {
    const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
    const q = {
        x: a.x + (s * b.x - a.x) * t,
        y: a.y + (s * b.y - a.y) * t,
        z: a.z + (s * b.z - a.z) * t,
        w: a.w + (s * b.w - a.w) * t,
    };
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
};

/** Rotation angle (radians) of a quaternion; handy for dead zones. */
export const quatAngle = (q: Quat) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

/** Rotation matrix with columns c0,c1,c2 -> quaternion. */
function basisToQuat(c0: Vec3, c1: Vec3, c2: Vec3): Quat {
    const m00 = c0.x, m10 = c0.y, m20 = c0.z;
    const m01 = c1.x, m11 = c1.y, m21 = c1.z;
    const m02 = c2.x, m12 = c2.y, m22 = c2.z;
    const tr = m00 + m11 + m22;
    if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        return { w: s / 4, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
    } else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        return { w: (m21 - m12) / s, x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s };
    } else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s };
    }
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4 };
}

/** MediaPipe (x right, y down, z away) -> y-up, z-toward-viewer (three.js style). */
export const toYUp = (v: Vec3): Vec3 => ({ x: v.x, y: -v.y, z: -v.z });
export const quatToYUp = (q: Quat): Quat => ({ x: q.x, y: -q.y, z: -q.z, w: q.w });

// ---------- input adapter ----------
export interface RawHand {
    landmarks: Vec3[];       // 21 normalized image landmarks (x,y in 0..1)
    worldLandmarks: Vec3[];  // 21 metric landmarks (metres, hand-centred)
    score: number;
}

/** The parts of a HandLandmarker / GestureRecognizer result that we use. */
export interface HandsResultLike {
    landmarks: Vec3[][];
    worldLandmarks: Vec3[][];
    handedness?: { categoryName: string; score: number }[][];
    handednesses?: { categoryName: string; score: number }[][]; // older tasks-vision versions
}

/**
 * Splits a HandLandmarker or GestureRecognizer result into { Left, Right } as the USER sees their hands.
 * `mirrored` = the frames you fed MediaPipe were already selfie-flipped.
 * If false (raw webcam frames), labels are swapped and x is flipped so the data
 * behaves like a mirror: moving your right hand to your right moves +x.
 */
export function toRawHands(
    result: HandsResultLike,
    opts: { mirrored: boolean },
): { Left?: RawHand; Right?: RawHand } {
    const out: { Left?: RawHand; Right?: RawHand } = {};
    const flip = !opts.mirrored;
    const handedness = result.handedness ?? result.handednesses ?? [];
    result.landmarks.forEach((lm, i) => {
        const cat = handedness[i]?.[0];
        if (!cat) 
            return;
        
        let label: 'Left' | 'Right' = cat.categoryName === 'Left' ? 'Left' : 'Right';
        if (flip) 
            label = label === 'Left' ? 'Right' : 'Left';
        
        const hand: RawHand = {
            landmarks: lm.map(p => ({ x: flip ? 1 - p.x : p.x, y: p.y, z: p.z })),
            worldLandmarks: result.worldLandmarks[i].map(p => ({ x: flip ? -p.x : p.x, y: p.y, z: p.z })),
            score: cat.score,
        };
        
        if (!out[label] || hand.score > out[label]!.score) 
            out[label] = hand;
    });
    return out;
}

const PALM = [0, 5, 9, 13, 17];                       // wrist + 4 knuckles: barely move when you curl fingers
const FINGERS: [number, number][] = [[5, 8], [9, 12], [13, 16], [17, 20]]; // [MCP, tip]
const PALM_PAIRS: [number, number][] = [[0, 5], [0, 9], [0, 17], [5, 17]];

export interface TrackerOptions {
    aspect: number;          // video width / height
    focalLength: number;     // camera focal length in frame-height units (~1.2 for a typical webcam)
    openRatio: number;       // tip-to-wrist / knuckle-to-wrist for a flat hand
    closedRatio: number;     // same ratio for a fist
    grabOn: number;          // grabAmount needed to start a grab (0..1)
    grabOff: number;         // grabAmount below which a grab ends (< grabOn = hysteresis)
    confirmMs: number;       // new state must persist this long before it counts
    smoothingTauMs: number;  // exponential smoothing time constant (bigger = smoother, laggier)
    lostTimeoutMs: number;   // hand missing this long -> reset (and release if grabbing)
}

const DEFAULTS: TrackerOptions = {
    aspect: 16 / 9,
    focalLength: 1.2,
    openRatio: 1.8,
    closedRatio: 1.0,
    grabOn: 0.75,
    grabOff: 0.45,
    confirmMs: 60,
    smoothingTauMs: 50,
    lostTimeoutMs: 250,
};

/** ~ metres per frame-height at the hand: proportional to distance from the camera. */
function metresPerFrameHeight(L: Vec3[], W: Vec3[], aspect: number): number {
    let world = 0, image = 0;
    for (const [a, b] of PALM_PAIRS) {
        // Compare the same foreshortened (xy) extent in both spaces so hand tilt cancels out.
        world += Math.hypot(W[a].x - W[b].x, W[a].y - W[b].y);
        image += Math.hypot((L[a].x - L[b].x) * aspect, L[a].y - L[b].y);
    }
    return world / Math.max(image, 1e-6);
}

function measure(h: RawHand, o: TrackerOptions) {
    const L = h.landmarks, W = h.worldLandmarks;

    // Position: palm centre, back-projected to approximate metres in camera space.
    let cx = 0, cy = 0;
    for (const i of PALM) {
        cx += L[i].x;
        cy += L[i].y;
    }
    
    cx /= PALM.length; cy /= PALM.length;
    const mpf = metresPerFrameHeight(L, W, o.aspect);
    const palm: Vec3 = {
        x: (cx - 0.5) * o.aspect * mpf,
        y: (cy - 0.5) * mpf,
        z: mpf * o.focalLength,
    };

    // Orientation: right-handed frame from wrist->middle knuckle and index->pinky knuckle.
    const f = norm(sub(W[9], W[0]));
    const n = norm(cross(f, sub(W[17], W[5])));
    const s = cross(n, f);
    const quat = basisToQuat(s, n, f);

    // Grab: how curled the four fingers are (rotation-invariant, uses 3D world landmarks).
    let ratio = 0;
    for (const [mcp, tip] of FINGERS) ratio += len(sub(W[tip], W[0])) / len(sub(W[mcp], W[0]));
    ratio /= FINGERS.length;
    const amount = clamp01((o.openRatio - ratio) / (o.openRatio - o.closedRatio));

    return { palm, quat, amount };
}

// ---------- tracker ----------
export interface HandState {
    present: boolean;       // hand detected this frame
    grabbing: boolean;
    justGrabbed: boolean;   // true for exactly one update
    justReleased: boolean;  // true for exactly one update
    grabAmount: number;     // 0 open .. 1 fist (raw)
    palm: Vec3;             // smoothed, metres, camera space
    orientation: Quat;      // smoothed palm orientation, camera space
    moveDelta: Vec3;        // palm movement since previous update
    rotDelta: Quat;         // rotation since previous update (camera space; new = rotDelta * old)
    velocity: Vec3;         // m/s, useful for throwing on release
    moveSinceGrab: Vec3;    // zero when not grabbing
    rotSinceGrab: Quat;
}

export class HandTracker {
    private o: TrackerOptions;
    private cur: { palm: Vec3; quat: Quat; t: number } | null = null;
    private grabbing = false;
    private pendingSince: number | null = null;
    private amount = 0;
    private vel: Vec3 = ZERO;
    private grabStart: { palm: Vec3; quat: Quat } | null = null;

    constructor(opts: Partial<TrackerOptions> = {}) {
        this.o = { ...DEFAULTS, ...opts };
    }

    /** Call once per video frame. `t` = the same ms timestamp you gave detectForVideo. */
    update(hand: RawHand | null, t: number): HandState {
        const o = this.o;

        if (!hand) {
            // Tolerate brief detection dropouts; give up after lostTimeoutMs.
            if (this.cur && t - this.cur.t > o.lostTimeoutMs) {
                const wasGrabbing = this.grabbing;
                this.reset();
                return this.snapshot(false, { justReleased: wasGrabbing });
            }
            return this.snapshot(false, {});
        }

        const m = measure(hand, o);
        const prev = this.cur;
        const dt = prev ? Math.max(t - prev.t, 1) : 0;
        const a = prev ? 1 - Math.exp(-dt / o.smoothingTauMs) : 1; // frame-rate independent
        const palm = prev ? lerp3(prev.palm, m.palm, a) : m.palm;
        const quat = prev ? qNlerp(prev.quat, m.quat, a) : m.quat;
        const moveDelta = prev ? sub(palm, prev.palm) : ZERO;
        const rotDelta = prev ? qMul(quat, qConj(prev.quat)) : qIdentity();
        this.vel = prev ? scale(moveDelta, 1000 / dt) : ZERO;
        this.cur = { palm, quat, t };
        this.amount = m.amount;

        // Grab state machine: hysteresis (grabOn/grabOff) + must persist for confirmMs.
        const want = this.grabbing ? m.amount > o.grabOff : m.amount >= o.grabOn;
        let justGrabbed = false, justReleased = false;
        if (want === this.grabbing) {
            this.pendingSince = null;
        } else {
            if (this.pendingSince === null) this.pendingSince = t;
            if (t - this.pendingSince >= o.confirmMs) {
                this.grabbing = want;
                this.pendingSince = null;
                justGrabbed = want;
                justReleased = !want;
                this.grabStart = want ? { palm, quat } : null;
            }
        }

        return this.snapshot(true, { justGrabbed, justReleased, moveDelta, rotDelta });
    }

  private reset() {
    this.cur = null;
    this.grabbing = false;
    this.pendingSince = null;
    this.amount = 0;
    this.vel = ZERO;
    this.grabStart = null;
  }

  private snapshot(present: boolean, e: Partial<HandState>): HandState {
    const cur = this.cur, gs = this.grabStart;
    return {
      present,
      grabbing: this.grabbing,
      justGrabbed: false,
      justReleased: false,
      grabAmount: this.amount,
      palm: cur?.palm ?? ZERO,
      orientation: cur?.quat ?? qIdentity(),
      moveDelta: ZERO,
      rotDelta: qIdentity(),
      velocity: present ? this.vel : ZERO,
      moveSinceGrab: gs && cur ? sub(cur.palm, gs.palm) : ZERO,
      rotSinceGrab: gs && cur ? qMul(cur.quat, qConj(gs.quat)) : qIdentity(),
      ...e,
    };
  }
}
