import { GestureRecognizerResult } from "@mediapipe/tasks-vision";
import { LeftHandController } from "./left";
import { RightHandController } from "./right";
import { HandInput, PinchDetector, splitHands } from "./utils";

class Controller {
    private leftHand: LeftHandController;
    private rightHand: RightHandController;

    constructor(leftHand: LeftHandController, rightHand: RightHandController) {
        this.leftHand = leftHand;
        this.rightHand = rightHand;
    }

    public processInputs(result: GestureRecognizerResult, timestamp: number) {
        if (!result.landmarks || !result.handedness) return;

        const handInputs = Array<HandInput>(result.landmarks.length);
        for (let i = 0; i < result.landmarks.length; i++) {
            let categoryName;
            if (categoryName = result.handedness[i]?.[0]?.categoryName) {}
            else continue;

            handInputs[i] = {
                id: categoryName as "Left" | "Right",
                landmarks: result.landmarks[i]
            }
        }

        const { left, right } = splitHands(handInputs);

        if (left)
            this.leftHand.update(left, timestamp);
        if (right)
            this.rightHand.update(right, timestamp);
    }
}
