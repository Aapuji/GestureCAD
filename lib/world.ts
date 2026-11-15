import * as THREE from "three";
import { HandVisualizer } from "./handVisual";
import { type Vec3 } from "./utils";

const EYE_HEIGHT = 1.6;
const MAX_SPEED = 3;
const MOVE_RESPONSE = 10;
const TURN_RESPONSE = 8;
const MAX_PITCH = 1.4;

// How close (in world units) a hand joint has to be to a block's surface to be able to grab it.
const GRAB_REACH = 1;
// How quickly a held block catches up to your hand. Higher = snappier, lower = smoother.
const HOLD_RESPONSE = 20;
// How far the block moves compared with your hand. 1 = same as the hand dots. Higher = moves more.
const HOLD_GAIN = 5.5;
// The most a held block can be carried (world units) from where you grabbed it.
// Movement slows down smoothly as it approaches this, so it can't fly out.
const MAX_CARRY = 3;

// The blocks: a colour for each one. They are lined up in an arc in front of where you start.
const BLOCK_COLORS = [0xef4444, 0xf59e0b, 0x3b82f6, 0xa855f7, 0xec4899];

const SKY = 0x9fd8ff;

// Simple repeatable random numbers, so the scenery is the same every time you load the page.
function makeRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Paints a small grass picture (green with lighter and darker flecks) that repeats over the ground.
function makeGrassTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = makeRandom(7);

  ctx.fillStyle = "#5aa83a";
  ctx.fillRect(0, 0, size, size);
  const shades = ["#4d9a31", "#6bbd45", "#7ccd4f", "#438a2a", "#8fd95e"];
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = shades[Math.floor(rand() * shades.length)];
    const x = rand() * size;
    const y = rand() * size;
    ctx.fillRect(x, y, 2 + rand() * 3, 4 + rand() * 6); // tiny blade-shaped flecks
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(400, 400); // 2000 units wide / 400 = one picture every 5 units
  texture.anisotropy = 8;
  return texture;
}

interface Block {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

export class World {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.05, 1000);
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private container: HTMLElement;
  private observer: ResizeObserver;

  private handVisualizer: HandVisualizer;

  private blocks: Block[] = [];

  // Holding state. holdOffset = where the block is compared with the palm (in camera space).
  private held: Block | null = null;
  private wasGrabbing = false;
  private holdOffset = new THREE.Vector3();
  private palmStart = new THREE.Vector3(); // where the palm was when you grabbed
  private palmTarget = new THREE.Vector3(); // where the hand is right now (camera space)
  private palmSmooth = new THREE.Vector3(); // eased copy of it, so the block doesn't jitter

  private target = { strafe: 0, forward: 0 };
  private current = { strafe: 0, forward: 0 };
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private lastTime = performance.now() / 1000;

  constructor(container: HTMLElement) {
    this.container = container;

    // Sky colour, with fog in the same colour so the far edge of the field fades into the sky.
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 25, 140);

    this.camera.position.set(0, EYE_HEIGHT, 0);
    // The camera must be in the scene for things attached to it (the hand) to be drawn.
    this.scene.add(this.camera);

