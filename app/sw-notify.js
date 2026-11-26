// Incluído no service worker do app do celular: tocar numa notificação do Mind abre o app
// (ou traz para a frente, se já estiver aberto).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      if (open) return open.focus();
      return self.clients.openWindow(self.registration.scope);
    }),
  );
});
