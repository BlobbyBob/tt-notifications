<script setup lang="ts">
import {onMounted, ref} from 'vue';

interface Provider {
  id: string;
  subscribed: boolean;
  name: string;
  url: string;
}

const status = ref("");
const uid = ref(localStorage.getItem("uid"));
const providers = ref([] as Provider[]);
const providerTypes: [string, string][] = [["Verein", "text-bg-primary"], ["Mannschaft", "text-bg-warning"], ["Liga", "text-bg-info"]];

// urlBase64ToUint8Array() source: https://github.com/mdn/serviceworker-cookbook
function urlBase64ToUint8Array(base64String: string) {
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

function getProviderType(url: string): [string, string] {
  if (url.indexOf("/verein/") > -1) return providerTypes[0];
  if (url.indexOf("/mannschaft/") > -1) return providerTypes[1];
  return providerTypes[2];
}

function setStatus(msg: string) {
  status.value = msg;
}

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
  });
}

function login() {
  getOrCreateSubscription().then(subscription => {
    fetch('/api/subscribe', {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscription)
    }).then(resp => resp.json()).then(data => {
      uid.value = data.uid;
      localStorage.setItem("uid", uid.value ?? "");
      setStatus("Erfolgreich aktiviert");
    }).then(loadProvider).catch(() => {
      setStatus("Aktivierung fehlgeschlagen");
    });
  });
}

function testMessage() {
  getOrCreateSubscription().then(subscription => fetch('/api/testmsg', {
    method: "post",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(subscription)
  })).then(resp => {
    if (resp.status < 300)
      setStatus("Testnachricht verschickt");
    else
      setStatus("Fehler beim Verschicken.");
  });
}

function loadProvider() {
  if (uid.value) {
    fetch('/api/providers', {
      method: "get",
      headers: {
        "Authorization": uid.value
      }
    }).then((resp) => {
      if (resp.status >= 300) setStatus("Fehler beim Laden der Spielpläne");
      return resp.json();
    }).then(data => providers.value = data);
  }
}

function setSubscriptionStatus(providerId: string, status: boolean) {
  if (uid.value) {
    fetch(`/api/provider/${providerId}/${status ? "" : "un"}subscribe`, {
      method: "post",
      headers: {
        "Authorization": uid.value
      }
    }).then((resp) => {
      if (resp.status < 300) setStatus(`Erfolgreich ${status ? "an" : "ab"}gemeldet`);
      else setStatus("Fehler beim Speichern");
    }).then(loadProvider);
  }
}

function addProvider(ev: Event) {
  const url = ((ev.target! as HTMLFormElement).elements.namedItem("url") as HTMLInputElement).value;
  if (uid.value) {
    fetch(`/api/providers`, {
      method: "post",
      headers: {
        "Authorization": uid.value,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({url})
    }).then((resp) => {
      if (resp.status < 300) setStatus(`Gespeichert`);
      else setStatus("Fehler beim Speichern");
      return resp.json();
    }).then(loadProvider);
  }
}

onMounted(() => {
  setStatus(uid.value ? "Angemeldet" : "Nicht angemeldet");
  loadProvider();
});
</script>

<template>
  <div class="container">
    <h1 class="mt-4">TT Benachrichtigungen</h1>
    <h4>Status: {{ status }}</h4>
    <button class="btn btn-primary" @click="login">Anmelden</button>
    <button class="btn btn-primary ms-3" v-show="uid" @click="testMessage">Testnachricht</button>
    <hr>
    <div v-show="uid">
      <h3>Spielplan hinzufügen</h3>
      <form @submit.prevent="addProvider">
        <div class="row">
          <div class="col-auto">
            <label for="urlInput" class="pt-1">URL:</label>
          </div>
          <div class="col">
            <input type="url" name="url" class="form-control" id="urlInput">
          </div>
        </div>
        <div class="row mt-3">
          <div class="col-12 d-md-grid">
            <button type="submit" class="btn btn-success">Spielplan hinzufügen</button>
          </div>
        </div>
      </form>
    </div>
    <hr>
    <div v-if="providers" class="row">
      <h3>Liste der Spielpläne</h3>
      <table class="table">
        <thead>
        <tr>
          <th>Aktiviert</th>
          <th>Name</th>
          <th>Link</th>
        </tr>
        </thead>
        <tbody>
        <tr v-for="provider of providers" :key="provider.id">
          <td><input type="checkbox" :checked="provider.subscribed"
                     @input="setSubscriptionStatus(provider.id, !provider.subscribed)"></td>
          <td>{{ provider.name }} <span class="badge" :class="[getProviderType(provider.url)[1]]">{{ getProviderType(provider.url)[0] }}</span></td>
          <td><a :href="provider.url" target="_blank">{{ provider.url }}</a></td>
        </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style>
</style>
