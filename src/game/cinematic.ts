import * as THREE from 'three';

// The crash cut-in, shared between the scene (which runs it) and the depth of field (which follows it):
// `crash` is how far into the beat it is (0 = off, 1 = fully cut in) and `focus` is the crash point in world space.
// `cool` follows `crash` during a cool (hard side) hit and drives its faded, bleached grade in the output pass.
// `preview` holds the near-miss grade on screen while its look panel tab is open, so it can be tuned.
// `driftCut` (0..1) is the drift cut-in (overhead camera, slow motion); it drives its purple grade.
// `finale` (0..1) is the end-of-run shot; it drives its steel-blue end grade.
// `danger` (0..1) is the last-heart warning and `pulse` (0..1) its heartbeat; they drive its grade.
export const cinematicState = { crash: 0, cool: 0, focus: new THREE.Vector3(), preview: false, drift: 0, driftCut: 0, finale: 0, danger: 0, pulse: 0 };
// `drift` (0..1) is how far into the drift camera the player is; the output pass deepens the frame a touch with it.
