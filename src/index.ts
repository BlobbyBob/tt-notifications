import process from 'node:process';
import fs from 'node:fs';
import {MongoClient, ObjectId, UpdateResult} from 'mongodb';
import webpush from 'web-push';
import Fastify, {FastifyReply, FastifyRequest} from 'fastify';
import mime from 'mime-types';
import {
    MatchEntry,
    MatchEntryDocument,
    MatchListProvider,
    MatchListProviderDocument,
    SubscriberData,
    SubscriberDataDocument
} from './types';
import {fetchResults, validateUrl} from './parser';
import {clearTimeout} from 'timers';


const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const notificationTtl = Number.parseInt(process.env.TTL ?? "43200");
const mongoClient = new MongoClient(process.env.MONGO_URL ?? "");
const db = mongoClient.db(process.env.MONGO_DATABASE ?? "tt-notifications");

webpush.setVapidDetails(process.env.ORIGIN ?? "", vapidPublicKey, vapidPrivateKey);

const subscriberDataCollection = db.collection("subscriber-data");
const matchListProviderCollection = db.collection("match-list-providers");
const matchEntryCollection = db.collection("match-entries");

type Timer = ReturnType<typeof setTimeout>;

const providerTimers = new Map<string, Timer | undefined>();

async function scheduleQueryProvider(seconds: number, provider: MatchListProvider) {
    providerTimers.set(provider.id.toHexString(), setTimeout(queryProvider, seconds * 1000, provider));
    provider.nextUpdate = new Date((new Date()).getTime() + seconds * 1000);
    await matchListProviderCollection.updateOne({_id: provider.id}, {$set: {nextUpdate: provider.nextUpdate}});
}

async function init() {
    await matchListProviderCollection.find().forEach(doc => {
        const provider = MatchListProvider.fromDocument(doc as MatchListProviderDocument);
        if (provider.nextUpdate && provider.nextUpdate.getTime() - (new Date()).getTime() > 0) {
            const diff = provider.nextUpdate.getTime() - (new Date()).getTime();
            scheduleQueryProvider(diff, provider).catch(console.error);
        } else {
            scheduleQueryProvider(Math.random() * 10, provider).catch(console.error);
        }
    });
}

async function queryProvider(provider: MatchListProvider) {
    console.log(`Querying provider ${provider.name}`);
    let entries: MatchEntry[] | undefined;
    try {
        entries = await fetchResults(provider);
    } catch (e) {
        if (provider.errCount < 3) {
            console.warn(`Error querying provider ${provider.name}. Retrying in 3h`);
            provider.errCount += 1;
            scheduleQueryProvider(10800, provider).catch(console.error);
        } else {
            console.error(`Error querying provider ${provider.name}. Giving up`);
            scheduleQueryProvider(86400, provider).catch(console.error);
        }
        return;
    }

    const entriesById = new Map<string, [MatchEntry, boolean]>(entries.map(e => [e.id.toHexString(), [e, false]]));

    const updates: Promise<UpdateResult>[] = [];

    // Add new entries to DB
    await matchEntryCollection.find({
        _id: {
            $in: entries.map(e => e.id)
        }
    }).forEach(doc => {
        const entry = entriesById.get(doc._id.toHexString());
        if (entry) {
            const match = entry[0];
            entry[1] = true;
            const oldEntry = MatchEntry.fromDocument(doc as MatchEntryDocument);
            if (!oldEntry.containsProvider(provider.id)) {
                oldEntry.providers.push(provider.id);
                updates.push(matchEntryCollection.updateOne({_id: doc._id},
                    {$set: {providers: oldEntry.providers}}));
            }
            if (oldEntry.hasResult != match.hasResult ||
                oldEntry.hasReport != match.hasReport) {
                if (match.hasReport) {
                    const msg = `Spielbericht für ${match.teamA} - ${match.teamB} (${provider.name}) ist online.`;
                    notifySubscribers(oldEntry.providers, JSON.stringify({msg}));
                }
                updates.push(matchEntryCollection.updateOne({_id: doc._id},
                    {$set: {hasResult: entry[0].hasResult, hasReport: entry[0].hasReport}}));
            }
        }
    });

    await Promise.all(updates);

    const toInsert: MatchEntry[] = [];
    entriesById.forEach(value => {
        const [entry, isInserted] = value;
        if (!isInserted) {
            toInsert.push(entry);
        }
    });

    if (toInsert.length > 0) {
        const res = await matchEntryCollection.insertMany(toInsert.map(e => e.toDocument()));
        console.log(`Inserted ${res.insertedCount} new matches.`);
    }

    // Compute next update timer
    let secondsTillNextUpdate = 86400;
    entries.forEach(entry => {
        if (entry.hasReport) return;
        if (entry.hasResult) {
            secondsTillNextUpdate = Math.min(secondsTillNextUpdate, 3600);
        } else {
            console.log(secondsTillNextUpdate);
            const diffSecs = (entry.date!.getTime() - (new Date()).getTime()) / 1000;
            if (diffSecs + 5400 > 0) {
                secondsTillNextUpdate = Math.min(secondsTillNextUpdate, diffSecs + 5400);
            } else {
                secondsTillNextUpdate = Math.min(secondsTillNextUpdate, 900);
            }
        }
    });
    scheduleQueryProvider(secondsTillNextUpdate, provider).catch(console.error);
}

