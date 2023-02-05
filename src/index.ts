import * as process from 'process';
import {fetchResults} from './parser';
import {MongoClient} from 'mongodb';

const dbUrl = "mongodb://localhost:27017";
const mongoClient = new MongoClient(dbUrl);

const subscriberDataCollection = mongoClient.db("tt-notifications").collection("subscriber-data");
const matchListProviderCollection = mongoClient.db("tt-notifications").collection("match-list-providers");
const matchEntryCollection = mongoClient.db("tt-notifications").collection("match-entries");



async function main() {

    // const url = "https://www.mytischtennis.de/clicktt/WTTV/22-23/ligen/Bezirksklasse-5/gruppe/417704/spielplan/gesamt/";
    // const entries = await fetchResults(url);
    // const documents = entries.map(e => e.toDocument());
    // let res: any = await collection.insertMany(documents);
    // console.log(res);
    // res = await collection.countDocuments();
    // const cursor = collection.find();
    // await cursor.forEach(console.log);
    // console.log(res);
}

main().catch(console.error).finally(mongoClient.close).finally(process.exit);
