import * as crypto from 'crypto';
import {ObjectId} from 'mongodb';
import {PushSubscription} from 'web-push';

abstract class Model {
    private _id?: ObjectId;

    abstract hash(): Uint8Array;

    abstract toDocument(): { _id: ObjectId };

    get id() {
        return this._id ?? new ObjectId(this.hash());
    }

    set id(id: ObjectId) {
        this._id = id;
    }

}

export class MatchEntry extends Model {
    date?: Date;
    dateStr: string;
    timeStr: string;
    teamA: string;
    teamB: string;
    result: string;
    hasReport: boolean;
    providers: ObjectId[];
    league?: string;

    private dateFormat = Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        timeZone: "Europe/Berlin"
    });
    private timeFormat = Intl.DateTimeFormat("de-DE", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Europe/Berlin"
    });

    constructor(date: Date | [string, string], teamA: string, teamB: string, result: string, hasReport: boolean, providers: ObjectId[], league?: string) {
        super();
        if (date instanceof Date) {
            this.date = date;
            this.dateStr = this.dateFormat.format(this.date);
            this.timeStr = this.timeFormat.format(this.date);
        } else {
            this.dateStr = date[0];
            this.timeStr = date[1];
            this.parseDate();
        }
        this.teamA = teamA;
        this.teamB = teamB;
        this.result = result;
        this.hasReport = hasReport;
        this.providers = providers;
        this.league = league;
    }

    static fromDocument(doc: MatchEntryDocument) {
        const obj: MatchEntry = new MatchEntry(doc.date, doc.teamA, doc.teamB, doc.hasResult ? "?" : "", doc.hasReport, doc.providers, doc.league);
        obj.id = doc._id;
        return obj;
    }

    get hasResult() {
        return this.result.length > 0;
    }

    parseDate() {
        try {
            const [d, m, y] = this.dateStr.split(".");
            const [H, M] = this.timeStr.split(":");
            this.date = new Date();
            this.date.setFullYear(2000 + Number.parseInt(y), Number.parseInt(m) - 1, Number.parseInt(d));
            this.date.setHours(Number.parseInt(H), Number.parseInt(M), 0, 0);
        } catch (e) {
            console.warn("Could not parse date", e);
            this.date = undefined;
        }
    }

    hash() {
        const input = this.dateStr + this.teamA + this.teamB;
        return new Uint8Array(crypto.createHash("md5").update(input).digest()).slice(0, 12);
    }

    containsProvider(providerId: ObjectId): boolean {
        for (const provider of this.providers) {
            if (provider.equals(providerId)) return true;
        }
        return false;
    }

    toDocument(): MatchEntryDocument {
        if (!this.date) {
            this.parseDate();
        }
        return {
            _id: this.id,
            date: this.date!,
            teamA: this.teamA,
            teamB: this.teamB,
            hasResult: this.hasResult,
            hasReport: this.hasReport,
            providers: this.providers,
            league: this.league
        };
    }
}

export interface MatchEntryDocument {
    _id: ObjectId;
    date: Date;
    teamA: string;
    teamB: string;
    hasResult: boolean;
    hasReport: boolean;
    providers: ObjectId[];
    league?: string;
}

export class SubscriberData extends Model {
    endpoint: string;
    authKey: string;
    p256dhKey: string;
    subscriptions: ObjectId[] = [];

    constructor(endpoint: string, p256dhKey: string, authKey: string) {
        super();
        this.endpoint = endpoint;
        this.authKey = authKey;
        this.p256dhKey = p256dhKey;
    }

    hash(): Uint8Array {
        const input = this.endpoint + this.authKey + this.p256dhKey;
        return new Uint8Array(crypto.createHash("md5").update(input).digest()).slice(0, 12);
    }

    static fromDocument(doc: SubscriberDataDocument): SubscriberData {
        const obj = new SubscriberData(doc.endpoint, doc.p256dhKey, doc.authKey);
        obj.id = doc._id;
        obj.subscriptions = doc.subscriptions;
        return obj;
    }

    containsProvider(providerId: ObjectId): boolean {
        for (const subscription of this.subscriptions) {
            if (subscription.equals(providerId)) return true;
        }
        return false;
    }

    toDocument(): SubscriberDataDocument {
        return {
            _id: this.id,
            endpoint: this.endpoint,
            authKey: this.authKey,
            p256dhKey: this.p256dhKey,
            subscriptions: this.subscriptions
        };
    }

    toWebPushOptions(): PushSubscription {
        return {
            endpoint: this.endpoint,
            keys: {
                auth: this.authKey,
                p256dh: this.p256dhKey
            }
        }
    }
}

export interface SubscriberDataDocument {
    _id: ObjectId;
    endpoint: string;
    authKey: string;
    p256dhKey: string;
    subscriptions: ObjectId[];
}

export class MatchListProvider extends Model {
    url: string;
    name: string;
    nextUpdate?: Date;
    errCount = 0;

    constructor(url: string, name: string, nextUpdate?: Date) {
        super();
        this.url = url;
        this.name = name;
        this.nextUpdate = nextUpdate;
    }

    hash(): Uint8Array {
        return new Uint8Array(crypto.createHash("md5").update(this.url).digest()).slice(0, 12);
    }

    static fromDocument(doc: MatchListProviderDocument): MatchListProvider {
        const obj = new MatchListProvider(doc.url, doc.name, doc.nextUpdate);
        obj.id = doc._id;
        return obj;
    }

    toDocument(): MatchListProviderDocument {
        return {
            _id: this.id,
            url: this.url,
            name: this.name,
            nextUpdate: this.nextUpdate
        };
    }
}

export interface MatchListProviderDocument {
    _id: ObjectId;
    url: string;
    name: string;
    nextUpdate?: Date;
}
