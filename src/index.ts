import process from 'node:process';
import {fetchResults} from './parser';
import {MongoClient, ObjectId} from 'mongodb';
import {MatchEntry, MatchEntryDocument, MatchListProvider, MatchListProviderDocument} from './types';


const dbUrl = "mongodb://localhost:27017";
const mongoClient = new MongoClient(dbUrl);
const db = mongoClient.db("tt-notifications");

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
            entry[1] = true;
            const oldEntry = MatchEntry.fromDocument(doc as MatchEntryDocument);
            if (oldEntry.hasResult != entry[0].hasResult ||
                oldEntry.hasReport != entry[0].hasReport) {
                // todo notify subscribers
                // todo what about if this entry belongs to multiple providers?
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

init().catch(console.error);

function signalHandler() {
    console.log("Received interrupt. Exiting gracefully ...");
    mongoClient.close().finally(process.exit);
}

process.on("SIGTERM", signalHandler);
process.on("SIGINT", signalHandler);
