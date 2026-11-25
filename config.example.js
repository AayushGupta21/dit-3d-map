// Copy this file to config.js and paste your Google Maps API key below.
// config.js is git-ignored so the key isn't committed by accident.
// In Google Cloud Console, enable: Maps JavaScript API, Map Tiles API,
// Places API (New), Routes API. Then restrict the key to your site's URL.
window.DIT_CONFIG = {
  // Multiplayer relay (Supabase Realtime) for players whose network blocks direct connections.
  // Use the project's *publishable* key: it is meant to be public.
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_KEY: "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY",
  GOOGLE_MAPS_API_KEY: "PASTE_YOUR_KEY_HERE",
};
