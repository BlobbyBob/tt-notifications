self.addEventListener('push', ev => {
    const payload = ev.data ? ev.data.json() : {};
    if (payload.msg) {
        ev.waitUntil(
            self.registration.showNotification("TT Benachrichtigung", {
                body: payload.msg,
                data: {
                    id: payload.id,
                    hasReport: payload.hasReport
                }
            })
        );
    } else {
        console.warn("Received payload without message", ev.data);
    }
});

self.addEventListener("notificationclick", ev => {
    ev.notification.close();

    const id = ev.notification.data.id;
    const hasReport = ev.notification.data.hasReport;
    const url = `${self.location.origin}/redirect-report/${id}`;
    if (hasReport && id)
        ev.waitUntil(
            self.clients.openWindow(url).then(clientWindow => {
                console.log(clientWindow);
                if (clientWindow) return clientWindow.focus();
            }).then(console.log).catch(console.error)
        );
})
