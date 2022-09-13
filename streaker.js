import {
    getMarketBySlug,
    getMe
} from './api.js';

console.log(await getMe());

let clock = new Date();
const millisInAnHour = 60*60*1000;
const dummyMarket = getMarketBySlug("market-resolution-is-yes-but-undox");
//const backupMarket = getMarketBySlug("this-question-will-resolve-positive-5c753f5a33e1");

export async function keepTheStreakAlive(){
    let me = await getMe();
    if (me.lastBetTime+(millisInAnHour*16)<clock.Now()){
        
    }

}