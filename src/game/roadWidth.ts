// The main road's width, in one place. The map was laid out for a 5.76 m road (`original`); `scale` widens it. Two
// things follow from it:
// - ROAD_WIDENING: how far each edge has moved out (m). Whatever is measured from the road's edge keeps its distance
//   to it: the curb, the barriers, the edge the car bounces off, the houses, lamps and benches along the street.
// - LANE_SCALE: the lanes widen with the road, so whatever is placed by lane (the traffic, the lane the car cruises
//   back to) moves out in proportion.
export const ROAD_WIDTH = { original: 5.76, scale: 1.2 };
export const MAIN_ROAD_WIDTH = ROAD_WIDTH.original * ROAD_WIDTH.scale;
export const ROAD_WIDENING = (MAIN_ROAD_WIDTH - ROAD_WIDTH.original) / 2;
export const LANE_SCALE = ROAD_WIDTH.scale;
