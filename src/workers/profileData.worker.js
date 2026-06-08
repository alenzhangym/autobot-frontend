/**
 * Web Worker for profileData computation.
 * Offloads data profiling from the main thread to avoid blocking
 * WebSocket message handlers.
 */
import { profileData } from '../utils/helpers.jsx';

self.onmessage = (event) => {
  const { id, rows } = event.data;
  try {
    const result = profileData(rows);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
