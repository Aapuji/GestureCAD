# Components
Frontend: Three.js scene.
Backend: Glue to tell renderer what is happening/what to do.
Computer Vision: Using MediaPipe to read hand positions. 
## Pivot
### Left Hand
Idle is default. Only when pinched does it do anything.
When pinch, save that position as an anchor point (potentially actually draw something on the screen?). Moving the left hand while pinching will move the player character.
 - Left/Right (X-offset): Strafe left or strafe right
 - Up/Down (Y-offset): Move forwards/backward. 
Notably, we don't use the Z axis / depth.
Release to stop immediately.
### Right Hand
Idle is default. 
Rotation by pinch and drag. While pinched
 - Dragging left/right/up/down rotates in that direction
 - Should be smooth, not exponential
Grabbing is also pinch, but could be a different finger, or could be a full grab.
### Other Things
Have a deadzone.
Use One-Euro filter to fix jitters.
Divide by size of palm (distance form wrist to middle-finger knuckly).
