import {
    getAllMarkets,
    getMe
} from "./api.js";

import {
    Whaler
} from "./Whaler.js";

import {
    velocitySlayer
} from "./velocitySlayer.js";

import {
    readFile,
    writeFile
} from 'fs/promises';

const clock = new Date();
const CYCLETIME = 1000;

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

let botSettings = JSON.parse(
    await readFile(
        new URL('./botsettings.json', import.meta.url)
    )
);

const HOUR = 60 * 60 * 1000;
botSettings.streaker.runEvery = HOUR * 6;
botSettings.attritionTrader.runEvery = HOUR;
botSettings.velocitySlayer.runEvery = 1000 * 20;


let cycles = 0;
let me = await getMe();
let startingFunds = me.balance;
//let runTill = new Date('09/25/2022 07:00')
let vsRuns = 0;

let whaler = new Whaler(botSettings.whaler);
await whaler.additionalConstruction();

while (true) {

    //streaker();
    //attritionTrade();

    if (botSettings.whaler.active) {
        await whaler.huntWhales();
    }

    if (botSettings.velocitySlayer.active && cycles * CYCLETIME > botSettings.velocitySlayer.runEvery * vsRuns) {
        try {
            await velocitySlayer();
            vsRuns++;
        }
        catch (e) {
            console.log(e);
        }
    }

    cycles++;

    if ((await getMe()).balance < startingFunds - 500) {
        console.log("balance depleted; emergency shutdown engaged.");
        break;
    };

    await sleep(CYCLETIME);

}