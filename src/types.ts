import * as crypto from 'crypto';
import {ObjectId} from 'mongodb';

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

    constructor(date: Date | [string, string], teamA: string, teamB: string, result: string, hasReport: boolean) {
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
    }

    static fromDocument(doc: MatchEntryDocument) {
        const obj: MatchEntry = this.constructor(doc.date, doc.teamA, doc.teamB, doc.hasResult ? "?" : "", doc.hasReport);
        obj.id = doc._id;
        return obj;
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
        const input = this.dateStr + this.timeStr + this.teamA + this.teamB;
        return new Uint8Array(crypto.createHash("md5").update(input).digest()).slice(0, 12);
    }

    toDocument(): MatchEntryDocument {
        return {
            _id: this.id,
            date: this.date,
            teamA: this.teamA,
            teamB: this.teamB,
            hasResult: this.result.length > 0,
            hasReport: this.hasReport
        };
    }
}

interface MatchEntryDocument {
    _id: ObjectId;
    date?: Date;
    teamA: string;
    teamB: string;
    hasResult: boolean;
    hasReport: boolean;
}

export class SubscriberData extends Model {
    constructor() {
        super();
        this.id = new ObjectId();
    }

    hash(): Uint8Array {
        // todo
        return new Uint8Array(0);
    }

    static fromDocument(doc: SubscriberDataDocument): SubscriberData {
        const obj = this.constructor();
        obj.id = doc._id;
        return obj;
    }

    toDocument(): SubscriberDataDocument {
        return {
            _id: this.id
        };
    }
}

interface SubscriberDataDocument {
    _id: ObjectId;
}

export class MatchListProvider extends Model {
    url: string;
    name: string;
    nextUpdate?: Date;
    constructor(url: string, name: string, nextUpdate?: Date) {
        super();
        this.id = new ObjectId();
        this.url = url;
        this.name = name;
        this.nextUpdate = nextUpdate;
    }

    hash(): Uint8Array {
        // todo
        return new Uint8Array(0);
    }

    static fromDocument(doc: MatchListProviderDocument): MatchListProvider {
        const obj = this.constructor();
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

interface MatchListProviderDocument {
    _id: ObjectId;
    url: string;
    name: string;
    nextUpdate?: Date;
}
