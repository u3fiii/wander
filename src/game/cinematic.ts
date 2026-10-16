import * as THREE from 'three';

// The crash cut-in, shared between the scene (which runs it) and the depth of field (which follows it):
// `crash` is how far into the beat it is (0 = off, 1 = fully cut in) and `focus` is the crash point in world space.
// `cool` follows `crash` during a cool (hard side) hit and drives its faded, bleached grade in the output pass.
export const cinematicState = { crash: 0, cool: 0, focus: new THREE.Vector3() };
