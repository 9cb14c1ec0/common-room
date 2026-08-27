self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const targetOrigin = new URL(targetUrl).origin;
    const client = clients.find((candidate) => new URL(candidate.url).origin === targetOrigin);
    if (client) {
      await client.focus();
      client.postMessage({ type: "notification-click" });
      return;
    }
    await self.clients.openWindow(targetUrl);
  }));
});
