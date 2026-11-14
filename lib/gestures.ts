// takes the raw hand data from MediaPipe and sorts it into left and right

export type Landmark = { x: number; y: number; z?: number }; // 3D coordinate point on the hand
export type HandInput = { id: string; landmarks: Landmark[] }; // raw hand data: an ID ("Left" or "Right") plus all 21 points

const swap_hand = false; // if the camera is mirrored the hands have to be swapped 

// Landmark numbers for counting fingers
export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_PIP = 6; //  middle joint of the index finger
export const INDEX_TIP = 8;
export const MIDDLE_PIP = 10; // middle joint of the middle finger
export const MIDDLE_TIP = 12;
export const RING_PIP = 14; // middle joint of the ring finger
export const RING_TIP = 16;
export const PINKY_PIP = 18; // middle joint of the pinky finger
export const PINKY_TIP = 20;

// defines the return type, either holds 21 landmarks or none
interface SplitHandsResult {
  left: Landmark[] | null;
  right: Landmark[] | null;
}

// sorts raw MediaPipe hand data into separate left and right 21-point arrays
export function splitHands(hands: HandInput[]): SplitHandsResult {
  // sets both hands to empty 

  let left: Landmark[] | null = null;
  let right: Landmark[] | null = null;

  for (const hand of hands) {
    // skip if there is no landmarks or if some are missing
    if (!hand.landmarks || hand.landmarks.length < 21)
      continue;

    // flips the hand if needed 
    const isLeft = (hand.id === "Left") !== swap_hand;

    if (isLeft) {
      left = hand.landmarks;
    }
    else {
      right = hand.landmarks;
    }
  }

  return { left, right };
} 

// find the distance between two points
export function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(
    a.x - b.x, // distance of x axis 
    a.y - b.y, // distance of y axis 
    (a.z ?? 0) - (b.z ?? 0) // distance of z axis
  );
}

// return how many of the four fingers (not the thumb yet) are up
// idea: a finger is up when its tip is farther from the wrist than its middle joint
export function countFinger(landmarks: Landmark[]): number{
  // skip if there is no landmarks or if some are missing
  if (!landmarks || landmarks.length < 21)
    return 0;

  let count = 0;

  // Pair up the tip and PIP constants for all 4 fingers
  const fingers = [
    { tip: INDEX_TIP, pip: INDEX_PIP },
    { tip: MIDDLE_TIP, pip: MIDDLE_PIP },
    { tip: RING_TIP, pip: RING_PIP },
    { tip: PINKY_TIP, pip: PINKY_PIP },
  ];

  for (const f of fingers) {

    const tipDist = dist(landmarks[f.tip], landmarks[WRIST]); // distance between the tip to wrist
    const pipDist = dist(landmarks[f.pip], landmarks[WRIST]); // distance between the PIP to wrist

    if (tipDist > pipDist) {
      count++;
    }
  }

  return count;
}