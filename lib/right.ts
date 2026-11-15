import { OneEuro, PinchDetector, type Vec3 } from "./utils.js";


const INDEX_TIP = 8;

type State =
    | { status: "idle" }
    | { status: "pinched"; target: Vec3 }
    | { status: "drag"; target: Vec3; deltaX: number; deltaY: number };


export class RightHandController {
    public static pinchDetector = new PinchDetector();

    private state: State = { status: "idle" };

    // separate filters for X and Y coordinates so they track independently
    private filterX = new OneEuro(1.0, 0.007, 1.0);
    private filterY = new OneEuro(1.0, 0.007, 1.0);

    update(landmarks: Vec3[], timestamp: number) {
        // if hand leaves the frame, reset to idle 
        if (landmarks.length < 21) {
            this.state = { status: "idle" };
            return this.state;
        }

        // smooth the raw index tip coordinates with the One Euro filter
        const rawPoint = landmarks[INDEX_TIP];
        const smoothX = this.filterX.filter(rawPoint.x, timestamp);
        const smoothY = this.filterY.filter(rawPoint.y, timestamp);
        const smoothedPoint: Vec3 = { ...rawPoint, x: smoothX, y: smoothY };

        const pinched = RightHandController.pinchDetector.detect(landmarks);

        // state machine logic 
        switch (this.state.status) {
            case "idle":
                if (pinched) {
                    this.state = { status: "pinched", target: smoothedPoint };
                }
                break;
            
            case "pinched":
            case "drag":
                if (!pinched) {
                    this.state = { status: "idle" };
                }
                else {
                    const deltaX = smoothedPoint.x - this.state.target.x;
                    const deltaY = smoothedPoint.y - this.state.target.y;

                    this.state = {
                        status: "drag",
                        target: this.state.target,
                        deltaX,
                        deltaY
                    };
                }
                break;
        }
    }
}
