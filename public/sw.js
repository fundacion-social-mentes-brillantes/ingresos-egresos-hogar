// Service worker minimo: solo habilita instalar la app (PWA) en el celular.
// A proposito NO cachea nada, para que nunca sirva una version vieja de la app;
// deja pasar la red normalmente. Si en el futuro se quiere modo offline, aqui
// se agregaria una estrategia de cache con versionado.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Passthrough: el navegador maneja cada solicitud como siempre.
});
