import type { GestureRecognizerResult } from "@mediapipe/tasks-vision";
import { LeftHandController } from "./left";
import { RightHandController } from "./right";
import { type HandInput, splitHands } from "./utils";

export class Controller {
    private leftHand: LeftHandController;
    private rightHand: RightHandController;

    constructor(leftHand: LeftHandController, rightHand: RightHandController) {
        this.leftHand = leftHand;
        this.rightHand = rightHand;
    }

    public processInputs(result: GestureRecognizerResult, timestamp: number) {
        const seconds = timestamp / 1000;

        const handInputs: HandInput[] = [];
        const landmarks = result.landmarks ?? [];
        for (let i = 0; i < landmarks.length; i++) {
            const categoryName = result.handedness?.[i]?.[0]?.categoryName;
            if (categoryName !== "Left" && categoryName !== "Right") continue;

            handInputs.push({ id: categoryName, landmarks: landmarks[i] });
        }

        const { left } = splitHands(handInputs);
        const { right } = splitHands(handInputs, false);

        if (left)
            this.leftHand.update(left, seconds);
        else
            this.leftHand.lost();

        if (right)
            this.rightHand.update(right, seconds);
        else
            this.rightHand.lost();
    }
}