async function notifySubscribers(providers: ObjectId[], msg: string) {
    const sending: Promise<any>[] = [];
    await subscriberDataCollection.find({
        providers: {$in: providers}
    }).forEach(doc => {
        const subscriber = SubscriberData.fromDocument(doc as SubscriberDataDocument);
        sending.push(webpush.sendNotification(subscriber.toWebPushOptions(), msg, {TTL: notificationTtl}).catch(console.error));
        // todo on repeated errors delete subscriber
    });
    return Promise.all(sending);
}

async function cleanupProvider(providerId: ObjectId) {
    const doc = await matchListProviderCollection.findOne({_id: providerId});
    if (doc) {
        if (await subscriberDataCollection.countDocuments({subscriptions: providerId}) == 0) {
            if (providerTimers.has(providerId.toHexString()))
                clearTimeout(providerTimers.get(providerId.toHexString()));
            await matchListProviderCollection.deleteOne({_id: providerId});
        }
    }
}

const fastify = Fastify({logger: true});

async function serveFile(req: FastifyRequest, resp: FastifyReply) {
    let file = req.url.slice(1);
    if (!file) file = "index.html";
    if (file.includes("..")) {
        resp.code(404);
        return;
    }
    await new Promise<Buffer>((resolve, reject) => {
        fs.readFile(`./public/${file}`, (err, data) => {
            if (err) reject(err);
            resolve(data);
        });
    }).then(data => {
        resp.type(mime.lookup(file) || "application/octet-stream").code(200).send(data);
    }).catch(() => {
        resp.code(404).send();
    });
}

fastify.setNotFoundHandler(serveFile);

fastify.get("/api/vapidpubkey", (req, resp) => {
    resp.type("text/plain").send(vapidPublicKey);
});

fastify.get("/api/providers", async (req, resp) => {
    let subscriber: SubscriberData;
    try {
        let uid = new ObjectId(req.headers.authorization);
        let doc = await subscriberDataCollection.findOne({_id: uid});
        if (!doc) {
            resp.code(403).type("application/json");
            return {errmsg: "not authorized"};
        }
        subscriber = SubscriberData.fromDocument(doc as SubscriberDataDocument);
    } catch (e) {
        resp.code(404).type("application/json");
        return {errmsg: "not found"};
    }

    const providers: MatchListProviderDocument[] = [];
    await matchListProviderCollection.find().forEach(doc => {
        providers.push(doc as MatchListProviderDocument);
    });

    resp.type("application/json");
    return providers.map(provider => {
        const out: any = Object.assign({
            id: provider._id.toHexString(),
            subscribed: subscriber.containsProvider(provider._id)
        }, provider);
        delete out._id;
        return out;
    });
});

fastify.post("/api/providers", async (req, resp) => {
    let url = (req.body as any).url;
    if (typeof url != "string" ||
        url.slice(0, 37) != "https://www.mytischtennis.de/clicktt/" ||
        url.indexOf("spielplan") < 0) {
        return {errmsg: "invalid link"};
    }
    url = url.replace("/vr", "/gesamt").replace("/rr", "/gesamt");
    const testFetch = await fetch(url).then(r => r.text()).catch(() => {
        resp.code(400).type("application/json");
        return;
    });
    if (!testFetch) return {errmsg: "Invalid page"};
    const [name, matchCount] = await validateUrl(testFetch);
    if (name != "" && matchCount > 0) {
        const provider = new MatchListProvider(url, name);
        if (await matchListProviderCollection.estimatedDocumentCount() > 100) {
            resp.code(402).type("application/json");
            return {errmsg: "provider limit reached"};
        }
        await matchListProviderCollection.insertOne(provider.toDocument());
        scheduleQueryProvider(Math.random() * 10, provider).catch(console.error);
        resp.code(201).type("application/json");
        return {id: provider.id.toHexString(), url, name};
    } else {
        resp.code(400).type("application/json");
        return {errmsg: "invalid page"};
    }
});