    // Sky light from above (blue-ish) and bounce light from the grass (green-ish), plus the sun.
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a7a2a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff3d6, 1.5);
    sun.position.set(20, 30, 10);
    this.scene.add(sun);

    this.buildGround();
    this.buildGrassTufts();
    this.buildTrees();

    // The blocks, in an arc in front of you.
    BLOCK_COLORS.forEach((color, i) => {
      const material = new THREE.MeshStandardMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      const spread = (i - (BLOCK_COLORS.length - 1) / 2) * 2.2; // left to right
      mesh.position.set(spread, 0.5, -4 - Math.abs(spread) * 0.25); // sitting on the ground
      this.scene.add(mesh);
      this.blocks.push({ mesh, material });
    });

    this.handVisualizer = new HandVisualizer(this.camera);

    this.container.appendChild(this.renderer.domElement);
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);

    this.renderer.setAnimationLoop(() => this.frame());
  }

  private buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: makeGrassTexture(), roughness: 1 })
    );
    this.scene.add(ground);
  }

  // Thousands of little grass blades, drawn in ONE go (InstancedMesh) so it stays fast.
  private buildGrassTufts() {
    const count = 4000;
    const area = 100; // spread over a 100 x 100 square around the start
    const rand = makeRandom(21);

    const blade = new THREE.ConeGeometry(0.05, 0.4, 3).translate(0, 0.2, 0);
    const tufts = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ roughness: 1 }), count);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      dummy.position.set((rand() - 0.5) * area, 0, (rand() - 0.5) * area);
      dummy.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI, (rand() - 0.5) * 0.4);
      dummy.scale.setScalar(0.6 + rand() * 1.2);
      dummy.updateMatrix();
      tufts.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.25 + rand() * 0.08, 0.6, 0.3 + rand() * 0.2); // different greens
      tufts.setColorAt(i, color);
    }
    this.scene.add(tufts);
  }

  // A few simple trees (a brown trunk and two green cones) scattered in the distance.
  private buildTrees() {
    const rand = makeRandom(99);
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.28, 1.6, 8).translate(0, 0.8, 0);
    const lowerGeo = new THREE.ConeGeometry(1.3, 2.2, 8).translate(0, 2.4, 0);
    const upperGeo = new THREE.ConeGeometry(0.95, 1.8, 8).translate(0, 3.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 1 });

    for (let i = 0; i < 24; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 14 + rand() * 40; // keep the area around the blocks clear
      const tree = new THREE.Group();
      tree.add(new THREE.Mesh(trunkGeo, trunkMat));
      tree.add(new THREE.Mesh(lowerGeo, leafMat));
      tree.add(new THREE.Mesh(upperGeo, leafMat));
      tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      tree.scale.setScalar(0.8 + rand() * 0.9);
      this.scene.add(tree);
    }
  }

  // Call with the RIGHT hand's landmarks (empty array if it isn't visible) and whether it is
  // making the grab gesture. Draws the hand and handles picking up / dropping blocks.
  public updateHand(landmarks: Vec3[], grabbing: boolean) {
    this.handVisualizer.update(landmarks);

    const present = landmarks.length >= 21;
    const grabNow = present && grabbing;
    const justGrabbed = grabNow && !this.wasGrabbing;
    this.wasGrabbing = grabNow;

    if (this.held) {
      if (!grabNow) {
        this.drop();
      } else {
        const palm = this.handVisualizer.palmInCameraSpace();
        if (palm) this.palmTarget.copy(palm);
      }
      return;
    }

    // Not holding anything: which block (if any) is the hand touching?
    const near = present ? this.nearestBlock() : null;
    for (const b of this.blocks) {
      b.material.emissive.setHex(b === near ? 0x444444 : 0x000000); // the grabbable one glows
    }

    // Grab only at the moment the fist closes, and only if the hand is touching a block.
    if (justGrabbed && near) this.pickUp(near);
  }

  // The block closest to your hand, among the ones your hand is touching. null if none.
  private nearestBlock(): Block | null {
    const points = this.handVisualizer.worldPoints();
    if (points.length === 0) return null;

    const middle = new THREE.Vector3();
    points.forEach((p) => middle.add(p));
    middle.divideScalar(points.length);

    let best: Block | null = null;
    let bestDistance = Infinity;
    for (const b of this.blocks) {
      const reach = new THREE.Box3().setFromObject(b.mesh).expandByScalar(GRAB_REACH);
      if (!points.some((p) => reach.containsPoint(p))) continue;
      const d = middle.distanceTo(b.mesh.position);
      if (d < bestDistance) {
        bestDistance = d;
        best = b;
      }
    }
    return best;
  }

  private pickUp(block: Block) {
    const palm = this.handVisualizer.palmInCameraSpace();
    if (!palm) return;
    this.camera.updateMatrixWorld();
    const blockInCamera = this.camera.worldToLocal(block.mesh.position.clone());
    this.holdOffset.copy(blockInCamera).sub(palm); // keep the block where it is relative to your palm
    this.palmStart.copy(palm);
    this.palmTarget.copy(palm);
    this.palmSmooth.copy(palm);
    this.held = block;
    block.material.emissive.setHex(0x666666);
  }

  private drop() {
    if (this.held) this.held.material.emissive.setHex(0x000000);
    this.held = null;
  }

  setMove(strafe: number, forward: number): void {
    this.target.strafe = Math.max(-1, Math.min(1, strafe));
    this.target.forward = Math.max(-1, Math.min(1, forward));
  }

  stop(): void {
    this.target.strafe = 0;
    this.target.forward = 0;
    this.current.strafe = 0;
    this.current.forward = 0;
  }

  turn(deltaYaw: number, deltaPitch: number): void {
    this.targetYaw += deltaYaw;
    this.targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.targetPitch + deltaPitch));
  }

  getLook(): { yaw: number; pitch: number } {
    return { yaw: this.targetYaw, pitch: this.targetPitch };
  }

  setLook(yaw: number, pitch: number): void {
    this.targetYaw = yaw;
    this.targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
  }

  private frame(): void {
    const t = performance.now() / 1000;
    const dt = Math.min(t - this.lastTime, 0.1);
    this.lastTime = t;

    const turnK = 1 - Math.exp(-TURN_RESPONSE * dt);
    this.yaw += (this.targetYaw - this.yaw) * turnK;
    this.pitch += (this.targetPitch - this.pitch) * turnK;

    const k = 1 - Math.exp(-MOVE_RESPONSE * dt);
    this.current.strafe += (this.target.strafe - this.current.strafe) * k;
    this.current.forward += (this.target.forward - this.current.forward) * k;

    const step = MAX_SPEED * dt;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.camera.position.x += (-sin * this.current.forward + cos * this.current.strafe) * step;
    this.camera.position.z += (-cos * this.current.forward - sin * this.current.strafe) * step;
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    // A held block follows your palm. This runs every screen frame (after the camera has moved)
    // so the block stays glued to your hand while you walk and turn.
    if (this.held) {
      this.palmSmooth.lerp(this.palmTarget, 1 - Math.exp(-HOLD_RESPONSE * dt));
      this.camera.updateMatrixWorld();
      const moved = this.palmSmooth.clone().sub(this.palmStart).multiplyScalar(HOLD_GAIN);
      // Squeeze it so it slows down the further out the block gets.
      const wanted = moved.length();
      if (wanted > 1e-6) moved.multiplyScalar(softLimit(wanted, MAX_CARRY) / wanted);
      const spot = this.camera.localToWorld(this.palmStart.clone().add(moved).add(this.holdOffset));
      spot.y = Math.max(0.5, spot.y); // never sink into the ground
      this.held.mesh.position.copy(spot);
    }

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

// Close to the input for small values, then eases off and never exceeds `max`.
function softLimit(value: number, max: number): number {
  return max * Math.tanh(value / max);
}


/*
import * as THREE from "three";
import { HandVisualizer } from "./handVisual";
import { type Vec3 } from "./utils";

const EYE_HEIGHT = 1.6;
const MAX_SPEED = 3;
const MOVE_RESPONSE = 10;
const TURN_RESPONSE = 8;
const MAX_PITCH = 1.4;
const HOLD_GAIN = 5.5;
const MAX_CARRY = 3;

// How close (in world units) a hand joint has to be to the block's surface to be able to grab it.
const GRAB_REACH = 1;
// How quickly a held block catches up to your hand. Higher = snappier, lower = smoother.
const HOLD_RESPONSE = 20;

export class World {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.05, 1000);
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private container: HTMLElement;
  private observer: ResizeObserver;

  private handVisualizer: HandVisualizer;

  private block: THREE.Mesh;
  private blockMaterial: THREE.MeshStandardMaterial;

  // Holding state. holdOffset = where the block is compared with the palm (in camera space).
  private holding = false;
  private wasGrabbing = false;
  private holdOffset = new THREE.Vector3();
  private palmStart = new THREE.Vector3(); // where the palm was when you grabbed
  private palmTarget = new THREE.Vector3(); // where the hand is right now (camera space)
  private palmSmooth = new THREE.Vector3(); // eased copy of it, so the block doesn't jitter

  private target = { strafe: 0, forward: 0 };
  private current = { strafe: 0, forward: 0 };
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private lastTime = performance.now() / 1000;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color(0x0f172a);

    this.camera.position.set(0, EYE_HEIGHT, 0);
    // The camera must be in the scene for things attached to it (the hand) to be drawn.
    this.scene.add(this.camera);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(2, 4, 3);
    this.scene.add(light);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1e293b })
    );
    this.scene.add(ground);

    this.blockMaterial = new THREE.MeshStandardMaterial({ color: 0xef4444 });
    this.block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.blockMaterial);
    this.block.position.set(0, 0.5, -4);
    this.scene.add(this.block);

    this.handVisualizer = new HandVisualizer(this.camera);

    this.container.appendChild(this.renderer.domElement);
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);

    this.renderer.setAnimationLoop(() => this.frame());
  }

  // Call with the RIGHT hand's landmarks (empty array if it isn't visible) and whether it is
  // making the grab gesture. Draws the hand and handles picking up / dropping the block.
  public updateHand(landmarks: Vec3[], grabbing: boolean) {
    this.handVisualizer.update(landmarks);

    const present = landmarks.length >= 21;
    const grabNow = present && grabbing;
    const justGrabbed = grabNow && !this.wasGrabbing;
    this.wasGrabbing = grabNow;

    if (this.holding) {
      if (!grabNow) {
        this.drop();
      } else {
        const palm = this.handVisualizer.palmInCameraSpace();
        if (palm) this.palmTarget.copy(palm);
      }
      return;
    }

    // Not holding anything: is the hand touching the block?
    const near = present && this.handIsNearBlock();
    this.blockMaterial.emissive.setHex(near ? 0x662222 : 0x000000); // glows when you can grab it

    // Grab only at the moment the fist closes, and only if the hand is touching the block.
    if (justGrabbed && near) this.pickUp();
  }

  private handIsNearBlock(): boolean {
    const reach = new THREE.Box3().setFromObject(this.block).expandByScalar(GRAB_REACH);
    return this.handVisualizer.worldPoints().some((p) => reach.containsPoint(p));
  }

  private pickUp() {
    const palm = this.handVisualizer.palmInCameraSpace();
    if (!palm) return;
    this.camera.updateMatrixWorld();
    const blockInCamera = this.camera.worldToLocal(this.block.position.clone());
    this.holdOffset.copy(blockInCamera).sub(palm); // keep the block where it is relative to your palm
    this.palmTarget.copy(palm);
    this.palmSmooth.copy(palm);
    this.palmStart.copy(palm);
    this.holding = true;
    this.blockMaterial.emissive.setHex(0xaa3333);
  }

  private drop() {
    this.holding = false;
    this.blockMaterial.emissive.setHex(0x000000);
  }

  setMove(strafe: number, forward: number): void {
    this.target.strafe = Math.max(-1, Math.min(1, strafe));
    this.target.forward = Math.max(-1, Math.min(1, forward));
  }

  stop(): void {
    this.target.strafe = 0;
    this.target.forward = 0;
    this.current.strafe = 0;
    this.current.forward = 0;
  }

  turn(deltaYaw: number, deltaPitch: number): void {
    this.targetYaw += deltaYaw;
    this.targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.targetPitch + deltaPitch));
  }

  getLook(): { yaw: number; pitch: number } {
    return { yaw: this.targetYaw, pitch: this.targetPitch };
  }

  setLook(yaw: number, pitch: number): void {
    this.targetYaw = yaw;
    this.targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
  }

  private frame(): void {
    const t = performance.now() / 1000;
    const dt = Math.min(t - this.lastTime, 0.1);
    this.lastTime = t;

    const turnK = 1 - Math.exp(-TURN_RESPONSE * dt);
    this.yaw += (this.targetYaw - this.yaw) * turnK;
    this.pitch += (this.targetPitch - this.pitch) * turnK;

    const k = 1 - Math.exp(-MOVE_RESPONSE * dt);
    this.current.strafe += (this.target.strafe - this.current.strafe) * k;
    this.current.forward += (this.target.forward - this.current.forward) * k;

    const step = MAX_SPEED * dt;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.camera.position.x += (-sin * this.current.forward + cos * this.current.strafe) * step;
    this.camera.position.z += (-cos * this.current.forward - sin * this.current.strafe) * step;
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    // A held block follows your palm. This runs every screen frame (after the camera has moved)
    // so the block stays glued to your hand while you walk and turn.
    if (this.holding) {
      this.palmSmooth.lerp(this.palmTarget, 1 - Math.exp(-HOLD_RESPONSE * dt));
      this.camera.updateMatrixWorld();
      const moved = this.palmSmooth.clone().sub(this.palmStart).multiplyScalar(HOLD_GAIN);
const spot = this.camera.localToWorld(this.palmStart.clone().add(moved).add(this.holdOffset));
      spot.y = Math.max(0.5, spot.y); // never sink into the ground
      this.block.position.copy(spot);
    }

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
*/
