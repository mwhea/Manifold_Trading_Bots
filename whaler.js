import {
    getAllMarkets,
    getUserById,
    getFullMarket,
    placeBet,
    cancelBet,
    latestBets,
    getAllUsers
} from './api.js';

import 'dotenv/config'
import {
    readFile
} from 'fs/promises';

import {
    dToP,
    discountDoublings,
    roundToPercent,
    consoleReport,
    isUnfilledLimitOrder,
    sleep
} from './utility_functions.js';

const HOUR = 60 * 60 * 1000;
const MIN_P_MOVEMENT = .0375;

export class Whaler {

    constructor(whalerSettings) {
        this.settings = whalerSettings;

        this.notableUsers = readFile(new URL('./notableUsers.json', import.meta.url));

        this.currentMarkets = undefined;
        this.lastMarkets = undefined;

        this.cachedUsers = [];
        this.allUsers = [];
        this.allMarkets = [];
        this.recentMarkets = [];

        this.lastScannedBet = undefined;

        this.clock = new Date();
        this.ellipsesDisplay = 0;

    }

    async additionalConstruction() {
        this.notableUsers = JSON.parse(await this.notableUsers);

        this.allUsers = getAllUsers();

        this.lastScannedBet = (await latestBets(1))[0].id;

        this.allUsers = await this.allUsers;

    }

    binarySearchUser(id) {
        let start = 0;
        let end = this.allUsers.length - 1;
        let middle;

        while (start <= end) {
            middle = Math.floor((start + end) / 2);

            if (this.allUsers[middle].id === id) {
                // found the key
                return this.allUsers[middle];
            } else if (this.allUsers[middle].id < id) {
                // continue searching to the right
                start = middle + 1;
            } else {
                // search searching to the left
                end = middle - 1;
            }
        }

        // key wasn't found. Print the environs it searched in to ensure the search is working properly.
        
        console.log("User wasn't found")
        console.log(this.allUsers[end - 1].id)
        console.log(this.allUsers[end].id)
        console.log(this.allUsers[end + 1].id)

        return undefined;
    }

    sortUserList() {
        this.allUsers = this.allUsers.sort((a, b) => {
            if (a.id < b.id) { return -1; }
            if (a.id > b.id) { return 1; }
            return 0;
        });
    }

    isMarketLegit(mkt, bettor) {

        let returnVal = 1;

        //don't bet agains tthe market creator on their own market. Insider trading or market manipulation.
        if (mkt.creatorId == bettor.id) {
            //exclude some trustworthy market creators
            if (!(
                this.notableUsers[mkt.creatorId] == "BTE"
                || this.notableUsers[mkt.creatorId] == "BTEF2P"
            )) {
                returnVal -= .75;
            }
        }

        //If a new user has an extreme profits total they're no doubt a sockpuppet up to schenanigans and should be avoided.
        if (Math.abs(bettor.profitCached.allTime) > 1500 && bettor.createdTime + ((HOUR * 24 * 3)) > this.clock.getTime()) {
            returnVal -= 300;
        }

        if (mkt.createdTime > this.clock.getTime() - ((HOUR / 60 * 10))) {
            returnVal -= .25;
        };

        //it's probably not a manipulated market if it has lots of unique traders.
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

        //The following users have the expertise or inclination to exploit a bot.
        if (this.notableUsers[bettor.id] == "Yev"
            || this.notableUsers[bettor.id] == "NotMyPresident") {
            returnVal -= .25;
        }
        if (this.notableUsers[mkt.creatorId] == "Yev"
            || this.notableUsers[mkt.creatorId] == "Spindle"
            || this.notableUsers[mkt.creatorId] == "NotMyPresident"
            || this.notableUsers[mkt.creatorId] == "Gurkenglas") {
            returnVal -= .25;
        }

        consoleReport("Assessed safety from market manipulation or insider trading: " + returnVal);

        if (returnVal < 0) { return 0; }
        else if (returnVal > 1) { return 1; }
        else { return returnVal; }

    }

