import * as htmlparser2 from 'htmlparser2';
import * as domutils from 'domutils';
import render from 'dom-serializer';
import {ElementType} from 'domelementtype';
import {MatchEntry} from './types';

export async function fetchResults(url: string) {
    const resp = await fetch(url);
    if (resp.status >= 200 && resp.status < 300 && resp.body) {
        const body = await resp.text();
        const start = body.indexOf("<tbody>"), end = body.indexOf("</tbody>");
        if (start < 0 || end < 0) {
            console.error(`Unknown data format start=${start}, end=${end}`);
            return [];
        }
        return parseTable(body.slice(start + 7, end));
    }
    return [];
}

function parseTable(data: string) {
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
        if (row.length != 2*9) {
            console.warn(`Unexpected length of row: ${row.length}. Contents: ${row.join("~")}`);
            continue;
        }
        if (row[0] != "") {
            lastDate = row[0].split(" ").pop() ?? "";
        }
        let hasReport = row[15].length > 20;
        table.push(new MatchEntry([lastDate,
            row[2].split(" ", 2)[0]],
            row[6],
            row[8],
            row[14].split("\n", 2)[0],
            hasReport))
    }

    return table;
}
