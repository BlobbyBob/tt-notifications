import * as process from 'process';
import {fetchResults} from './parser';

const url = "https://www.mytischtennis.de/clicktt/WTTV/22-23/ligen/Bezirksklasse-5/gruppe/417704/spielplan/rr/";
fetchResults(url).then(() => process.exit(0));
