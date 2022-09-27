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
    roundToPercent,
    consoleReport,
    isUnfilledLimitOrder,
    sanitizeFilename
} from './utility_functions.js';

import { syncBuiltinESMExports } from 'module';
import { time } from 'console';

let settings = JSON.parse(
    await readFile(
        new URL('./botsettings.json', import.meta.url)
    )
).whaler;

let notableUsers = JSON.parse(
    await readFile(
        new URL('./notableUsers.json', import.meta.url)
    )
);


const HOUR = 60 * 60 * 1000;
const MIN_P_MOVEMENT = .0375;
const clock = new Date();
const desiredAlpha = settings.desiredAlpha;


function isMarketLegit(mkt, bettor) {

    let returnVal = 1;

    //is 
    if (mkt.creatorId == bettor.id) {
        if (!(
            notableUsers[mkt.creatorId] == "BTE"
            || notableUsers[mkt.creatorId] == "BTEF2P"
        )) { returnVal -= .75; }
    }

    //If a new user has an extreme profits total they're no doubt a sockpuppet up to schenanigans and should be avoided.
    if (Math.abs(bettor.profitCached.allTime) > 1500 && bettor.createdTime + ((HOUR * 24 * 3)) > clock.getTime()) {
        returnVal -= 300;
    }

    if (mkt.createdTime > clock.getTime() - ((HOUR / 60 * 10))) {
        returnVal -= .25;
    };

    //its probably not a manipulated market if it has lots of unique traders.
    if (mkt.bets.length > 400) { returnVal += 3; }
    else {

        let uniqueTraders = [];
        let numUTs = 0;
        for (let i in mkt.bets) {
            if (uniqueTraders.find((o) => { return o === mkt.bets[i].userId; }) === undefined) {
                numUTs++;
                uniqueTraders.push(mkt.bets[i].userId);
            }
        }
        // }.map((item) => { item.userId }).reduce((names, name) => {
        //     const count = names[name] || 0;
        //     names[name] = count + 1;
        //     return names;
        // }, {});

        if (numUTs > 20) { numUTs = 20; }
        returnVal += (numUTs * 0.05) - .35;
    }

    //The following users have the expertise or inclination to exploit a bot.
    if (notableUsers[bettor.id] == "Yev") {
        returnVal -= .25;
    }
    if (notableUsers[mkt.creatorId] == "Yev"
        || notableUsers[mkt.creatorId] == "Spindle") {
        returnVal -= .25;
    }

    consoleReport("Assessed safety from market manipulation or insider trading: " + returnVal);


    if (returnVal < 0) { return 0; }
    if (returnVal > 1) { return 1; }
    return returnVal;

}

