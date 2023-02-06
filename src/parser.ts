import * as htmlparser2 from 'htmlparser2';
import * as domutils from 'domutils';
import render from 'dom-serializer';
import {ElementType} from 'domelementtype';
import {MatchEntry, MatchListProvider} from './types';
import {ObjectId} from 'mongodb';

export async function validateUrl(html: string): Promise<[string, number]> {
    let title = "";
    let count = 0;
    try {
        // Fetch title
        {
            const h1Start = [], h1End = [];
            let i = 0;
            while (~(i = html.indexOf("<h1>", ++i))) h1Start.push(i);
            while (~(i = html.indexOf("</h1>", ++i))) h1End.push(i);
            if (h1Start.length < 2 || h1End.length < 2 || h1Start.length != h1End.length)
                return ["", 0];

            const heading = html.slice(h1Start[1] + 4, h1End[1]);
            const dom = htmlparser2.parseDocument(heading);
            for (const elem of dom.children) {
                if (elem.type == ElementType.Text) {
                    title += " " + elem.data.trim();
                } else if (elem.nodeType == 1 && elem.type == ElementType.Tag && elem.tagName == "a") {
                    for (const e of elem.children) {
                        if (e.type == ElementType.Text) title += " " + e.data.trim();
                    }
                }
            }
        }
        title = title.replace(" -", "").trim();

        // Check data table
        {
            const start = html.indexOf("<tbody>"), end = html.indexOf("</tbody>");
            if (start < 0 || end < 0) {
                return ["", 0];
            }
            const table = parseTable(html.slice(start + 7, end), new ObjectId());
            count = table.length;
        }
    } catch (e) {
        return ["", 0];
    }
    return [title, count];
}

export async function fetchResults(provider: MatchListProvider): Promise<MatchEntry[]> {
    const resp = await fetch(provider.url);
    if (resp.status >= 200 && resp.status < 300 && resp.body) {
        const body = await resp.text();
        const start = body.indexOf("<tbody>"), end = body.indexOf("</tbody>");
        if (start < 0 || end < 0) {
            console.error(`Unknown data format start=${start}, end=${end}`);
            return [];
        }
        return parseTable(body.slice(start + 7, end), provider.id);
    }
    return [];
}

function parseTable(data: string, providerId: ObjectId) {
    const dom = htmlparser2.parseDocument(data);
    const raw: string[][] = [];
    for (const tr of dom.children) {
        if (tr.nodeType == 1 && tr.type == ElementType.Tag) {
            const row: string[] = [];
            for (const td of tr.children) {
                if (td.nodeType == 1 && td.type == ElementType.Tag) {
                    row.push(domutils.innerText(td).trim());
                    row.push(render(td.children));
                }
            }
            raw.push(row);
        }
    }

    let lastDate = "";
    let table: MatchEntry[] = [];

    for (const row of raw) {
        if (row.length != 2 * 9 && row.length != 2 * 10) {
            console.warn(`Unexpected length of row: ${row.length}. Contents: ${row.join("~")}`);
            continue;
        }
        const offset = row.length == 2 * 10 ? 2 : 0;
        if (row[0] != "") {
            lastDate = row[0].split(" ").pop() ?? "";
        }
        let hasReport = row[15+offset].length > 20;
        table.push(new MatchEntry([lastDate,
                row[2].split(" ", 2)[0]],
            row[6+offset],
            row[8+offset],
            row[14+offset].split("\n", 2)[0],
            hasReport,
            [providerId]));
    }

    return table;
}
