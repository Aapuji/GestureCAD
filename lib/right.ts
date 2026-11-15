import { dist, WRIST, MIDDLE_FINGER_MCP, OneEuro, PinchDetector, type Vec3 } from "./utils";

// Anything that can turn. The World in world.ts fits this.
export interface TurnTarget {
    getLook(): { yaw: number; pitch: number };
    setLook(yaw: number, pitch: number): void;
}

type State =
    | { status: "idle" }
    | { status: "pinched"; target: Vec3 }
    | { status: "drag"; target: Vec3; deltaX: number; deltaY: number };

const TURN_MODE: "drag" | "rate" = "drag";
const TURN_GAIN = 1.5;
const START_DEADZONE = 0.003; // Hand movements smaller than this per frame are treated as shake and ignored

const RATE_DEADZONE = 0.03;
const RATE_FULL = 0.25; // has to be large than rate dead zone
const MAX_RATE = 1.5; 

const RELEASE_FRAMES = 3;
const LOST_FRAMES = 5;
const HOLD_GAP = 0.37;

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
    private turnTarget: TurnTarget;

    private state: State = { status: "idle" };
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

    public constructor(turnTarget: TurnTarget) {
        this.turnTarget = turnTarget;
    }

    public get pinched(): boolean {
        return this.state.status !== "idle";
    }

    update(landmarks: Vec3[], timestamp: number) {
        // if hand leaves the frame, reset to idle
        if (landmarks.length < 21) {
            this.lost();
            return this.state;
        }
        this.absentFrames = 0;

        const dt = this.lastTime ? Math.min(timestamp - this.lastTime, 0.1) : 0;
        this.lastTime = timestamp;

        const raw = palmPoint(landmarks);

        const pinched = this.pinchDetector.detect(landmarks);
        this.gap = this.pinchDetector.gap;

        // state machine logic 
        switch (this.state.status) {
            case "idle":
                if (pinched) {
                    this.beginPinch(landmarks, raw, timestamp);
                    /*
                    this.filterX = newFilter();
                    this.filterY = newFilter();
                    this.filterX.filter(rawPoint.x, timestamp);
                    this.filterY.filter(rawPoint.y, timestamp);

                    this.start = { ...rawPoint };
                    this.startLook = this.turnTarget.getLook();
                    this.missFrames = 0;

                    this.state = { status: "pinched", target: { ...rawPoint } };
                    */
                }
                break;
            
            case "pinched":
            case "drag": {
                const smoothed = this.smooth(raw, timestamp);
                if (!pinched) {
                    // Don't let go on the first missed frame; MediaPipe flickers.
                    this.missFrames++;
                    if (this.missFrames >= RELEASE_FRAMES) this.endPinch();
                }
                else {
                    this.missFrames = 0;
                    if (this.gap > HOLD_GAP)
                        break;

                    const start = this.start ?? smoothed;
                    const offsetX = smoothed.x - start.x;
                    const offsetY = smoothed.y - start.y;
                    this.turn(offsetX, offsetY, dt);

                    this.state = {
                        status: "drag",
                        target: this.state.target,
                        deltaX: offsetX,
                        deltaY: offsetY
                    };
                }
                break;
            }
        }

        return this.state;
    }

    // Call when the right hand is no longer visible. Brief dropouts are tolerated.
    public lost() {
        this.absentFrames++;
        if (this.absentFrames < LOST_FRAMES) return;

        this.endPinch();
        this.pinchDetector.reset();
        this.gap = 1;
        this.lastTime = 0;
        this.filterX = newFilter();
        this.filterY = newFilter();
    }

    private beginPinch(landmarks: Vec3[], raw: Vec3, timestamp: number) {
        const palmLength = dist(landmarks[WRIST], landmarks[MIDDLE_FINGER_MCP]) || 1e-6;
        this.palmScale = 1 / palmLength;

        this.filterX = newFilter();
        this.filterY = newFilter();
        const start = this.smooth(raw, timestamp);

        this.start = start;
        this.startLook = this.turnTarget.getLook();
        this.missFrames = 0;

        this.state = { status: "pinched", target: { ...start } };
    }

    private smooth(raw: Vec3, timestamp: number): Vec3 {
        return {
            x: this.filterX.filter(raw.x * this.palmScale, timestamp),
            y: this.filterY.filter(raw.y * this.palmScale, timestamp)
        };
    }

    private endPinch() {
        this.state = { status: "idle" };
        this.start = null;
        this.missFrames = 0;
    }

    // Turns the view based on hand movement relative to the pinch anchor.
    // Unmirrored camera: moving right decreases x, moving up decreases y (right = -yaw, up = +pitch).
    private turn(offsetX: number, offsetY: number, dt: number) {
        if (TURN_MODE === "drag") {
            this.turnTarget.setLook(
                this.startLook.yaw + soft(offsetX, START_DEADZONE) * TURN_GAIN,
                this.startLook.pitch - soft(offsetY, START_DEADZONE) * TURN_GAIN
            );
        } else {
            const rate = (offset: number) =>
                Math.sign(offset) * Math.min(1, Math.max(0, Math.abs(offset) - RATE_DEADZONE) / (RATE_FULL - RATE_DEADZONE));
            const look = this.turnTarget.getLook();
            this.turnTarget.setLook(
                look.yaw + rate(offsetX) * MAX_RATE * dt,
                look.pitch - rate(offsetY) * MAX_RATE * dt
            );
        }
    }
}
