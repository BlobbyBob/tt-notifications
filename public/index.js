// urlBase64ToUint8Array() source: https://github.com/mdn/serviceworker-cookbook
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

let uid = localStorage.getItem("uid");
let globalSubscription;
(() => {
    let sub = localStorage.getItem("subscription");
    if (sub) globalSubscription = JSON.parse(sub);
})();

function getOrCreateSubscription() {
    return navigator.serviceWorker.register('service-worker.js').then(registration => {
        return registration.pushManager.getSubscription().then(async (subscription) => {
            if (subscription) {
                return subscription;
            }

            const vapidPubKey = await fetch("/api/vapidpubkey").then(resp => resp.text());
            const binaryKey = urlBase64ToUint8Array(vapidPubKey);
            return registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: binaryKey
            });
        });
    }).then(subscription => {
        globalSubscription = subscription;
        localStorage.setItem("subscription", JSON.stringify(subscription));
        return subscription;
    });
}

function setStatus(msg) {
    const statusSpan = document.getElementById("status");
    if (statusSpan) {
        statusSpan.innerText = msg;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    setStatus(globalSubscription ? "Bereits aktiviert" : "Noch nicht aktiviert");

    const activateButton = document.getElementById("activate");
    const testButton = document.getElementById("test");
    const loadProviderButton = document.getElementById("loadProvider");
    if (activateButton) {
        activateButton.addEventListener("click", () => {
            getOrCreateSubscription().then(subscription => {
                fetch('/api/subscribe', {
                    method: "post",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(subscription)
                }).then(resp => resp.json()).then(data => {
                    uid = data.uid;
                    localStorage.setItem("uid", uid);
                    setStatus("Erfolgreich aktiviert");
                }).catch(() => {
                    setStatus("Aktivierung fehlgeschlagen");
                });
            });
        });
        activateButton.removeAttribute("disabled");
    }
    if (testButton) {
        testButton.addEventListener("click", async () => {
            if (!globalSubscription) {
                await getOrCreateSubscription();
            }
            fetch('/api/testmsg', {
                method: "post",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(globalSubscription)
            }).then((resp) => {
                if (resp.status < 300)
                    setStatus("Testnachricht verschickt");
                else
                    setStatus("Fehler beim Verschicken.");
            });
        });
    }
    if (loadProviderButton) {
        loadProviderButton.addEventListener("click", () => {
            fetch('/api/providers', {
                method: "get",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": uid
                }
            }).then((resp) => {
                if (resp.status < 300) setStatus("Provider geladen");
                else setStatus("Fehler beim Laden.");
                return resp.json()
            }).then(data => {
                buildProviderTable(data);
            });
        });
    }
});

function buildProviderTable(data) {
    const table = document.createElement("table");
}