function scale(number, inMin, inMax, outMin, outMax) {
    return (number - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

function assessTraderSkill(bettor, bets, mkt) {

    let evalString = "Evaluated skill of " + bettor.name;
    let now = clock.getTime();

    //special logic for some specific users whose trading patterns I know:
    //BTE has lots of funds and mipulsively places large bets which the larger market doesn't agree with, so he's perfect for market making.
    if (notableUsers[bettor.id] == "BTE") {
        return -0.2;
    }

    if (bettor.id == mkt.creatorId) {
        let bettorAssessment = "insider";
    }

    let dailyProfits = (bettor.profitCached.allTime) / ((now - bettor.createdTime) / (HOUR * 24));

    if (now - bettor.createdTime > HOUR * 24 * 30) {

        evalString += ", daily profits (all): " + roundToPercent(dailyProfits)
            + ", daily profits (monthly): " + roundToPercent((bettor.profitCached.monthly / 30));

        dailyProfits = (dailyProfits + (bettor.profitCached.monthly / 30)) / 2;

    };

    evalString += ", daily profits (averaged): " + roundToPercent(dailyProfits);

    let profitsCalibrated = 0;
    // if (dailyProfits < 0) {
    //     if (dailyProfits < -100) { dailyProfits = -100; }
    //     profitsCalibrated = scale(dailyProfits, -100, 0, 0, 1);
    // }
    // else if (dailyProfits > 0) {
    //     if (dailyProfits > 100) { dailyProfits = 100; }
    //     profitsCalibrated = scale(dailyProfits, 0, 100, 1, 2);
    // }

    //I didn't have time to get a proper range mapping formula worked out.
    if (dailyProfits < -100) {
        profitsCalibrated = -1;
    }
    else if (dailyProfits < -20) {
        profitsCalibrated = -0.66;
    }
    else if (dailyProfits < -5) {
        profitsCalibrated = -0.4;
    }
    else if (dailyProfits < -0.05) {
        profitsCalibrated = -0.1;
    }
    else if (dailyProfits < 0.05) {
        profitsCalibrated = 0;
    }
    else if (dailyProfits < 20) {
        profitsCalibrated = 0.2;
    }
    else if (dailyProfits < 100) {
        profitsCalibrated = 0.4;
    }
    else {
        profitsCalibrated = 1;
    }

    evalString += ", daily profits (calibrated): " + profitsCalibrated;
    consoleReport(evalString);

    return profitsCalibrated;

}

function wasThisBetPlacedByANoob(user, bets) {

    let theUser = user;
    let noobPoints = 0;
    let evalString = ""

    //new users like to place bets in big round numbers, and sometimes bet their entire balance on a single question.
    for (let i in bets) {
        if (bets[i].amount == 1000 || bets[i].amount == 500) {
            evalString += " 2 (Placed a bet of size 1000)";
            noobPoints += 2;
        }
        else if (bets[i].amount % 100 == 0 || bets[i].amount % 250 == 0) {
            evalString += " 1 (Placed bets in multiples of 100)";
            if (noobPoints == 0) { noobPoints++; } //some hacky logic to make sure you don't triple count a string of 100M bets
        }
    }

    //how recent the account is:
    if (theUser.createdTime > clock.getTime() - HOUR * 24) {
        evalString += " 2 (Acct created in the last 24h)";
        noobPoints += 2;
    }
    else if (theUser.profitCached.allTime - theUser.profitCached.daily == 0) {
        evalString += " 2 (has made no trades prior to today)";
        noobPoints += 2;
    }
    else if (theUser.createdTime > clock.getTime() - HOUR * 24 * 7) {
        evalString += " 1 (Acct created in the last week)";
        noobPoints++;
    }

    // some circumstantial Manifold familiarity indicators
    if ((theUser.totalDeposits > 950 && theUser.totalDeposits < 1050) || (theUser.totalDeposits > 1450 && theUser.totalDeposits < 1550)) {
        evalString += " 1 (has starting currentcy amt)";
        noobPoints++;
    }
    if (theUser.creatorVolumeCached.allTime == 0) {
        evalString += " 1 (has made no markets)";
        noobPoints++;
    }

    //return final evaluation
    consoleReport("Evaluated " + theUser.name + ": " + noobPoints + " = " + evalString);

    if (noobPoints > 3) { return 1; }

    else { return noobPoints / 3; }
}

// let deadMarkets = 0;
// while (isBettable(lastMarkets[deadMarkets]) != true) {
//     if (lastMarkets[deadMarkets]) {
//         deadMarkets++;
//     }
// }


let ellipsesDisplay = 0;

export async function huntWhales(cmkts) {


    let currentMarkets = await getAllMarkets();
    let lastMarkets = cmkts;

    if (ellipsesDisplay % 10 == 0) { consoleReport("..."); }
    ellipsesDisplay++;
    let outcomeTypes = [];


    //First, check the state of new market creation
    //they might throw off

    let numNewMarkets = currentMarkets.length - lastMarkets.length;
    let newMarketsToDisplay = numNewMarkets;
    while (newMarketsToDisplay > 0) {
        consoleReport("======");
        consoleReport("New Market: " + currentMarkets[newMarketsToDisplay - 1].question + ": " + dToP(currentMarkets[newMarketsToDisplay - 1].probability));
        newMarketsToDisplay--;
    }

    //console.log(deadMarkets);

    // for (let i = deadMarkets; i < deadMarkets + 10; i++) {
    // for (let i = currentMarkets.length-1; i > numNewMarkets; i--) {

    for (let i = 0; i < lastMarkets.length; i++) {
        let currentMarketLite = currentMarkets[i + numNewMarkets];

        if (currentMarketLite.outcomeType == "BINARY" || currentMarketLite.outcomeType == "PSEUDO_NUMERIC") {
            //the main differnce I note betwen the two market types is renaming probability to just "p". Not implemented yet.
            // let oldP = lastMarkets[i].probability;
            // let newP = currentMarketLite.probability;

            let difference = currentMarketLite.probability - lastMarkets[i].probability;

            if (Math.abs(difference) > .01) {
                consoleReport("-----");
                consoleReport(currentMarketLite.question + ": " + dToP(lastMarkets[i].probability) + " -> " + dToP(currentMarketLite.probability));

                ellipsesDisplay = 0;
                // if (currentMarketLite.question != lastMarkets[i].question) {
                //      writeFile(`/temp/cmarkets_${sanitizeFilename(currentMarketLite.question)}.json`, JSON.stringify(currentMarkets));
                //      writeFile(`/temp/lmarkets_${sanitizeFilename(lastMarkets[i].question)}.json`, JSON.stringify(lastMarkets));
                // }

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

                let marketBets = [];
                let aggregateBets = [];
                let betPlacers = [];

                //simpler logic doesnt work because the fullmarket being fetched is up to date. 
                //You need to consult info on the litemarket

                let probFinal = betToScan.probAfter;
                do {
                    if (!isUnfilledLimitOrder(betToScan) && !betToScan.isRedemption && !(notableUsers[betToScan.userId] === "me")) {
                        marketBets.push(betToScan);
                        //myBet = updatedMkt.bets.find((bid) => { return bid.id == myBetId; });
                        let thisAggregate = aggregateBets.find((b) => { return b.userId == betToScan.userId; });
                        if (thisAggregate === undefined) {
                            thisAggregate = {
                                outcome: "",
                                contractId: betToScan.contractId,
                                userId: betToScan.userId,
                                bettor: "",
                                probBefore: betToScan.probBefore,
                                probAfter: betToScan.probAfter,
                                startTime: betToScan.createdTime,
                                endTime: betToScan.createdTime,
                                trustworthiness: undefined,
                                buyingPower: undefined,
                                bettorAssessment: 0,
                                noobScore: undefined,
                                constituentBets: []
                            };
                            aggregateBets.push(thisAggregate);
                            betPlacers.push(getUserById(betToScan.userId));
                        }
                        else {
                            thisAggregate.probBefore = betToScan.probBefore;
                            thisAggregate.startTime = betToScan.createdTime;
                        }
                        thisAggregate.constituentBets.push(betToScan);
                    }

                    //Afterwards, Move to the next bet
                    if (currentMarket.bets.length <= (++betIndex)) { break; }
                    else { betToScan = currentMarket.bets[betIndex]; }

                    try { betToScan.createdTime }
                    catch (e) {
                        consoleReport("Looking for a bet where there isn't one, check the following outputs:");

                        console.log(betIndex);
                        console.log(betToScan);
                    }

                } while (
                    (marketBets.length === 0 || betToScan.createdTime > marketBets[marketBets.length - 1].createdTime - (1000 * 60 * 5))
                    && (!(notableUsers[betToScan.userId] == "me" && !betToScan.isRedemption)));

                let probStart = betToScan.probAfter;
                if (marketBets.length === 0) { probStart = betToScan.probBefore; }


                //analyze the aggbets.//if theres only one, most of this is unneccesary.

                for (let i in aggregateBets) {

                    if (aggregateBets[i].probBefore > aggregateBets[i].probAfter) { aggregateBets[i].outcome = "" + "NO"; }
                    if (aggregateBets[i].probBefore < aggregateBets[i].probAfter) { aggregateBets[i].outcome = "" + "YES"; }


                    //if it's a "NO" bet
                    if (aggregateBets[i].outcome === 'NO') {

                        //any big swings may be an illusion if they haven't brought the price any lower than it was at the start of the latest flurry of bets
                        if (aggregateBets[i].probBefore > probStart) {
                            aggregateBets[i].probBefore = probStart;
                        }
                        //or if the movement has since been reversed, probably by other bots, maybe from wash trading.
                        if (aggregateBets[i].probAfter < probFinal) {
                            aggregateBets[i].probAfter = probFinal;
                        }

                    }
                    //visa versa the above
                    else if (aggregateBets[i].outcome === 'YES') {

                        if (aggregateBets[i].probBefore < probStart) {
                            aggregateBets[i].probBefore = probStart;
                        }

                        if (aggregateBets[i].probAfter > probFinal) {
                            aggregateBets[i].probAfter = probFinal;
                        }
                    }

                    if (notableUsers[aggregateBets[i].userId] !== "v") {
                        //velocity's bets should be ignored. 

                        let bettor = getUserById(aggregateBets[i].userId);
                        //consoleReport("counterparty buying power: " + dToP(aggregateBets[i].buyingPower));
                        aggregateBets[i].buyingPower = discountDoublings(aggregateBets[i]);
                        bettor = await bettor;
                        aggregateBets[i].trustworthiness = isMarketLegit(currentMarket, bettor); //returns value from zero to one;
                        aggregateBets[i].bettor = bettor.name;
                        aggregateBets[i].noobScore = wasThisBetPlacedByANoob(bettor, aggregateBets[i].constituentBets) //returns value from zero to one;
                        aggregateBets[i].bettorAssessment = assessTraderSkill(bettor, aggregateBets[i].constituentBets, currentMarket); //returns est. of average daily profits
                        if (aggregateBets[i].noobScore == 1 && aggregateBets[i].bettorAssessment > 1) { aggregateBets[i].bettorAssessment /= 3.5; }
                    }
                }

                for (let i in aggregateBets) {
                    if (notableUsers[aggregateBets[i].userId] !== "v") {
                        let betDifference = 0
                        if (aggregateBets[i].outcome === 'YES' && aggregateBets[i].probBefore > aggregateBets[i].probAfter) {
                            betDifference = 0;
                        }
                        else if (aggregateBets[i].outcome === 'NO' && aggregateBets[i].probBefore < aggregateBets[i].probAfter) {
                            betDifference = 0;
                        }
                        else {
                            betDifference = aggregateBets[i].probAfter - aggregateBets[i].probBefore;
                        }


                        aggregateBets[i].constituentBets = [];
                        console.log(aggregateBets[i]);

                        if (notableUsers[aggregateBets[i].userId] !== "v") {
                            for (let j in aggregateBets) {
                                if ((aggregateBets[i].outcome === aggregateBets[j].outcome
                                    && aggregateBets[i].outcome === "NO"
                                    && aggregateBets[i].probAfter > aggregateBets[j].probAfter)
                                    || (aggregateBets[i].outcome === aggregateBets[j].outcome
                                        && aggregateBets[i].outcome === "YES"
                                        && aggregateBets[i].probAfter < aggregateBets[j].probAfter)) {

                                    if (aggregateBets[i].noobScore > aggregateBets[j].noobScore) {
                                        aggregateBets[i].noobScore = aggregateBets[j].noobScore;
                                    }
                                    if (aggregateBets[j].bettorAssessment > aggregateBets[i].bettorAssessment) {
                                        aggregateBets[i].bettorAssessment = aggregateBets[j].bettorAssessment;
                                    }
                                    if (aggregateBets[j].noobScore < aggregateBets[i].noobScore) {
                                        aggregateBets[i].noobScore = aggregateBets[j].noobScore;
                                    }

                                }
                                //if this guys trades got buttressed my Beshir trades in the middle of a climb
                            }
                        }


                        consoleReport("prob difference: " + dToP(difference) + ", bet difference: " + dToP(betDifference));

                        if (Math.abs(betDifference) >= MIN_P_MOVEMENT) {
                            let betAlpha = desiredAlpha;
                            let shouldPlaceBet = 0;

                            shouldPlaceBet = aggregateBets[i].noobScore;
                            if (shouldPlaceBet > 1) { shouldPlaceBet = 1; }
                            if (aggregateBets[i].bettorAssessment < 0 && aggregateBets[i].bettorAssessment >= -0.2) { shouldPlaceBet += .5 }
                            if (aggregateBets[i].bettorAssessment < -0.2) { shouldPlaceBet += 1 }
                            shouldPlaceBet *= aggregateBets[i].trustworthiness;

                            //shouldPlaceBet*= aggregateBets[i].buyingPower;
                            //if other changes elsewhere are inadequate
                            if (shouldPlaceBet > 0.4) { shouldPlaceBet *= aggregateBets[i].buyingPower; }

                            betAlpha = (desiredAlpha + (-1 * aggregateBets[i].bettorAssessment)) / 2
                            betAlpha *= aggregateBets[i].trustworthiness; //add somethign for user skill
                            if (betAlpha < 0) { betAlpha = 0; }

                            consoleReport("should I bet?\t| alpha sought\t| noobScore\t| bettorskill\t| trustworthy?\t| buyingPower");
                            consoleReport(roundToPercent(shouldPlaceBet) + "\t\t| "
                                + roundToPercent(betAlpha) + "\t\t| "
                                + roundToPercent(aggregateBets[i].noobScore) + "\t\t| "
                                + roundToPercent(aggregateBets[i].bettorAssessment) + "\t\t| "
                                + roundToPercent(aggregateBets[i].trustworthiness) + "\t\t| "
                                + roundToPercent(aggregateBets[i].buyingPower));

                            if (shouldPlaceBet < 1 && !(settings.mode == "dry-run-w-mock-betting")) {
                                // if (bettorAssessment == "insider") {
                                //     console.log("bet placer created the market: " + (await getUserById(aggregateBets[i].userId)).name);
                                // }
                                // else {
                                //     console.log("bet placer seems to know what he's doing: " + (await getUserById(aggregateBets[i].userId)).name);
                                // }
                                return;
                            }

                            let bet = {
                                contractId: `${currentMarket.id}`,
                                outcome: null,
                                amount: 100,
                                limitProb: null
                            }

                            //also prepare the limit order to liquidate it.
                            let sellBet = {
                                contractId: `${currentMarket.id}`,
                                outcome: null,
                                amount: 0,
                                limitProb: null
                            }

                            let recoveredSpan = Math.abs(betDifference) * (betAlpha);
                            if (Math.abs(betDifference) < MIN_P_MOVEMENT) {
                                recoveredSpan = Math.abs(betDifference) * (betAlpha / 2);
                                bet.amount = 100;
                            }
                            if (betDifference < 0) {
                                bet.outcome = "YES";
                                bet.limitProb = currentMarket.probability + recoveredSpan;
                            }
                            else {
                                bet.outcome = "NO";
                                bet.limitProb = currentMarket.probability - recoveredSpan;
                            }
                            bet.limitProb = roundToPercent(bet.limitProb);

                            if (settings.mode == "dry-run" || settings.mode == "dry-run-w-mock-betting" || settings.mode == "bet") {
                                consoleReport("Betting against " + aggregateBets[i].bettor + " (" + aggregateBets[i].bettorAssessment + ") on " + currentMarket.question + " (" + currentMarket.probability + ")");
                                console.log(bet);
                                let myBet = null;

                                if (settings.mode == "bet") {
                                    let myBetId = (await placeBet(bet).then((resjson) => { console.log(resjson); cancelBet(resjson.betId); return resjson; })).betId;
                                    let updatedMkt = await getFullMarket(currentMarketLite.id);
                                    myBet = updatedMkt.bets.find((bid) => { return bid.id == myBetId; });

                                    // consoleReport("bet id: " + myBetId + ", latest bets on updated market: ");
                                    // for (let j = 0; j < 3; j++) {
                                    //     console.log(updatedMkt.bets[j]);
                                    // }

                                }
                                else if (settings.mode == "dry-run" || settings.mode == "dry-run-w-mock-betting") {
                                    myBet = bet;
                                    myBet.probAfter = myBet.limitProb;
                                    myBet.shares = myBet.amount / myBet.limitProb;
                                }

                                if (myBet.outcome == "NO") {
                                    sellBet.outcome = "YES";
                                    sellBet.limitProb = roundToPercent(aggregateBets[i].probBefore + ((myBet.limitProb - aggregateBets[i].probBefore) / 4));
                                    sellBet.amount = roundToPercent(myBet.shares * sellBet.limitProb);

                                }
                                else if (myBet.outcome == "YES") {
                                    sellBet.outcome = "NO";
                                    sellBet.limitProb = roundToPercent(aggregateBets[i].probBefore - ((aggregateBets[i].probBefore - myBet.limitProb) / 4));
                                    sellBet.amount = roundToPercent(myBet.shares * (1 - sellBet.limitProb));
                                }

                                if (settings.mode == "bet" ) { //&& !currentMarket.question.includes("Will we fund ")
                                    await placeBet(sellBet).then((resjson) => { console.log(resjson); });
                                }
                                else if (settings.mode == "dry-run" || settings.mode == "dry-run-w-mock-betting") {
                                    console.log(sellBet);
                                }

                            }
                        }
                    }

                }
            }



        } else if (currentMarketLite.outcomeType == "FREE_RESPONSE") {

        } else if (currentMarketLite.outcomeType == "MULTIPLE_CHOICE") {

        } else if (currentMarketLite.outcomeType == "NUMERIC") {

        } else {
            if (outcomeTypes.length == 0 || outcomeTypes.find((a) => { return (a == currentMarketLite.outcomeType); }) == undefined) {
                outcomeTypes.push(currentMarketLite.outcomeType);
                console.log(currentMarketLite.outcomeType);
            }
        }
    }




    return currentMarkets;

}