    assessTraderSkill(bettor, bets, mkt) {

        let evalString = "Evaluated skill of " + bettor.name;

        //special logic for specific users whose trading patterns I know:
        //BTE has lots of funds and impulsively places large bets which the larger market doesn't agree with, so he's perfect for market making.
        if (this.notableUsers[bettor.id] == "BTE") {
            return -0.2;
        }

        if (bettor.id == mkt.creatorId) {
            let bettorAssessment = "insider";
        }

        let dailyProfits = (bettor.profitCached.allTime) / ((this.clock.getTime() - bettor.createdTime) / (HOUR * 24));

        if (this.clock.getTime() - bettor.createdTime > HOUR * 24 * 30) {

            evalString += ", daily profits (all): " + roundToPercent(dailyProfits)
                + ", daily profits (monthly): " + roundToPercent((bettor.profitCached.monthly / 30));

            dailyProfits = (dailyProfits + (bettor.profitCached.monthly / 30)) / 2;

        };

        evalString += ", daily profits (averaged): " + roundToPercent(dailyProfits);

        let profitsCalibrated = 0;

        // I didn't have time to work out a formula to appropriately map the outputs from =1 to 1,
        // so here's a series of if statements
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

        //Reduce confidence when evaluating skill of very new accounts
        if (((this.clock.getTime() - bettor.createdTime) / (HOUR * 24) < 1)) {
            profitsCalibrated /= 5;
        }
        else if (((this.clock.getTime() - bettor.createdTime) / (HOUR * 24) < 7)) {
            profitsCalibrated /= 2;
        }

        evalString += ", daily profits (calibrated): " + profitsCalibrated;
        consoleReport(evalString);

        return profitsCalibrated;

    }

