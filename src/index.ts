import process from 'node:process';
import fs from 'node:fs';
import {MongoClient} from 'mongodb';
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
import {fetchResults} from './parser';


const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const mongoClient = new MongoClient(process.env.MONGO_URL ?? "");
const db = mongoClient.db(process.env.MONGO_DATABASE ?? "tt-notifications");

webpush.setVapidDetails("http://localhost:8080", vapidPublicKey, vapidPrivateKey);

const subscriberDataCollection = db.collection("subscriber-data");
const matchListProviderCollection = db.collection("match-list-providers");
const matchEntryCollection = db.collection("match-entries");

type Timer = ReturnType<typeof setTimeout>;

const providerTimers = new Map<string, Timer | undefined>();

async function init() {
    await matchListProviderCollection.find().forEach(doc => {
        const provider = MatchListProvider.fromDocument(doc as MatchListProviderDocument);
        if (provider.nextUpdate && provider.nextUpdate.getTime() - (new Date()).getTime() > 0) {
            const diff = provider.nextUpdate.getTime() - (new Date()).getTime();
            providerTimers.set(provider.id.toHexString(), setTimeout(queryProvider, diff, provider));
        } else {
            providerTimers.set(provider.id.toHexString(), setTimeout(queryProvider, Math.random() * 10000, provider));
        }
    });
}

async function queryProvider(provider: MatchListProvider) {
    console.log(`Querying provider ${provider.name}`);
    let entries: MatchEntry[] | undefined;
    try {
        entries = await fetchResults(provider.url);
    } catch (e) {
        if (provider.errCount < 3) {
            console.warn(`Error querying provider ${provider.name}. Retrying in 1h`);
            provider.errCount += 1;
            providerTimers.set(provider.id.toHexString(), setTimeout(queryProvider, 3600000, provider));
        } else {
            console.error(`Error querying provider ${provider.name}. Giving up`);
            providerTimers.set(provider.id.toHexString(), undefined);
        }
        return;
    }

    const entriesById = new Map<string, [MatchEntry, boolean]>(entries.map(e => [e.id.toHexString(), [e, false]]));

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
            if (oldEntry.hasResult != match.hasResult ||
                oldEntry.hasReport != match.hasReport) {
                if (match.hasReport) {
                    const msg = `Spielbericht für ${match.teamA} - ${match.teamB} (${provider.name}) ist online.`;
                    notifySubscribers(JSON.stringify({msg}));
                }
                // todo multiuser with different subscriptions suppert: what about if this entry belongs to multiple providers?
                matchEntryCollection.updateOne({_id: doc._id},
                    {hasResult: entry[0].hasResult, hasReport: entry[0].hasReport}); // Promise ignored
            }
        }
    });

    const toInsert: MatchEntry[] = [];
    entriesById.forEach(value => {
        const [entry, isInserted] = value;
        if (!isInserted) {
            toInsert.push(entry);
        }
    });

    const res = await matchEntryCollection.insertMany(toInsert.map(e => e.toDocument()));
    console.log(`Inserted ${res.insertedCount} new matches.`);

    // Compute next update timer
    let secondsTillNextUpdate = 86400;
    entries.forEach(entry => {
        if (entry.hasReport) return;
        if (entry.hasResult) {
            secondsTillNextUpdate = Math.min(secondsTillNextUpdate, 3600);
        } else {
            const diffSecs = (entry.date!.getTime() - (new Date()).getTime()) / 1000;
            if (diffSecs + 5400 > 0) {
                secondsTillNextUpdate = Math.min(secondsTillNextUpdate, diffSecs + 5400);
            } else {
                secondsTillNextUpdate = Math.min(secondsTillNextUpdate, 900);
            }
        }
    });
    providerTimers.set(provider.id.toHexString(), setTimeout(queryProvider, secondsTillNextUpdate * 1000, provider));
}

async function notifySubscribers(msg: string) {
    const sending: Promise<any>[] = [];
    await subscriberDataCollection.find().forEach(doc => {
        const subscriber = SubscriberData.fromDocument(doc as SubscriberDataDocument);
        sending.push(webpush.sendNotification(subscriber.toWebPushOptions(), msg, {TTL: 30}).catch(console.error));
        // todo on repeated errors delete subscriber
    });
    return Promise.all(sending);
}

const fastify = Fastify({logger: true});
async function serveFile (req: FastifyRequest, resp: FastifyReply) {
    const file: string = (req.params as any)?.file ?? "index.html";
    if (file.includes("/")) {
        resp.code(400);
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
fastify.get("/", serveFile);
fastify.get("/:file", serveFile);
fastify.get("/api/vapidpubkey", (req, resp) => {
    resp.type("text/plain").send(vapidPublicKey);
});
fastify.post("/api/subscribe", (req, resp) => {
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
        console.log(data);
        return {
            errmsg: "missing fields or wrong data types"
        };
    }
    const subscriber = new SubscriberData(endpoint, p256dhKey, authKey);
    subscriberDataCollection.insertOne(subscriber.toDocument()).then(() => {
        resp.code(201).send();
    }).catch(err => {
        console.error(err);
        resp.type('application/json').code(500);
        resp.send({
            errmsg: "could not store subscriber in database"
        });
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
    webpush.sendNotification(subscriber.toWebPushOptions(), JSON.stringify({msg: "Testnachricht"}), {TTL: 30}).catch(console.error)
});
fastify.listen({port: 8080}, err => {
    if (err) throw err;
});

// init().catch(console.error);

function signalHandler() {
    console.log("Received interrupt. Exiting gracefully ...");
    Promise.all([
        mongoClient.close(),
        fastify.close()
    ]).finally(process.exit);
}

process.on("SIGTERM", signalHandler);
process.on("SIGINT", signalHandler);
