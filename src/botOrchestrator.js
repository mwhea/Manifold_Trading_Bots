import {
    fetchAllMarkets,
    fetchMe
} from "./api.js";

import {
    Whaler
} from "./Whaler.js";

import {
    readFile,
    writeFile
} from 'fs/promises';
import { Streaker } from "./streaker.js";

const clock = new Date();
//note that due to latency the thing only runs about 4 times a sec with zero delay.
const CYCLETIME = 5;

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

let botSettings = JSON.parse(
    await readFile(
        new URL('../botSettings.json', import.meta.url)
    )
);

const HOUR = 60 * 60 * 1000;
botSettings.streaker.runEvery = HOUR * 6;
botSettings.attritionTrader.runEvery = HOUR;

let cycles = 0;
//let runTill = new Date('09/25/2022 07:00')
let vsRuns = 0;

let whaler = new Whaler(botSettings.whaler);
await whaler.additionalConstruction();

let streaker = new Streaker(botSettings.streaker);

streaker.keepTheStreakAlive();

while (true) {
    
    //attritionTrade();

    if (botSettings.whaler.active) {
        try {
            await whaler.collectBets();
        }
        catch (e) {
            whaler.log.write(e.message);
            whaler.gracefulShutdown();
            throw (e);
        }
    }

    cycles++;

    await sleep(CYCLETIME);

}