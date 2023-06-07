import {
    fetchAllMarkets,
    fetchMe
} from "./api.js";

import { Whaler } from "./Whaler.js";
import { sleep } from "./utilityFunctions.js"
import {SECOND, MINUTE, HOUR, DAY} from "./timeWords.js";

import {
    readFile,
    writeFile
} from 'fs/promises';

const CYCLETIME = 5;

let botSettings = JSON.parse(
    await readFile(
        new URL('../botSettings.json', import.meta.url)
    )
);

botSettings.attritionTrader.runEvery = HOUR;

//let runTill = new Date('09/25/2022 07:00')

//TODO: override settings with command line args
let whaler = new Whaler(botSettings.whaler);
await whaler.additionalConstruction();

let prevFinished = true;

while (true) {
    
    //attritionTrade();

    if (botSettings.whaler.active) {

        if (prevFinished) {
            prevFinished = false
            whaler.collectBets()
                .then((newBets) => {
                    //console.log(newBets.length+" new bets")
                    return whaler.prepBetsList(newBets);
                })
                .then((changedMarkets) => {
                    return whaler.huntWhales(changedMarkets);
                })
                .then(() => {
                    prevFinished = true;
                })
                .catch((e) => {
                    whaler.log.write(e.message);
                    whaler.gracefulShutdown();
                    throw (e);
                })
        }

       // whaler.lowPriority();
    }

    await sleep(CYCLETIME);

}