    wasThisBetPlacedByANoob(user, bets) {

        let theUser = user;
        let noobPoints = 0;
        let evalString = ""

        //how recent the account is:
        if (theUser.createdTime > this.clock.getTime() - HOUR * 24) {
            evalString += " 2 (Acct created in the last 24h)";
            noobPoints += 2;
        }
        else if (theUser.profitCached.allTime - theUser.profitCached.daily == 0) {
            evalString += " 2 (has made no trades prior to today)";
            noobPoints += 2;
        }
        else if (theUser.createdTime > this.clock.getTime() - HOUR * 24 * 7) {
            evalString += " 1 (Acct created in the last week)";
            noobPoints++;
        }

        //new users like to place bets in big round numbers, and sometimes bet their entire balance on a single question.
        for (let i in bets) {
            if (bets[i].amount == 1000 || bets[i].amount == 500) {
                evalString += " 2 (Placed a bet of size 1000)";
                if (noobPoints == 0) { noobPoints += 2; }
            }
            else if (bets[i].amount % 100 == 0 || bets[i].amount % 250 == 0) {
                evalString += " 1 (Placed bets in multiples of 100)";
                if (noobPoints == 0) { noobPoints += 1; } //some hacky logic to make sure you don't triple count a string of 100M bets
            }
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

    async detectChanges() {

        if (this.ellipsesDisplay % 10 == 0) { consoleReport("..."); }
        this.ellipsesDisplay++;

        let changedMarkets = [];
        let changedMarketsFull = [];

        let newBets = [];

        try {
            newBets = await latestBets(4);

            // let incomingMarkets = await getAllMarkets();
            // this.lastMarkets = this.currentMarkets;
            // this.currentMarkets = incomingMarkets;
        }
        catch (e) {
            console.log(e);
            return;
        }

        let indexOfLastScan = undefined;

        for (let i = 0; i < newBets.length - 1; i++) {
            if (newBets[i].id === this.lastScannedBet) {
                indexOfLastScan = i;
            }
        }

        if (indexOfLastScan === undefined) {
            try {
                newBets = await latestBets(40);
                for (let i = 0; i < newBets.length - 1; i++) {
                    if (newBets[i].id === this.lastScannedBet) {
                        indexOfLastScan = i;
                    }
                }
                if (indexOfLastScan === undefined) {
                    throw new Error("lastbet still not found");
                }
            }
            catch (e) {
                console.log("NewBets collection RERUN fiailed");
                console.log(e);
                return;
            }

        }

        for (let i = indexOfLastScan - 1; i >= 0; i--) {

            if (newBets[i].outcome === "YES" || newBets[i].outcome === "NO") {
                let parentMarket = this.recentMarkets.find((m) => { return (newBets[i].contractId === m.id); });
                if (parentMarket === undefined) {
                    do {
                        try {
                            parentMarket = await getFullMarket(newBets[i].contractId);
                        }
                        catch (e) {
                            console.log(e);
                            await sleep(5000);
                        }
                    } while (parentMarket === undefined)
                    this.recentMarkets.unshift(parentMarket);
                }
                else {
                    parentMarket.bets.unshift(newBets[i]);
                    parentMarket.probability = newBets[i].probAfter;
                }

                if (!isUnfilledLimitOrder(newBets[i])
                    && !newBets[i].isRedemption
                    && !(this.notableUsers[newBets[i].userId] === "v")
                ) {
                    if (changedMarkets.find((e) => { e === newBets[i].contractId }) === undefined) {
                        changedMarkets.push(newBets[i].contractId);
                        changedMarketsFull.push(parentMarket);
                    }
                }
            }

        }

        // // First, check the state of new market creation, print them to the console for the operator's benefit
        // // otherwise they might throw off comparisons between market lists

        // let numNewMarkets = this.currentMarkets.length;
        // numNewMarkets -= this.lastMarkets.length;
        // let newMarketsToDisplay = numNewMarkets;
        // while (newMarketsToDisplay > 0) {
        //     consoleReport("======");
        //     consoleReport("New Market: " + this.currentMarkets[newMarketsToDisplay - 1].question + ": " + dToP(this.currentMarkets[newMarketsToDisplay - 1].probability));
        //     newMarketsToDisplay--;
        // }

        //console.log("latest bet: " + newBets[0].id + ", last scanned: " + this.lastScannedBet);

        this.lastScannedBet = newBets[0].id;

        return changedMarketsFull;

    }

    async huntWhales() {

        let marketsToInspect = await this.detectChanges();

        for (let i in marketsToInspect) {

            let betToScan = {};
            let betIndex = 0;

            let marketBets = [];
            let aggregateBets = [];
            let betPlacers = [];

            let currentMarket = marketsToInspect[i];

            this.ellipsesDisplay = 0;

            try {
                betToScan = currentMarket.bets[betIndex];
            }
            catch (e) {
                console.log(e);
                console.log(currentMarket);
            }

            let inactivityCutoff = this.clock.getDate() - (1000 * 60 * 5);

            //we'll need to record the present state of the market, 
            //and the LiteMarket fetched a few moments ago may already be obsolete
            let probFinal = betToScan.probAfter;

            //analyzing a bet history is difficult to do programmatically
            //to help, we're converting it into an intermediary: "aggregate bets" 
            //which helps our program not get confused by situations such as:
            // -strings of consecutive bets
            // -wash trading
            // -bets that other traders have already bet against
            //For each trader, an aggregate bet is a single imaginary bet made from the 
            //lowest to highest prices they bought at during the last period of activity.
            //limited to the range of the total price movement observed
            while (
                // we collect bets not since the last run of this function, but in fact since the last period of inactivity
                // (we don't want to miss an increase in price gradual enough that no one run of this function deems it noteworthy)
                // we also stop at our last bet on the assumption that we successfully corrected the price. (not perfect behaviour, but fine for now)
                // in the future we will also stop at the last bet by a high-skill trader.
                (betToScan.createdTime > inactivityCutoff)
                && (!(this.notableUsers[betToScan.userId] == "me" && !betToScan.isRedemption))
            ) {
                if ( //don't collect the following types of bets
                    !isUnfilledLimitOrder(betToScan)
                    && !betToScan.isRedemption
                    && !(this.notableUsers[betToScan.userId] === "me")
                    && !(this.notableUsers[betToScan.userId] === "v")
                ) {
                    marketBets.push(betToScan);
                    inactivityCutoff = betToScan.createdTime - (1000 * 60 * 5);
                    // find/create the appropriate aggregate to add this to
                    // we're deciding who to bet against in part based on user characteristics, so each user's
                    // bets are aggregated separately
                    let thisAggregate = aggregateBets.find((b) => { return b.userId === betToScan.userId; });
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

                        thisAggregate.bettor = this.binarySearchUser(betToScan.userId);
                        if (thisAggregate.bettor === undefined) {
                            this.allUsers.push(await getUserById(betToScan.userId));
                            this.sortUserList();
                            thisAggregate.bettor = this.binarySearchUser(betToScan.userId);
                        }

                        aggregateBets.push(thisAggregate);
                        betPlacers.push(getUserById(betToScan.userId));
                    }
                    else {
                        thisAggregate.probBefore = betToScan.probBefore;
                        thisAggregate.startTime = betToScan.createdTime;
                    }
                    thisAggregate.constituentBets.push(betToScan);
                }

                //Afterwards, move to the next bet and check it against our while condition
                if (currentMarket.bets.length <= (++betIndex)) { break; }
                else { betToScan = currentMarket.bets[betIndex]; }

                try { betToScan.createdTime }
                catch (e) {
                    consoleReport("Looking for a bet where there isn't one, check the following outputs:");
                    console.log(betIndex);
                    console.log(betToScan);
                }

            }

            //now that we've collected a bet that does't qualify for analysis, 
            //we can take its probafter as the "baseline price" prior to the last flurry of betting
            let probStart = betToScan.probAfter;

            if (marketBets.length === 0) { probStart = betToScan.probBefore; }

            consoleReport("-----");
            consoleReport(currentMarket.question + ": " + dToP(probStart) + " -> " + dToP(currentMarket.probability));

            //post-process the aggbets.
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
                    //when this successfully catches misleading/illusory NO bets, it manifests as a very confusing 
                    //output: a NO bet that increases the price, you'll want to add something that clarifies
                    //so bot operators reading the logs understand what they're looking at
                    //but the following doesn't work just yet cause even negated bets are useful for some later calculations
                    //if (aggregateBets[i].probBefore <= aggregateBets[i].probAfter) { aggregateBets[i].outcome = "NEGATED"; }
                }
                //visa versa the above
                else if (aggregateBets[i].outcome === 'YES') {

                    if (aggregateBets[i].probBefore < probStart) {
                        aggregateBets[i].probBefore = probStart;
                    }

                    if (aggregateBets[i].probAfter > probFinal) {
                        aggregateBets[i].probAfter = probFinal;
                    }
                    //if (aggregateBets[i].probBefore >= aggregateBets[i].probAfter) { aggregateBets[i].outcome = "NEGATED"; }
                }
            }

            //analyze the aggbets
            for (let i in aggregateBets) {

                //let bettor = getUserById(aggregateBets[i].userId);
                aggregateBets[i].buyingPower = discountDoublings(aggregateBets[i]);

                let bettor = aggregateBets[i].bettor;

                aggregateBets[i].bettor = bettor.name;
                aggregateBets[i].trustworthiness = this.isMarketLegit(currentMarket, bettor); //returns value from zero to one;
                aggregateBets[i].noobScore = this.wasThisBetPlacedByANoob(bettor, aggregateBets[i].constituentBets) //returns value from zero to one;
                aggregateBets[i].bettorAssessment = this.assessTraderSkill(bettor, aggregateBets[i].constituentBets, currentMarket); //returns value from -1 to +1
                if (aggregateBets[i].noobScore == 1 && aggregateBets[i].bettorAssessment > 1) { aggregateBets[i].bettorAssessment /= 3.5; }

                aggregateBets[i].constituentBets = [];
                console.log(aggregateBets[i]);

                let betDifference = 0
                //if the bet hasn't been totally negated by other price movements
                if (!((aggregateBets[i].outcome === 'NO' && aggregateBets[i].probBefore <= aggregateBets[i].probAfter)
                    || (aggregateBets[i].outcome === 'YES' && aggregateBets[i].probBefore >= aggregateBets[i].probAfter))) {

                    betDifference = aggregateBets[i].probAfter - aggregateBets[i].probBefore;

                    // proxies for user skill can't be less than those of anyone who made that trade at a worse price,
                    // who has implicitly vouched for the trade. The "Beshir anchor"
                    for (let j in aggregateBets) {
                        if ((aggregateBets[i].outcome === aggregateBets[j].outcome
                            && aggregateBets[i].outcome === "NO"
                            && aggregateBets[i].probAfter > aggregateBets[j].probAfter)
                            || (aggregateBets[i].outcome === aggregateBets[j].outcome
                                && aggregateBets[i].outcome === "YES"
                                && aggregateBets[i].probAfter < aggregateBets[j].probAfter)) {
                            if (aggregateBets[j].bettorAssessment > aggregateBets[i].bettorAssessment) {
                                aggregateBets[i].bettorAssessment = aggregateBets[j].bettorAssessment;
                            }
                            if (aggregateBets[j].noobScore < aggregateBets[i].noobScore) {
                                aggregateBets[i].noobScore = aggregateBets[j].noobScore;
                            }
                            if (aggregateBets[j].trustworthiness < aggregateBets[i].trustworthiness) {
                                aggregateBets[i].trustworthiness = aggregateBets[j].trustworthiness;
                            }
                        }
                    }
                }

                // consoleReport("prob difference: " + dToP(difference) + ", bet difference: " + dToP(betDifference));
                consoleReport("bet difference: " + dToP(betDifference));

                if (Math.abs(betDifference) >= MIN_P_MOVEMENT) {
                    let betAlpha = this.settings.desiredAlpha;
                    let shouldPlaceBet = 0;

                    shouldPlaceBet = aggregateBets[i].noobScore;
                    if (aggregateBets[i].bettorAssessment < -0.1) { shouldPlaceBet += 1 }
                    else if (aggregateBets[i].bettorAssessment <= 0.2) { shouldPlaceBet += .67 }
                    else if (aggregateBets[i].bettorAssessment <= 0.4) { shouldPlaceBet += .2 }
                    shouldPlaceBet *= aggregateBets[i].trustworthiness;
                    //this needs to be capped because otherwise it's possible to bait the bot with illusory Pascal's Wagers
                    if (aggregateBets[i].buyingPower > 2.5) { aggregateBets[i].buyingPower = 2.5 }
                    shouldPlaceBet *= aggregateBets[i].buyingPower;

                    betAlpha = (this.settings.desiredAlpha + (-aggregateBets[i].bettorAssessment)) / 2
                    betAlpha *= aggregateBets[i].trustworthiness * aggregateBets[i].trustworthiness;
                    if (betAlpha < 0) { betAlpha = 0; }

                    consoleReport("should I bet?\t| alpha sought\t| noobScore\t| bettorskill\t| trustworthy?\t| buyingPower");
                    consoleReport(roundToPercent(shouldPlaceBet) + "\t\t| "
                        + roundToPercent(betAlpha) + "\t\t| "
                        + roundToPercent(aggregateBets[i].noobScore) + "\t\t| "
                        + roundToPercent(aggregateBets[i].bettorAssessment) + "\t\t| "
                        + roundToPercent(aggregateBets[i].trustworthiness) + "\t\t| "
                        + roundToPercent(aggregateBets[i].buyingPower));

                    if ((shouldPlaceBet >= 1 && betAlpha * Math.abs(betDifference) * aggregateBets[i].buyingPower > 0.01) || this.settings.mode == "dry-run-w-mock-betting") {

                        let bet = {
                            contractId: `${currentMarket.id}`,
                            outcome: null,
                            amount: 100,
                            limitProb: null
                        }

                        let recoveredSpan = Math.abs(betDifference) * (betAlpha);

                        if (betDifference < 0) {
                            bet.outcome = "YES";
                            bet.limitProb = currentMarket.probability + recoveredSpan;
                        }
                        else {
                            bet.outcome = "NO";
                            bet.limitProb = currentMarket.probability - recoveredSpan;
                        }
                        bet.limitProb = roundToPercent(bet.limitProb);

                        if (this.settings.mode == "dry-run" || this.settings.mode == "dry-run-w-mock-betting" || this.settings.mode == "bet") {
                            consoleReport("Betting against " + aggregateBets[i].bettor + " (" + aggregateBets[i].bettorAssessment + ") on " + currentMarket.question + " (" + currentMarket.probability + ")");
                            console.log(bet);
                            let myBetId = undefined;

                            if (this.settings.mode == "bet") {
                                bet.id = (await placeBet(bet).then((resjson) => {
                                    console.log(resjson); cancelBet(resjson.betId); return resjson;
                                })).betId;
                                // if you put the liquidation order in a then, you can reduce some latency
                            }
                            else if (this.settings.mode == "dry-run" || this.settings.mode == "dry-run-w-mock-betting") {
                                bet.probAfter = bet.limitProb;
                                bet.shares = bet.amount / bet.limitProb;
                            }

                            //also prepare a limit order to liquidate it.
                            if (this.settings.autoLiquidate) {
                                this.placeLiquidationOrder(bet, probStart);
                            }
                        }
                    }
                }
            }
        }
    }

    async placeLiquidationOrder(bet, startingPoint) {

        let myBet = bet;
        console.log(myBet);
        if (this.settings.mode === "bet") {
            try {
                let updatedMkt = await latestBets(10);;
                myBet = updatedMkt.find((b) => { return b.id === myBet.id; });
            }
            catch (e) {
                console.log(e);
                consoleReport("Getting updated bet info for liquidation bet failed. cancelling liquidation bet.");
                return;
            }
        }

        let sellBet = {
            contractId: `${myBet.contractId}`,
            outcome: null,
            amount: 0,
            limitProb: null
        }

        if (myBet.outcome === "NO") {
            sellBet.outcome = "YES";
            sellBet.limitProb = roundToPercent(startingPoint + ((myBet.limitProb - startingPoint) / 4));
            sellBet.amount = roundToPercent(myBet.shares * sellBet.limitProb);

        }
        else if (myBet.outcome === "YES") {
            sellBet.outcome = "NO";
            sellBet.limitProb = roundToPercent(startingPoint - ((startingPoint - myBet.limitProb) / 4));
            sellBet.amount = roundToPercent(myBet.shares * (1 - sellBet.limitProb));
        }

        if (this.settings.mode === "bet") {
            await placeBet(sellBet).then((resjson) => { console.log(resjson); });
        }
        else if (this.settings.mode === "dry-run" || this.settings.mode === "dry-run-w-mock-betting") {
            console.log(sellBet);
        }

    }

}