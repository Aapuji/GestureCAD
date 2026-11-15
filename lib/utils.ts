// Vec3, Auto-norm, Euro, Pinch

export type Vec3 = { x: number; y: number; z?: number }; // 3D coordinate point on the hand
export const add = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z !== undefined && b.z !== undefined ? a.z + b.z : undefined
});
export const sub = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z !== undefined && b.z !== undefined ? a.z - b.z : undefined  
});
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + (a.z ?? 0) * (b.z ?? 0);
export const scale = (a: Vec3, s: number): Vec3 => ({
    x: a.x * s,
    y: a.y * s,
    z: a.z !== undefined ? a.z * s : undefined
});
export const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z ?? 0);
export const norm = (a: Vec3): Vec3 => {
    const l = len(a) || 1;
    return { x: a.x / l, y: a.y / l, z: (a.z ?? 0) / l };
};
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const angleBetween = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
export function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}


export type HandInput = {
    id: "Left" | "Right",
    landmarks: Vec3[]
}; // raw hand data: an ID ("Left" or "Right") plus all 21 points

const swapHand = false; // if the camera is mirrored the hands have to be swapped 

// Landmark numbers for counting fingers
export const WRIST = 0;
export const THUMB_CMC = 1;
export const THUMP_MCP = 2;
export const THUMB_IP = 3;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_PIP = 6; //  middle joint of the index finger
export const INDEX_DIP = 7;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9; // base of the middle finger
export const MIDDLE_PIP = 10; // middle joint of the middle finger
export const MIDDLE_DIP = 11;
export const MIDDLE_TIP = 12;
export const RING_MCP = 13;
export const RING_PIP = 14; // middle joint of the ring finger
export const RING_DIP = 15;
export const RING_TIP = 16;
export const PINKY_MCP = 17;
export const PINKY_PIP = 18; // middle joint of the pinky finger
export const PINKY_DIP = 19;
export const PINKY_TIP = 20;
export const FINGERS = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20]
] as const;
export const PALM = [0, 5, 9, 13, 17];
export const IDLE = Object.freeze({ status: "idle" });
// defines the return type, either holds 21 landmarks or none
interface SplitHandsResult {
  left: Vec3[] | null;
  right: Vec3[] | null;
}

// sorts raw MediaPipe hand data into separate left and right 21-point arrays
export function splitHands(hands: HandInput[], normalize = true): SplitHandsResult {
    let left: Vec3[] | null = null;
    let right: Vec3[] | null = null;

    for (const hand of hands) {
        // skip if there is no landmarks or if some are missing
        if (!hand.landmarks || hand.landmarks.length < 21)
            continue;

        // flips the hand if needed 
        const isLeft = (hand.id === "Left") !== swapHand;

        const out = normalize ? normalizeHand(hand) : hand;

        if (isLeft)
            left = out.landmarks;
        else
            right = out.landmarks;
    }

    return { left, right };
}

export function normalizeHand(hand: HandInput): HandInput {
    const palmSize = dist(hand.landmarks[WRIST], hand.landmarks[MIDDLE_MCP]);
    
    return {
        id: hand.id,
        landmarks: hand.landmarks.map(v => scale(v, 1.0 / palmSize))
    }
}

export class OneEuro {
    private xPrev = 0;
    private dxPrev = 0;
    private tPrev: number | null = null;
    private minCutoff: number;
    private beta: number;
    private dCutoff: number;

    constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
    }

    private alpha(cutoff: number, dt: number): number {
        const tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + tau / dt);
    }

    filter(x: number, t: number): number {
        if (this.tPrev === null) {
            this.xPrev = x;
            this.tPrev = t;
            return x;
        }
        
        const dt = Math.max(t - this.tPrev, 1e-3);
        const dx = (x - this.xPrev) / dt;
        const aD = this.alpha(this.dCutoff, dt);
        const dxHat = aD * dx + (1 - aD) * this.dxPrev;
        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
        const a = this.alpha(cutoff, dt);
        const xHat = a * x + (1 - a) * this.xPrev;
        this.xPrev = xHat;
        this.dxPrev = dxHat;
        this.tPrev = t;
        return xHat;
    }
}

export class PinchDetector {
    private pinchThreshold: number;
    private releaseThreshold: number;
    private pinched = false;

    public gap = 1;
    
    public constructor(pinchThreshold = 0.3, releaseThreshold = 0.45) {
        this.pinchThreshold = pinchThreshold;
        this.releaseThreshold = releaseThreshold;
    }

    public detect(landmarks: Vec3[]): boolean {
        // Skip if landmarks are missing
        if (!landmarks || landmarks.length < 21) {
            return this.pinched;
        }

        const thumbTip = landmarks[THUMB_TIP];
        const indexTip = landmarks[INDEX_TIP];
        const handSize = dist(landmarks[WRIST], landmarks[MIDDLE_MCP]) || 1e-6;
        const pinchDist = dist(thumbTip, indexTip) / handSize;
        this.gap = pinchDist

        if (!this.pinched && pinchDist < this.pinchThreshold) {
            this.pinched = true;
        } else if (this.pinched && pinchDist > this.releaseThreshold) {
            this.pinched = false;
        }

        return this.pinched;
    }

    public reset(): void {
        this.pinched = false;
        this.gap = 1;
    }
}
