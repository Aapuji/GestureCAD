// The bare-minimum 3D world: a ground, one block, and a camera you can walk around with.
//
// Usage from your hand-control code:
//   const world = new World(containerElement);   // once, in the browser (e.g. inside useEffect)
//   world.setMove(strafe, forward);               // every frame while the left hand is pinching
//   world.stop();                                 // the moment the pinch is released / hand is lost
//   world.dispose();                              // when leaving the page
//
//   world.turn(deltaYaw, deltaPitch);             // right hand: turn the view (radians). Eased smoothly.
//
// strafe:  -1 (left) .. 1 (right)       forward: -1 (backward) .. 1 (forward)
// Values in between = slower. The world turns them into smooth, frame-rate-independent motion.
// Positive yaw turns left, positive pitch looks up. Walking follows the way you're facing.

import * as THREE from "three";

const EYE_HEIGHT = 1.6; // how high the camera is above the ground
const MAX_SPEED = 3; //    units per second at full push
const MOVE_RESPONSE = 10; // how quickly speed ramps up. Lower = floatier, higher = snappier
const TURN_RESPONSE = 8; //  how quickly the view catches up when turning. Lower = floatier
const MAX_PITCH = 1.4; //    how far you can look up or down (radians, about 80 degrees)

export class World {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.05, 1000);
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private container: HTMLElement;
  private observer: ResizeObserver;

  private target = { strafe: 0, forward: 0 }; // what the hand is asking for
  private current = { strafe: 0, forward: 0 }; // what we're actually doing (eases toward target)
  // Which way you face. The target is where the right hand wants to look; the real view eases toward it.
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private lastTime = performance.now() / 1000;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color(0x0f172a);

    // You stand at the start, eyes above the ground, looking at -z.
    this.camera.position.set(0, EYE_HEIGHT, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(2, 4, 3);
    this.scene.add(light);

    // The ground, so you can tell you're moving. Delete these lines for a truly empty world.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1e293b })
    );
    this.scene.add(ground);

    // The one block, a few steps in front of you.
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xef4444 })
    );
    block.position.set(0, 0.5, -4); // sitting on the ground
    this.scene.add(block);

    this.container.appendChild(this.renderer.domElement);
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);

    this.renderer.setAnimationLoop(() => this.frame());
  }

  // Call every frame while moving. Values are clamped to -1..1.
  setMove(strafe: number, forward: number): void {
    this.target.strafe = Math.max(-1, Math.min(1, strafe));
    this.target.forward = Math.max(-1, Math.min(1, forward));
  }

  // Stop immediately (no gliding). Call when the pinch is released or the hand disappears.
  stop(): void {
    this.target.strafe = 0;
    this.target.forward = 0;
    this.current.strafe = 0;
    this.current.forward = 0;
  }

  // Turn the view by a little. Positive yaw turns left, positive pitch looks up (both in radians).
  // The view glides to the new direction, and looking up/down stops at about 80 degrees.
  turn(deltaYaw: number, deltaPitch: number): void {
    this.targetYaw += deltaYaw;
    this.targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.targetPitch + deltaPitch));
  }

  // Which way the view is heading (the real view eases toward this).
  getLook(): { yaw: number; pitch: number } {
    return { yaw: this.targetYaw, pitch: this.targetPitch };
  }

  // Set where the view should be facing (radians). The view glides there.
  setLook(yaw: number, pitch: number): void {
    this.targetYaw = yaw;
    this.targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
  }

  // Runs every screen frame (60+ times a second), even though hand data only arrives ~30 times a second.
  private frame(): void {
    const t = performance.now() / 1000;
    const dt = Math.min(t - this.lastTime, 0.1); // never jump far after a pause
    this.lastTime = t;

    // Ease the view toward where the right hand wants it.
    const turnK = 1 - Math.exp(-TURN_RESPONSE * dt);
    this.yaw += (this.targetYaw - this.yaw) * turnK;
    this.pitch += (this.targetPitch - this.pitch) * turnK;

    // Ease speed toward what the hand wants, so starting is smooth.
    const k = 1 - Math.exp(-MOVE_RESPONSE * dt);
    this.current.strafe += (this.target.strafe - this.current.strafe) * k;
    this.current.forward += (this.target.forward - this.current.forward) * k;

    // Move along the ground in the direction you're facing.
    const step = MAX_SPEED * dt;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward = (-sin, -cos) on the ground, right = (cos, -sin)
    this.camera.position.x += (-sin * this.current.forward + cos * this.current.strafe) * step;
    this.camera.position.z += (-cos * this.current.forward - sin * this.current.strafe) * step;
    // "YXZ" order = turn around the vertical axis first, then tilt up/down, so the horizon never rolls.
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
