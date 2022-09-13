import {
    getAllMarkets,
    getUserById,
    getFullMarket,
    placeBet,
    cancelBet
} from './api.js';

import 'dotenv/config'
import {
    readFile,
    writeFile
} from 'fs/promises';

import {
    isBettable,
    dToP,
    discountDoublings,
    roundToPercent
} from './utility_functions.js';

import { syncBuiltinESMExports } from 'module';

let settings = JSON.parse(
    await readFile(
        new URL('./botsettings.json', import.meta.url)
    )
).whaler;

const notableUsers = {};
notableUsers["jOl1FMKpFbXkoaDGp2qlakUxAiJ3"] = "Spindle";
notableUsers["jO7sUhIDTQbAJ3w86akzncTlpRG2"] = "Bot Dad";
notableUsers["ilJdhpLzZZSUgzueJOs2cbRnJn82"] = "me";
notableUsers["MxdyEeVgrFMTDDsPbXwAe9W1CLs2"] = "Gurkenglas";
notableUsers["4JuXgDx47xPagH5mcLDqLzUSN5g2"] = "BTE";
notableUsers["prSlKwvKkRfHCY43txO4pG1sFMT2"] = "BTE";
notableUsers["Y96HJoD5tQaPgbKi5JEt5JuQJLN2"] = "LiquidityBonusBot";

const millisInAnHour = 60 * 60 * 1000;
const MIN_P_MOVEMENT = .15;
const clock = new Date();
const desiredAlpha = settings.desiredAlpha;

async function assessTraderSkill(bet) {

}

async function wasThisBetPlacedByANoob(bet) {

    let theUser = getUserById(bet.userId);

    let noobPoints = 0;
    let evalString = ""

    if (bet.amount == 1000) {
        evalString += " 2 (Placed a bet of size 1000)";
        noobPoints += 2;
    }
    else if (bet.amount % 100 == 0 || bet.amount % 250 == 0) {
        evalString += " 1 (Placed a bet in multiples of 100)";
        noobPoints++;
    }

    theUser = await theUser;

    if (theUser.createdTime > clock.getTime() - millisInAnHour * 24) {

        evalString += " 2 (Acct created in the last 24h)";
        noobPoints += 2;
    }
    else if (theUser.profitCached.allTime - theUser.profitCached.daily == 0) {
        evalString += " 2 (has made no trades prior to today)";
        noobPoints += 2;
    }
    else if (theUser.createdTime > clock.getTime() - millisInAnHour * 24 * 7) {
        evalString += " 1 (Acct created in the last week)";
        noobPoints++;
    }

    if ((theUser.totalDeposits > 950 && theUser.totalDeposits < 1050) || (theUser.totalDeposits > 1450 && theUser.totalDeposits < 1550)) {
        evalString += " 1 (has starting currentcy amt)";
        noobPoints++;
    }

    if (theUser.creatorVolumeCached.allTime == 0) {
        evalString += " 1 (has made no markets)";
        noobPoints++;
    }

    if (noobPoints > 0) { console.log("Evaluated " + theUser.name + ": " + noobPoints + " = " + evalString); }

    if (noobPoints > 3) { return true; }
    else { return false; }
}

// let deadMarkets = 0;
// while (isBettable(lastMarkets[deadMarkets]) != true) {
//     if (lastMarkets[deadMarkets]) {
//         deadMarkets++;
//     }
// }

