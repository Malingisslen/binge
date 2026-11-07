// Registreras vid appstart (inte först när push slås på) så att offline-cachen i
// firebase-messaging-sw.js finns för alla besökare. Hoppar över dev: en worker
// som cachar skulle dölja ändringar under utveckling.
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (process.env.NODE_ENV !== 'production') return;
  const register = () => {
    navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => {
      // Appen fungerar utan worker; offline-läget saknas bara.
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
