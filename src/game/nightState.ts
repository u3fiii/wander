// How far night has faded in (0 = day, 1 = night), written by the scene each frame and read by world
// pieces that glow after dark (house windows, street lamps) without threading a prop through everything.
export const nightState = { blend: 0 };
