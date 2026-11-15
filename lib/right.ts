import {
    type Vec3, 
    dist,
    add,
    sub,
    scale,
    median,
    angleBetween, 
    OneEuro, 
    PinchDetector, 
    PALM, 
    WRIST, 
    MIDDLE_MCP,
    FINGERS,
    clamp01,
    IDLE,
} from "./utils";

// Anything that can turn. The World in world.ts fits this.
// for the camera
export interface TurnTarget {
    getLook(): { yaw: number; pitch: number };
    setLook(yaw: number, pitch: number): void;
}

// 34-22

type State =
    | { status: "idle" }
    | { status: "pinched", anchor: Vec3 }
    | { status: "grabbed", anchor: Vec3 };

const TURN_GAIN = 1.5;
const START_DEADZONE = 0.003; // Hand movements smaller than this per frame are treated as shake and ignored

const RATE_DEADZONE = 0.03;
const RATE_FULL = 0.25; // has to be large than rate dead zone
const MAX_RATE = 1.5; 

const RELEASE_FRAMES = 3;
const LOST_FRAMES = 5;
const HOLD_GAP = 0.37;
const HOLD_CURL = 0.3;
const PINCH_MAX_CURL = 0.40;

const PALM_POINTS = [0, 5, 9, 13, 17];

