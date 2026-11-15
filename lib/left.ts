import { INDEX_TIP, OneEuro, PinchDetector, type Vec3 } from "./utils";

export interface MoveTarget {
    setMove(strafe: number, forwards: number): void;
    stop(): void;
}

type LeftState =
    | { status: "idle" }
    | { status: "pinched", anchor: Vec3 };

const IDLE = Object.freeze({ status: "idle" });

const DEADZONE = 0.03;
const FULL = 0.2;
const CURVE = 2.4;

function axis(offset: number): number {
    const a = Math.abs(offset);
    if (a < DEADZONE)
        return 0;

    return Math.sign(offset) * Math.pow(Math.min(1, (a - DEADZONE) / (FULL - DEADZONE)), CURVE);
}

export class LeftHandController {
    private pinchDetector = new PinchDetector();
    private target: MoveTarget;

    private state: LeftState = IDLE;
    // private pos: Vec3 | null = null;

    // separate filters for X and Y coordinates so they track independently
    private filterX = new OneEuro(1.0, 3, 1.0);
    private filterY = new OneEuro(1.0, 3, 1.0);
    
    public gap = 1;
    public strafe = 0;
    public forward = 0;

    public constructor(target: MoveTarget) {
        this.target = target;
    }

    public update(landmarks: Vec3[], timestamp: number): void {
        if (landmarks.length < 21) {
            this.lost();
            return;
        }
        
        const rawPoint = landmarks[INDEX_TIP];
        const smoothedPoint: Vec3 = {
            ...rawPoint,
            x: this.filterX.filter(rawPoint.x, timestamp),
            y: this.filterY.filter(rawPoint.y, timestamp)
        };

        const pinched = this.pinchDetector.detect(landmarks);
        this.gap = this.pinchDetector.gap;

        if (!pinched) {
            if (this.state.status === "pinched")
                this.release();
            return;
        }

        // First frame of a pinch. This spot is the anchor. Smoothing filters may still be catching up from where the hand was a moment ago, so start them fresh here.
        if (this.state.status === "idle") {
            this.filterX = new OneEuro(1.0, 3, 1.0);
            this.filterY = new OneEuro(1.0, 3, 1.0);
            
            this.filterX.filter(rawPoint.x, timestamp);
            this.filterY.filter(rawPoint.y, timestamp);
            this.state = { status: "pinched", anchor: { ...rawPoint } };
            return;
        }

        // The camera image is not mirrored, so your hand moving to YOUR right makes x go DOWN,
        // and a hand going up makes y go down. So "anchor minus hand" is right and up.
        const anchor = this.state.anchor;
        this.strafe = axis(anchor.x - smoothedPoint.x);
        this.forward = axis(anchor.y - smoothedPoint.y);
        this.target.setMove(this.strafe, this.forward);
    }

    // Call when the left hand is no longer visible. Stops immediately.
    public lost(): void {
        this.release();
        this.pinchDetector.reset();
        this.filterX = new OneEuro(1.0, 3, 1.0);
        this.filterY = new OneEuro(1.0, 3, 1.0);
        this.gap = 1;
    }

    private release(): void {
        this.state = IDLE;
        this.strafe = 0;
        this.forward = 0;
        this.target.stop();
    }

    public get pinched(): boolean {
        return this.state.status === "pinched";
    }

    public get anchor(): Vec3 | null {
        return this.state.status === "pinched" ? this.state.anchor : null;
    }

}
