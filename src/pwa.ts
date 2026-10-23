/** Registers the offline service worker. Production builds only, so dev reloads are never served stale code. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is a nicety; a failed registration must not break the game.
    });
  } catch {
    // Some embedded browsers throw synchronously; ignore.
  }
}
