export class MatchEntry {
    date?: Date;
    dateStr: string;
    timeStr: string;
    teamA: string;
    teamB: string;
    result: string;
    hasReport: boolean;

    constructor(date: string, time: string, teamA: string, teamB: string, result: string, hasReport: boolean) {
        this.dateStr = date;
        this.timeStr = time;
        this.teamA = teamA;
        this.teamB = teamB;
        this.result = result;
        this.hasReport = hasReport;
    }
}
