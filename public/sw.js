self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) {}
    const title = data.title || 'PDRS Notification';
    const options = {
        body: data.body || '',
        data: { url: data.url || '/notifications.html' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/notifications.html';
    event.waitUntil(clients.openWindow(url));
});
