self.addEventListener('push', ev => {
    const payload = ev.data ? ev.data.json() : {};
    if (payload.msg) {
        ev.waitUntil(
            self.registration.showNotification("TT Benachrichtigung", {
                body: payload.msg
            })
        );
    } else {
        console.warn("Received payload without message", ev.data);
    }
});