function palmPoint(landmarks: Vec3[]): Vec3 {
    let x = 0;
    let y = 0;
    for (const i of PALM_POINTS) {
        x += landmarks[i].x;
        y += landmarks[i].y;
    }
    return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

// Shrinks a distance by the dead zone, keeping its sign (so there's no sudden jump past the edge).
function soft(offset: number, dead: number): number {
    return Math.sign(offset) * Math.max(0, Math.abs(offset) - dead);
}

function newFilter(): OneEuro {
    return new OneEuro(0.8, 1.5, 1.0);
}

export class RightHandController {
    private pinchDetector = new PinchDetector();
    private grabDetector = new GrabDetector();
    private turnTarget: TurnTarget;

    private state: State = IDLE;
    private start: Vec3 | null = null; // where the palm was when you pinched
    private palmScale = 1;
    private startLook = { yaw: 0, pitch: 0 }; // which way you were facing when you pinched
    private missFrames = 0; // frames in a row without a pinch
    private absentFrames = 0; // frames in a row without the hand
    private lastTime = 0;

    // separate filters for X and Y coordinates so they track independently
    private filterX = newFilter();
    private filterY = newFilter();

    public gap = 1;
    public handLandmarks: Vec3[] = []; // the right hand's points, empty when it isn't visible
    public curl = 0;
    public grabOffset: Vec3 = { x: 0, y: 0, z: 0 };

    public constructor(turnTarget: TurnTarget) {
        this.turnTarget = turnTarget;
    }

    public get pinched(): boolean {
        return this.state.status === "pinched";
    }

    public get grabbed(): boolean {
        return this.state.status === "grabbed";
    }

    update(landmarks: Vec3[], timestamp: number, world: Vec3[] = landmarks) {
        // if hand leaves the frame, reset to idle
        if (landmarks.length < 21 || world.length < 21) {
            this.lost();
            return this.state;
        }
        this.absentFrames = 0;
        this.handLandmarks = landmarks;

        const dt = this.lastTime ? Math.min(timestamp - this.lastTime, 0.1) : 0;
        this.lastTime = timestamp;

        const raw = palmPoint(landmarks);

        const grabbed = this.grabDetector.detect(world, timestamp * 1000);
        this.curl = this.grabDetector.curl;

        const rawPinched = this.pinchDetector.detect(landmarks);
        this.gap = this.pinchDetector.gap;

        const pinched = rawPinched && !grabbed && this.curl < PINCH_MAX_CURL;

        // state machine logic 
        switch (this.state.status) {
            case "idle":
                if (grabbed)
                    this.begin("grabbed", landmarks, raw, timestamp);
                else if (pinched)
                    this.begin("pinched", landmarks, raw, timestamp);
                break;
            case "pinched": {
                if (grabbed) {
                    this.end();
                    this.begin("grabbed", landmarks, raw, timestamp);
                    break;
                }

                const smoothed = this.smooth(raw, timestamp);
                if (!pinched) {
                    // Don't let go on the first missed frame; MediaPipe flickers.
                    this.missFrames++;
                    if (this.missFrames >= RELEASE_FRAMES) this.end();
                } else {
                    this.missFrames = 0;
                    if (this.gap > HOLD_GAP)
                        break;

                    const start = this.start ?? smoothed;
                    this.turn(smoothed.x - start.x, smoothed.y - start.y, dt);
                }
                break;
            }

            case "grabbed": {
                const smoothed = this.smooth(raw, timestamp);
                if (!grabbed) {
                    this.end();
                } else {
                    const start = this.start ?? smoothed;
                    this.grabOffset = sub(smoothed, start);
                }
                break;
            }
        }

        return this.state;
    }

    // Call when the right hand is no longer visible. Brief dropouts are tolerated.
    public lost() {
        this.absentFrames++;
        if (this.absentFrames >= 2) this.handLandmarks = [];
        if (this.absentFrames < LOST_FRAMES) return;

        this.end();
        this.pinchDetector.reset();
        this.grabDetector.reset();
        this.gap = 1;
        this.curl = 0;
        this.lastTime = 0;
        this.filterX = newFilter();
        this.filterY = newFilter();
    }

    private begin(mode: "pinched" | "grabbed", landmarks: Vec3[], raw: Vec3, timestamp: number) {
        const palmLength = dist(landmarks[WRIST], landmarks[MIDDLE_MCP]) || 1e-6;
        this.palmScale = 1 / palmLength;

        this.filterX = newFilter();
        this.filterY = newFilter();
        const start = this.smooth(raw, timestamp);

        this.start = start;
        this.startLook = this.turnTarget.getLook();
        this.missFrames = 0;
        this.grabOffset = { x: 0, y: 0, z: 0 };

        this.state = { status: mode, anchor: { ...start } };
    }

    private smooth(raw: Vec3, timestamp: number): Vec3 {
        return {
            x: this.filterX.filter(raw.x * this.palmScale, timestamp),
            y: this.filterY.filter(raw.y * this.palmScale, timestamp)
        } as Vec3;
    }

    private end() {
        this.state = IDLE;
        this.start = null;
        this.missFrames = 0;
        this.grabOffset = { x: 0, y: 0, z: 0 };
    }

    // Turns the view based on hand movement relative to the pinch anchor.
    // Unmirrored camera: moving right decreases x, moving up decreases y (right = -yaw, up = +pitch).
    private turn(offsetX: number, offsetY: number, dt: number) {
        this.turnTarget.setLook(
            this.startLook.yaw + soft(offsetX, START_DEADZONE) * TURN_GAIN,
            this.startLook.pitch - soft(offsetY, START_DEADZONE) * TURN_GAIN
        );
    }

    public get grabFeatures() { return this.grabDetector.features; }
}

export interface Features {
  bend: number; // degrees, median finger, total bend over 3 joints (0 = straight)
  tuck: number; // median fingertip-to-palm-centre distance / hand size (smaller = closed)
}

export interface Calibration { open: Features; closed: Features }

export const DEFAULT_CALIBRATION: Calibration = {
  open: { bend: 20, tuck: 1.05 },
  closed: { bend: 240, tuck: 0.4 },
};

export function buildCalibration(
  open: Features[],
  closed: Features[],
): Calibration | { error: string } {
  if (open.length < 10 || closed.length < 10) {
    return { error: 'not enough frames with the hand visible' };
  }
  const med = (fs: Features[]): Features => ({
    bend: median(fs.map((f) => f.bend)),
    tuck: median(fs.map((f) => f.tuck)),
  });
  const o = med(open), c = med(closed);
  if (c.bend - o.bend < 60 || o.tuck - c.tuck < 0.2) {
    return { error: 'open and fist look too similar' };
  }
  return { open: o, closed: c };
}

// ---------- detector ----------
export interface GrabOptions {
  grabThreshold: number;     // curl at/above which a grab can start (0..1)
  releaseThreshold: number;  // curl at/below which a grab can end (keep < grabThreshold)
  grabConfirmMs: number;
  releaseConfirmMs: number;
  smoothingTauMs: number;
  lostTimeoutMs: number;     // landmarks missing this long -> reset
  calibration: Calibration;
}

export const DEFAULT_GRAB_OPTIONS: GrabOptions = {
  grabThreshold: 0.34,
  releaseThreshold: 0.22,
  grabConfirmMs: 50, 
  releaseConfirmMs: 80,
  smoothingTauMs: 30,
  lostTimeoutMs: 250,
  calibration: DEFAULT_CALIBRATION,
};

export class GrabDetector {
    private o: GrabOptions;
    private grabbing = false;
    private lastSeen: number | null = null;
    private pendingSince: number | null = null;

    // Readouts, like PinchDetector.gap
    public curl = 0;                                   // 0 open .. 1 closed, calibrated + smoothed
    public features: Features = { ...DEFAULT_CALIBRATION.open }; // raw numbers, for debugging/calibration
    public justGrabbed = false;                        // true only for the update where it flipped
    public justReleased = false;

    public constructor(options: Partial<GrabOptions> = {}) {
        this.o = { ...DEFAULT_GRAB_OPTIONS, ...options };
    }

    public setCalibration(calibration: Calibration): void {
        this.o = { ...this.o, calibration };
    }

    public setThresholds(grabThreshold: number, releaseThreshold: number): void {
        this.o = { ...this.o, grabThreshold, releaseThreshold };
    }

    /** Raw features for the given landmarks (use this while collecting calibration samples). */
    public static measure(landmarks: Vec3[]): Features | null {
        if (!landmarks || landmarks.length < 21)
            return null;
        const w = landmarks;

        let c: Vec3 = { x: 0, y: 0, z: 0 };
        for (const i of PALM) {
            c = add(c, w[i]);
        }

        const palm: Vec3 = scale(c, 1 / PALM.length);
        const size = dist(w[WRIST], w[MIDDLE_MCP]) || 1e-6;

        const bends: number[] = [];
        const tucks: number[] = [];
        for (const [mcp, pip, dip, tip] of FINGERS.slice(1)) {
            const bend =
                angleBetween(sub(w[mcp], w[WRIST]), sub(w[pip], w[mcp])) +
                angleBetween(sub(w[pip], w[mcp]), sub(w[dip], w[pip])) +
                angleBetween(sub(w[dip], w[pip]), sub(w[tip], w[dip]));
            bends.push((bend * 180) / Math.PI);
            tucks.push(dist(w[tip], palm) / size);
        }
        return { bend: median(bends), tuck: median(tucks) };
    }

    /**
     * Call once per frame with the 21 world landmarks of the tracked hand
     * (or an empty array / null if it wasn't detected). Returns true while grabbing.
     * `t` is the frame timestamp in ms; it defaults to performance.now().
     */
    public detect(landmarks: Vec3[] | null, t: number = performance.now()): boolean {
        this.justGrabbed = false;
        this.justReleased = false;
        const o = this.o;

        const features = landmarks ? GrabDetector.measure(landmarks) : null;
        if (!features) {
            // Hold the current state through short dropouts, give up after lostTimeoutMs.
            if (this.lastSeen !== null && t - this.lastSeen > o.lostTimeoutMs) {
                const was = this.grabbing;
                this.reset();
                this.justReleased = was;
            }

            return this.grabbing;
        }

        this.features = features;
        const c = o.calibration;
        const raw =
        (frac(features.bend, c.open.bend, c.closed.bend) + frac(features.tuck, c.open.tuck, c.closed.tuck)) / 2;

        // Time-based exponential smoothing (snap on the first frame).
        const a = this.lastSeen === null
            ? 1
            : 1 - Math.exp(-Math.max(0, t - this.lastSeen) / o.smoothingTauMs);
        this.curl += (raw - this.curl) * a;
        this.lastSeen = t;

        // Hysteresis: which threshold applies depends on the current state.
        const want = this.grabbing
            ? this.curl > o.releaseThreshold
            : this.curl >= o.grabThreshold;

        // Debounce: the change must persist before we accept it.
        if (want === this.grabbing) {
            this.pendingSince = null;
        } else {
            if (this.pendingSince === null) 
                this.pendingSince = t;
            const needMs = want ? o.grabConfirmMs : o.releaseConfirmMs;
            if (t - this.pendingSince >= needMs) {
                this.grabbing = want;
                this.pendingSince = null;
                this.justGrabbed = want;
                this.justReleased = !want;
            }
        }

        return this.grabbing;
    }

    public reset(): void {
        this.grabbing = false;
        this.curl = 0;
        this.lastSeen = null;
        this.pendingSince = null;
    }
}

const frac = (v: number, from: number, to: number) => clamp01((v - from) / (to - from));
