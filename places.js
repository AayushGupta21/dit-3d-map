// Hand-curated campus places. Google often doesn't know the names of blocks
// and labs inside a campus, so add them here: name, short description, lat, lng.
// Tip: right-click a spot in Google Maps to copy its coordinates.
// Places Google *does* know near campus are loaded automatically on top of these.
window.DIT_CAMPUS = {
  center: { lat: 30.4002, lng: 78.0790 },
  groundAltitude: 920, // metres above sea level at campus (the camera aims at this height)
  overview: { range: 1300, tilt: 58, heading: 20 },
  searchRadius: 320, // metres around center used for Google place lookups
};

window.DIT_PLACES = [
  { name: "DIT University (main campus)", sub: "Mussoorie Diversion Road, Makka Wala", lat: 30.4002, lng: 78.0790 },
  // { name: "Vedanta Block", sub: "Academic block", lat: 30.40xx, lng: 78.07xx },
  // { name: "Main Gate", sub: "Entrance", lat: 30.40xx, lng: 78.07xx },
];
