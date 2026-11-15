
import * as THREE from "three";
import { type Vec3 } from "./utils";

// Draws your hand as 21 dots floating in front of the camera.
// The dots are attached to the CAMERA, not the world, so they stay in front of
// your view wherever you look (like a heads-up display).

const DISTANCE = 0.6; // how far in front of the camera the hand floats
const SIZE = 0.7; //     how big the hand appears (bigger = hand covers more of the screen)
const DROP = 0.12; //    how far below the middle of the screen the hand sits

const PALM_POINTS = [0, 5, 9, 13, 17]; // wrist + base of each finger

export class HandVisualizer {
    private joints: THREE.Mesh[] = [];
    private group = new THREE.Group();

    constructor(camera: THREE.Camera) {
        const geometry = new THREE.SphereGeometry(0.01, 12, 12);
        // depthTest off so the dots are never hidden behind the ground or blocks
        const material = new THREE.MeshBasicMaterial({ color: 0x00ffcc, depthTest: false });

        // Everything added to the group moves and turns with the camera.
        // In camera space: +x is right, +y is up, and -z is straight ahead.
        this.group.position.set(0, -DROP, -DISTANCE);
        camera.add(this.group);

        for (let i = 0; i < 21; i++) {
            const sphere = new THREE.Mesh(geometry, material);
            sphere.renderOrder = 999; // draw on top
            sphere.visible = false;
            this.group.add(sphere);
            this.joints.push(sphere);
        }
    }

    public update(landmarks: Vec3[]) {
        if (!landmarks || landmarks.length < 21) {
            this.joints.forEach((mesh) => (mesh.visible = false));
            return;
        }

        for (let i = 0; i < 21; i++) {
            const mesh = this.joints[i];
            const lm = landmarks[i];
            mesh.visible = true;

            // The camera image is not mirrored: your hand moving to YOUR right makes x go DOWN.
            // So flip x (0.5 - x) to make it move right on screen like a mirror. y is flipped too
            // because image y goes down while 3D y goes up.
            mesh.position.set(
                (0.5 - lm.x) * SIZE,
                -(lm.y - 0.5) * SIZE,
                (lm.z || 0) * SIZE // closer to the camera = nearer to you
            );
        }
    }

    // Where every visible joint is in the 3D WORLD (used to check if the hand is touching the block).
    public worldPoints(): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        for (const mesh of this.joints) {
            if (!mesh.visible) continue;
            points.push(this.group.localToWorld(mesh.position.clone()));
        }
        return points;
    }

    // The middle of the palm, measured from the camera (not the world). Held things are placed
    // using this so they stay stuck to your hand while you turn your head.
    public palmInCameraSpace(): THREE.Vector3 | null {
        if (!this.joints[0].visible) return null;
        const palm = new THREE.Vector3();
        for (const i of PALM_POINTS) palm.add(this.joints[i].position);
        palm.divideScalar(PALM_POINTS.length);
        return palm.add(this.group.position);
    }
}
