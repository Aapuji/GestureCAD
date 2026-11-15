import { INDEX_TIP, OneEuro, PinchDetector, Vec3 } from "./utils";

export class LeftHandController {
    public static pinchDetector = new PinchDetector();

    private state: LeftState = IDLE;
    private pos: Vec3 | null = null;

    // separate filters for X and Y coordinates so they track independently
    private filterX = new OneEuro(1.0, 0.007, 1.0);
    private filterY = new OneEuro(1.0, 0.007, 1.0);
    
    public update(landmarks: Vec3[], timestamp: number) {
        if (landmarks.length < 21) {
            this.state = IDLE;
            return;
        }
        
        const rawPoint = landmarks[INDEX_TIP];
        const smoothX = this.filterX.filter(rawPoint.x, timestamp);
        const smoothY = this.filterY.filter(rawPoint.y, timestamp);
        const smoothedPoint = {
            ...rawPoint,
            x: smoothX,
            y: smoothY
        };

        const pinched = LeftHandController.pinchDetector.detect(landmarks);

        switch (this.state.status) {
            case "idle":
                if (pinched) {
                    this.state = { status: "pinched", anchor: smoothedPoint };
                    break;
                }
            case "pinched":
                if (!pinched) {
                    this.state = IDLE;
                } else {
                    let pinchedState = this.state as { status: "pinched", anchor: Vec3 };
                    const dX = smoothedPoint.x - pinchedState.anchor.x;
                    const dY = smoothedPoint.y - pinchedState.anchor.y;
                }
                
        }
    }
}

type LeftState =
    | { status: "idle" }
    | { status: "pinched", anchor: Vec3 };

const IDLE = Object.freeze({ status: "idle" });