fastify.post("/api/provider/:provider/subscribe", async (req, resp) => {
    let subscriber: SubscriberData;
    try {
        let uid = new ObjectId(req.headers.authorization);
        let doc = await subscriberDataCollection.findOne({_id: uid});
        if (!doc) {
            resp.code(403).type("application/json");
            return {errmsg: "not authorized"};
        }
        subscriber = SubscriberData.fromDocument(doc as SubscriberDataDocument);
    } catch (e) {
        resp.code(404).type("application/json");
        return {errmsg: "not found"};
    }

    let id;
    try {
        id = new ObjectId((req.params as any).provider);
    } catch (e) {
        resp.code(404).type("application/json");
        return {errmsg: "not found"};
    }
    const providerDoc = await         matchListProviderCollection.findOne({_id: id})
    if (!providerDoc) {
        resp.code(404).type("application/json");
        return {errmsg: "not found"};
    }
    if (!subscriber.containsProvider(providerDoc._id)) {
        subscriber.subscriptions.push(providerDoc._id);
        await subscriberDataCollection.replaceOne({_id: subscriber.id}, subscriber.toDocument());
    }
    resp.code(204);
    return;
});
fastify.post("/api/provider/:provider/unsubscribe", async (req, resp) => {
    let subscriber: SubscriberData;
    try {
        let uid = new ObjectId(req.headers.authorization);
        let doc = await subscriberDataCollection.findOne({_id: uid});
        if (!doc) {
            resp.code(403).type("application/json");
            return {errmsg: "not authorized"};
        }
        subscriber = SubscriberData.fromDocument(doc as SubscriberDataDocument);
    } catch (e) {
        resp.code(404).type("application/json");
        return {errmsg: "not found"};
    }

    let id: ObjectId;
    try {
        id = new ObjectId((req.params as any).provider);
    } catch (e) {
        resp.code(404).type("application/json");
        return {errmsg: "not found"};
    }
    let index;
    for (index = 0; index < subscriber.subscriptions.length; index++) {
        if (subscriber.subscriptions[index].equals(id)) break;
    }
    if (index < subscriber.subscriptions.length) {
        subscriber.subscriptions.splice(index, 1);
        await subscriberDataCollection.replaceOne({_id: subscriber.id}, subscriber.toDocument());
        cleanupProvider(id).catch(console.error);
    }
    resp.code(204);
    return;
});
fastify.post("/api/subscribe", (req, resp) => {
    if (typeof req.body != 'object') {
        resp.type('application/json')
            .code(415)
            .send({errmsg: "invalid content type"});
        return;
    }
    const data: any = req.body;
    const endpoint = data.endpoint;
    const authKey = data.keys?.auth;
    const p256dhKey = data.keys?.p256dh;
    if (typeof endpoint != 'string' || typeof authKey != 'string' || typeof p256dhKey != 'string') {
        resp.type('application/json')
            .code(400)
            .send({errmsg: "missing fields or wrong data types"});
        console.log(data);
        return;
    }
    const subscriber = new SubscriberData(endpoint, p256dhKey, authKey);
    subscriberDataCollection.findOne({_id: subscriber.id}).then(doc => {
        if (doc) {
            resp.type('application/json')
                .code(200)
                .send({uid: subscriber.id.toHexString()});
        } else {
            return subscriberDataCollection.insertOne(subscriber.toDocument()).then(() => {
                resp.type('application/json')
                    .code(201)
                    .send({uid: subscriber.id.toHexString()});
            });
        }
    }).catch(err => {
        console.error(err);
        resp.type('application/json')
            .code(500)
            .send({errmsg: "could not store subscriber in database"});
        return;
    });
});
fastify.post("/api/testmsg", (req, resp) => {
    if (typeof req.body != 'object') {
        resp.type('application/json').code(415);
        return {
            errmsg: "invalid content type"
        };
    }
    const data: any = req.body;
    const endpoint = data.endpoint;
    const authKey = data.keys?.auth;
    const p256dhKey = data.keys?.p256dh;
    if (typeof endpoint != 'string' || typeof authKey != 'string' || typeof p256dhKey != 'string') {
        resp.type('application/json').code(400);
        return {
            errmsg: "missing fields or wrong data types"
        };
    }
    const subscriber = new SubscriberData(endpoint, p256dhKey, authKey);
    webpush.sendNotification(subscriber.toWebPushOptions(), JSON.stringify({msg: "Testnachricht"}), {TTL: 30}).catch(console.error);
});
fastify.listen({host: "::", port: 8080}, err => {
    if (err) throw err;
});

init().catch(console.error);

function signalHandler() {
    console.log("Received interrupt. Exiting gracefully ...");
    Promise.all([
        mongoClient.close(),
        fastify.close()
    ]).finally(process.exit);
}

process.on("SIGTERM", signalHandler);
process.on("SIGINT", signalHandler);
