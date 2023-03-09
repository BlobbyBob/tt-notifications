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
    if (hasReport && id)
        ev.waitUntil(
            self.clients.openWindow(`${self.location.origin}/redirect-report/${id}`).then(
                clientWindow => clientWindow ? clientWindow.focus() : undefined
            )
        );
})
