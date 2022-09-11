import {
    getFullMarket,
    placeBet,
    cancelBet
} from './api.js';

import 'dotenv/config'
import { readFile } from 'fs/promises';

const API_URL = process.env.DEVAPIURL;

let whitelist = JSON.parse(
    await readFile(
        new URL('./whitelist.json', import.meta.url)
    )
);

let settings = JSON.parse(
    await readFile(
        new URL('./botsettings.json', import.meta.url)
    )
).attritionTrader;

const desiredAlpha = settings.desiredAlpha;
const mode = settings.mode;

let clock = new Date();

for (let id = 5; id < whitelist.length; id++) {

    let thisMarket = await getFullMarket(whitelist[id].id);

    let lastProb = thisMarket.probability; //thisMarket.bets.length-1

    // Next we work on figuring out where to move the prob to.
    // where it should be: y = ax+b
    // (negative value of last bet/time between last bet and close)*time since last bet + value of last bet

    let timeOfLastBet = 0;
    if (thisMarket.bets.length > 0) {
        timeOfLastBet = thisMarket.bets[0].createdTime;
    }
    else {
        timeOfLastBet = thisMarket.createdTime;
    }

    let timeInactive = clock.getTime() - timeOfLastBet;
    let totalTimeSpan = thisMarket.closeTime - timeOfLastBet;
    //console.log(totalTimeSpan+" = "+thisMarket.closeTime+" - "+timeOfLastBet);

    //== Some values I didn't end up using ==//
    //let timeToClose = thisMarket.closeTime - clock.getTime();
    //let percentInactive = (timeInactive / thisMarket.closeTime - timeOfLastBet) * 1;

    let yRise = 0;
    if (whitelist[id].value == "slopingDown") {
        yRise = -lastProb;
        yRise += .033; // with slight adjustment. Such markets don't trend towards 0/100, they trend towards approx 3%. Misresolution or opportunity cost of late-breaking news.
    }
    else if (whitelist[id].value == "slopingUp") {
        yRise = 1 - lastProb;
        yRise -= .033; // likewise
    }

    let whereTheProbShouldBe = (yRise / totalTimeSpan) * timeInactive + lastProb;

    //console.log(whereTheProbShouldBe + " = (" + yRise + " / " + totalTimeSpan + ") * " + timeInactive + " + " + lastProb);
    //console.log(thisMarket.question+"  "+lastProb+" "+whereTheProbShouldBe);

    let alpha = Math.abs(lastProb - whereTheProbShouldBe);

    let worthBetting = true;
    if (alpha < 0.01){worthBetting=false;}
    else if (thisMarket.closeTime < clock.getTime()){worthBetting=false;}
    else if (whitelist[id].value == "slopingDown" && lastProb>.94){worthBetting=false;}
    else if (whitelist[id].value == "slopingUp" && lastProb<.06){worthBetting=false;}

    if (worthBetting) {

        let bet = {
            contractId: null,
            outcome: null,
            amount: null,
            limitProb: null
        };

        bet.contractId = thisMarket.id;
        bet.amount = 20;

        if (whitelist[id].value == "slopingDown") {
            bet.outcome = 'NO';
            bet.limitProb = lastProb - ((lastProb - whereTheProbShouldBe) * desiredAlpha);
            //console.log(bet.limitProb+" = "+lastProb+" - (("+lastProb+" - "+whereTheProbShouldBe+") * "+desiredAlpha);
        }
        else if (whitelist[id].value == "slopingUp") {
            bet.outcome = 'YES';
            bet.limitProb = lastProb + ((whereTheProbShouldBe - lastProb) * desiredAlpha);
        }
        bet.limitProb = parseFloat(bet.limitProb.toFixed(2));


        if (mode=="dry-run"){
            console.log(thisMarket.question + " " + lastProb);
            console.log(bet);
        }
        else if (mode=="bet"){
            placeBet(bet).then((resjson)=>{console.log(resjson); cancelBet(resjson.betId);});
        }

    }
}