function sanitizeFilename(name) {
    return name
        .replace(/\s/g, "_")
        .replace("%", "")
        .replace("?", "")
        .replace(/\,/g, "")
        .replace(/\"/g, "")
        .replace(/\\/g, "-")
        .replace(/\//g, "-");
}

let ellipsesDisplay = 0;

export async function huntWhales(cmkts) {

    if (ellipsesDisplay % 10 == 0) { console.log("..."); }
    ellipsesDisplay++;
    let lastMarkets = cmkts;
    let currentMarkets = [];

    currentMarkets = await getAllMarkets();

    let outcomeTypes = [];

    let numNewMarkets = currentMarkets.length - lastMarkets.length;
    while (numNewMarkets > 0) {
        console.log("======");
        console.log("New Market: " + currentMarkets[numNewMarkets - 1].question + ": " + dToP(currentMarkets[numNewMarkets - 1].probability));
        numNewMarkets--;
    }
    numNewMarkets = currentMarkets.length - lastMarkets.length;

    //console.log(deadMarkets);

    // for (let i = deadMarkets; i < deadMarkets + 10; i++) {
    //    for (let i = currentMarkets.length-1; i > numNewMarkets; i--) {

    for (let i = 0; i < lastMarkets.length; i++) {
        let currentMarketLite = currentMarkets[i + numNewMarkets];

        if (currentMarketLite.outcomeType == "BINARY" || currentMarketLite.outcomeType == "PSEUDO_NUMERIC") {
            let difference = currentMarketLite.probability - lastMarkets[i].probability;

            if (Math.abs(difference) > .01) {
                console.log("-----");
                console.log(currentMarketLite.question + ": " + dToP(lastMarkets[i].probability) + " -> " + dToP(currentMarketLite.probability));

                ellipsesDisplay = 0;
                // if (currentMarketLite.question != lastMarkets[i].question) {
                //      writeFile(`/temp/cmarkets_${sanitizeFilename(currentMarketLite.question)}.json`, JSON.stringify(currentMarkets));
                //      writeFile(`/temp/lmarkets_${sanitizeFilename(lastMarkets[i].question)}.json`, JSON.stringify(lastMarkets));
                // }
            }
            if (Math.abs(difference) >= MIN_P_MOVEMENT / 2) {
                //in the future you'll want to traverse all bets and sum the deltas to find what trader to attribute the move to.

                let currentMarket = await getFullMarket(currentMarketLite.id);
                let betToScan = {};
                let betIndex = 0;
                try {
                    betToScan = currentMarket.bets[betIndex];
                }
                catch (e) {
                    console.log(e);
                    console.log(currentMarket);
                }
                console.log("counterparty buying power: " + dToP(discountDoublings(betToScan)));
                console.log("scanning bet");

                // try { betToScan.createdTime }
                // catch (e) {

                //     console.log(betIndex);
                //     console.log(betToScan);
                //     writeFile(`/temp/cmarkets_${sanitizeFilename(currentMarketLite.question)}.json`, JSON.stringify(currentMarkets));
                //     writeFile(`/temp/lmarkets_${sanitizeFilename(lastMarkets[i].question)}.json`, JSON.stringify(lastMarkets));
                // }
                //console.log("bet id: "+betToScan.id+", most recent bet on snapshot: "+lastMarket.bets[0].id);

                //simpler logic doesnt work because the fullmarket being fetched is up to date. 
                //You need to consult info on the litemarket
                while (betToScan.createdTime > lastMarkets[i].lastUpdatedTime) {
                    let betDifference = betToScan.probAfter - betToScan.probBefore;
                    // if(betDifference ==0){
                    //     console.log(betToScan);
                    // }

                    console.log("prob difference: " + dToP(difference) + ", bet difference: " + dToP(betDifference));

                    if (Math.abs(betDifference) >= MIN_P_MOVEMENT / 2 && (difference * betDifference > 0)) {
                        let bettor = await getUserById(betToScan.userId);
                        let bettorAssessment = "unknown";
                        let betAlpha = desiredAlpha;

                        // console.log("better:");
                        // console.log(await getUserById(betToScan.userId));

                        if (bettor.profitCached.allTime < -800) {
                            bettorAssessment = "troll";
                        }
                        else if (await wasThisBetPlacedByANoob(betToScan)) {
                            //console.log(await wasThisBetPlacedByANoob(betToScan));
                            bettorAssessment = "neophyte";
                        }
                        if (bettor.id == currentMarket.creatorId) {
                            bettorAssessment = "insider";
                        }
                        if (notableUsers[bettor.id] == "BTE") {
                            bettorAssessment = "impulsive";
                            betAlpha = .05;
                        }else if (notableUsers[bettor.id] == "LiquidityBonusBot") {
                            bettorAssessment = "insider";
                        }
                        if (bettorAssessment == "troll" || bettorAssessment == "neophyte" || (bettorAssessment == "impulsive" && Math.abs(betDifference) >= MIN_P_MOVEMENT) || settings.mode == "dry-run-w-mock-betting") {

                            let bet = {
                                contractId: `${currentMarket.id}`,
                                outcome: null,
                                amount: 250,
                                limitProb: null
                            }

                            //also prepare the limit order to liquidate it.
                            let sellBet = {
                                contractId: `${currentMarket.id}`,
                                outcome: null,
                                amount: 0,
                                limitProb: null
                            }

                            let recoveredSpan = Math.abs(difference) * (betAlpha);
                            if (Math.abs(difference) < MIN_P_MOVEMENT) {
                                recoveredSpan = Math.abs(difference) * (betAlpha / 2);
                                bet.amount = 100;
                            }

                            if (notableUsers[bettor.id] == "Spindle") {
                                recoveredSpan = difference * (.8);
                            }
                            if (difference < 0) {
                                bet.outcome = "YES";
                                bet.limitProb = currentMarket.probability + recoveredSpan;
                            }
                            else {
                                bet.outcome = "NO";
                                bet.limitProb = currentMarket.probability - recoveredSpan;
                            }
                            bet.limitProb = parseFloat(bet.limitProb.toFixed(2));

                            if (settings.mode == "dry-run" || settings.mode == "dry-run-w-mock-betting" || settings.mode == "bet") {
                                console.log("Betting against " + bettor.name + " (" + bettorAssessment + ") on " + currentMarket.question + " (" + currentMarket.probability + ")");
                                console.log(bet);
                                let myBet = null;

                                if (settings.mode == "bet") {
                                    let myBetId = (await placeBet(bet).then((resjson) => { console.log(resjson); cancelBet(resjson.betId); return resjson; })).betId;
                                    let updatedMkt = await getFullMarket(currentMarketLite.id);
                                    myBet = updatedMkt.bets.find((bid) => { return bid.id == myBetId; });

                                    console.log("bet id: " + myBetId + ", latest bets on updated market: ");

                                    for (let j = 0; j < 3; j++) {
                                        console.log(updatedMkt.bets[j]);
                                    }

                                }
                                else if (settings.mode == "dry-run-w-mock-betting") {
                                    myBet = bet;
                                    myBet.probAfter = myBet.limitProb;
                                    myBet.shares = myBet.amount / myBet.limitProb;
                                }

                                if (myBet.outcome == "NO") {
                                    sellBet.outcome = "YES";
                                    sellBet.limitProb = roundToPercent(lastMarkets[i].probability + ((myBet.probAfter - lastMarkets[i].probability) / 2));
                                    sellBet.amount = roundToPercent(myBet.shares * sellBet.limitProb);

                                }
                                else if (myBet.outcome == "YES") {
                                    sellBet.outcome = "NO";
                                    sellBet.limitProb = roundToPercent(lastMarkets[i].probability - ((lastMarkets[i].probability - myBet.probAfter) / 2));
                                    sellBet.amount = roundToPercent(myBet.shares * (1 - sellBet.limitProb));
                                }

                                if (settings.mode == "bet") {
                                    await placeBet(sellBet).then((resjson) => { console.log(resjson); });
                                }
                                else if (settings.mode == "dry-run-w-mock-betting") {
                                    console.log(sellBet);
                                }
                            }
                        }
                        else {
                            // console.log("bid: "+bettor.id+", arrayoutput: "+notableUsers[bettor.id]);
                            // if (notableUsers[bettor.id] == "Bot Dad") {
                            //     console.log("spindletracker test a success");
                            // }
                            if (bettorAssessment == "insider") {
                                console.log("bet placer created the market: " + (await getUserById(betToScan.userId)).name);
                            }
                            else {
                                console.log("bet placer seems to know what he's doing: " + (await getUserById(betToScan.userId)).name);
                            }
                        }


                    }




                    if (currentMarket.bets.length <= (++betIndex)) { break; }
                    else { betToScan = currentMarket.bets[betIndex]; }

                    try { betToScan.createdTime }
                    catch (e) {

                        console.log(betIndex);
                        console.log(betToScan);
                    }
                }

            }


        } else if (currentMarketLite.outcomeType == "FREE_RESPONSE") {

        } else if (currentMarketLite.outcomeType == "MULTIPLE_CHOICE") {

        } else if (currentMarketLite.outcomeType == "NUMERIC") {

        }
        else {
            if (outcomeTypes.length == 0 || outcomeTypes.find((a) => { return (a == currentMarketLite.outcomeType); }) == undefined) {
                outcomeTypes.push(currentMarketLite.outcomeType);
                console.log(currentMarketLite.outcomeType);
            }
        }
    }



    return currentMarkets;

}


