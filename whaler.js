import {
    fetchUserById,
    fetchFullMarket,
    placeBet,
    cancelBet,
    latestBets,
    fetchUsersBets
} from './api.js';

import {
    readFile
} from 'fs/promises';

import { Logger } from "./Logger.js";
import { CacheManager } from "./CacheManager.js";

import 'dotenv/config'

import {
    dToP,
    discountDoublings,
    roundToPercent,
    isUnfilledLimitOrder,
    sleep
} from './utility_functions.js';

import {
    DANGEROUS,
    HIGHLY_DANGEROUS,
    THIS_BOT,
    RIVAL_BOT,
    ACC,
    SAFE,
    getUserTrait,
    checkUserTrait
} from "./notableUsers.js"

//Constants
import {SECOND, MINUTE, HOUR, DAY} from "./timeWords.js";
import { UT_THRESHOLD } from "./CacheManager.js"



const MIN_P_MOVEMENT = .0375;
const CACHING_DURATION = 15000;
const OUTGOING_LIMIT = 3500;
//speeds: (run every n milliseconds)
const HYPERDRIVE = 10;
const FAST = 50;
const NORMAL = 250;
const LEISURELY = 1000;

/**
 * The Whaler bot detects large, misjudged trades by "noobs" or "trolls," 
 * and attempts to take the other side of those trades with as little delay as possible.
 */
export class Whaler {

    constructor(whalerSettings) {
        this.log = new Logger("whaler");
        this.cache = new CacheManager(this.log);

        this.settings = whalerSettings;
        this.adjustedSpeed = this.settings.speed;

        this.lastScannedBet = undefined;

        this.clock = new Date();
        this.ellipsesDisplay = 0;
        this.timeOfLastScan = this.clock.getDate();
        this.timeOfLastBackup = this.clock.getDate();
        this.timeOfLastBet = undefined;

        this.safeguards = {
            "runStartedAt": this.clock.getDate(),
            "moneySpent": 0,
            "betsPlaced": []
        };

        this.limitOrderQueue = [];

    }

    /**
     * To my knowledge there's no straighforward way to use asynchronous methods in a constructor, 
     * so this method is meant to be called after the constuctor to perform any additional construction making used of asynchronous functions
     */
    async additionalConstruction() {

        let isCacheFull = this.cache.fillCaches();

        this.lastScannedBet = (await latestBets(1))[0].id;

        await isCacheFull;

        this.performMaintenance();

    }

    getSpeed() {
        return this.adjustedSpeed;
    } 

    /**
     * This method evaluates the likelihood that a given market is not entirely on the level. 
     * It's meant to warn against insider traders or a deliberate trap being laid for bots.
     * @param {*} mkt 
     * @param {*} bettor 
     * @returns a value from negative infinity to one: with one being near-assured safety, and negative numbers indicating active danger.
     */
    isMarketLegit(mkt, bettor) {

        let returnVal = 1;
        let time = new Date();
        let searchLog = "Assessed safety from market manipulation or insider trading: 1";

        //don't bet against the market creator on their own market. Insider trading or market manipulation.
        if (mkt.creatorId === bettor.id) {
            //exclude some trustworthy market creators
            if (!(checkUserTrait(bettor.id, "insiderTradingRisk", SAFE))) {
                searchLog += " - 0.75 (insider trading)"
                returnVal -= .75;
            }
        }

        //If a new user has an extreme profits total they're no doubt a sockpuppet up to schenanigans and should be avoided.
        if (Math.abs(bettor.profitCached.allTime) > 1500 && bettor.createdTime + ((HOUR * 24 * 3)) > time.getTime()) {
            searchLog += " - 300"
            returnVal -= 300;
        }
        //it's probably not a manipulated market if it has lots of unique traders.
        if (mkt.uniqueTraders.length < UT_THRESHOLD && mkt.uniqueTraders.find((o) => { return o === bettor.id; }) === undefined) {
            mkt.uniqueTraders.push(bettor.id);
        }

        let socialProofAdjustment = (mkt.uniqueTraders.length * 0.05) - .35;
        if (mkt.uniqueTraders.length > UT_THRESHOLD) { socialProofAdjustment = (UT_THRESHOLD * 0.05) - .35; }
        if (socialProofAdjustment >= 0) { searchLog += " + " + roundToPercent(socialProofAdjustment); }
        else { searchLog += " - " + roundToPercent(Math.abs(socialProofAdjustment)); }
        searchLog += " (num unique traders)";
        returnVal += socialProofAdjustment;

        //Minimal weight is placed on market age
        //since someone exploiting a bot can just such a market sit fallow for a while first
        //but it's so inconvenient to do so age can work as a minor indicator
        if (mkt.createdTime > time.getTime() - ((DAY * 45))) {
            searchLog +=" - 0.15 (age)";
            returnVal -= .15;
        }

        //The following users have the expertise or inclination to exploit a bot.
        if (checkUserTrait(bettor.id, "user", HIGHLY_DANGEROUS)) {
        searchLog += " - 0.99 (extremely dangerous users)";
        returnVal -= .99;
    }
        else if (checkUserTrait(bettor.id, "user", DANGEROUS)) {
            searchLog += " - 0.25 (dangerous users)";
            returnVal -= .25;
        }
        if (checkUserTrait(bettor.id, "creator", HIGHLY_DANGEROUS)) {
            searchLog += " - 0.66 (extremely dangerous creators)";
            returnVal -= .66;
        }
        else if (checkUserTrait(bettor.id, "creator", DANGEROUS)
        ) {
            searchLog += " - 0.25 (dangerous creators)";
            returnVal -= .25;
        }

        this.log.write(searchLog + " = " + roundToPercent(returnVal));

        if (returnVal < 0) { return 0; }
        else if (returnVal > 1) { return 1; }
        else { return returnVal; }

    }

    /**
     * Assess how skilled a trader is.
     * @param {*} bettor the user to be evaluated
     * @param {*} bets an array of all the related bets which we're considering reacting to.
     * @param {*} mkt 
     * @returns 
     */
    assessTraderSkill(bettor, bets, mkt) {

        let evalString = "Evaluated skill of " + bettor.name;

        let skillOverride = getUserTrait(bettor.id, "skillOverride")
        if (skillOverride!==undefined) {
            return skillOverride;
        }

        let dailyProfits = (bettor.profitCached.allTime) / ((this.clock.getTime() - bettor.createdTime) / (HOUR * 24));

        if (this.clock.getTime() - bettor.createdTime > HOUR * 24 * 30 && dailyProfits < (bettor.profitCached.monthly / 30)) {

            evalString += ", daily profits (all): " + roundToPercent(dailyProfits)
                + ", daily profits (monthly): " + roundToPercent((bettor.profitCached.monthly / 30));

            dailyProfits = (dailyProfits + (bettor.profitCached.monthly / 30)) / 2;

        };

        evalString += ", daily profits (averaged): " + roundToPercent(dailyProfits);

        let profitsCalibrated = 0;

        // I didn't have time to work out a formula to appropriately map the outputs from -1 to 1,
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

        // Although this is mostly encompassed by insider trading risk in the trustworthiness eval, there are situations where it might still be useful. Such as when trader number overcomes the negative from insider risk.
        if (bettor.id === mkt.creatorId) {
            profitsCalibrated+=0.15;
            if (profitsCalibrated>1){profitsCalibrated=1;}
            evalString += " + 0.15 (insider)";
        }

        this.log.write(evalString);

        return profitsCalibrated;

    }

    /**
     * This method evaluates a user to determine if they are likely to be a new user.
     * @param {*} user 
     * @param {*} bets all recent bets in the market
     * @returns A value from 0 to 1, with 1 being a near-certain new user.
     */
    wasThisBetPlacedByANoob(user, bets) {

        let theUser = user;
        let noobPoints = 0;
        let evalString = ""

        // Check how recent the account is
        // Note this doesn't quite do the job all by itself,
        // Some new users start cautiously, or learn the ropes quickly, or are alt accounts of more experienced users
        if (theUser.createdTime > this.clock.getTime() - HOUR * 24) {
            evalString += " 2 (Acct created in the last 24h)";
            noobPoints += 2;
        }
        else if (theUser.profitCached.allTime - theUser.profitCached.daily === 0) {
            evalString += " 2 (has made no trades prior to today)";
            noobPoints += 2;
        }
        else if (theUser.createdTime > this.clock.getTime() - HOUR * 24 * 7) {
            evalString += " 1 (Acct created in the last week)";
            noobPoints++;
        }

        var betSizingPoints = 0;
        //new users like to place bets in big round numbers, and sometimes bet their entire balance on a single question.
        for (let i in bets) {
            if (bets[i].amount === 1000 || bets[i].amount === 500) {
                evalString += " 2 (Placed a bet of size 1000)";
                if (betSizingPoints === 0) { betSizingPoints += 2; }
            }
            else if (bets[i].amount % 100 == 0 || bets[i].amount % 250 == 0) {
                evalString += " 1 (Placed bets in multiples of 100)";
                if (betSizingPoints === 0) { betSizingPoints += 1; } //make sure you don't triple count a string of 100M bets
            }
        }
        noobPoints+=betSizingPoints;

        // some circumstantial Manifold familiarity indicators
        if ((theUser.totalDeposits > 950 && theUser.totalDeposits < 1050) || (theUser.totalDeposits > 1450 && theUser.totalDeposits < 1550)) {
            evalString += " 1 (has starting currentcy amt)";
            noobPoints++;
        }
        
        // This attribute was recently removed from the API (2022-11-22)
        // if (theUser.creatorVolumeCached.allTime == 0) {
        //     evalString += " 1 (has made no markets)";
        //     noobPoints++;
        // }

        //return final evaluation
        this.log.write("Evaluated " + theUser.name + ": " + noobPoints + " = " + evalString);

        if (noobPoints > 3) { return 1; }

        else { return noobPoints / 3; }
    }

    /**
     * this method collects new bets from the server's /bets API endpoint. 
     * Manifold has turned on and off 15-second API caching a couple times, so this has two modes available.
     * 
     * The round trip to the Manifold servers takes a while, so rather than query the endpoint many times in sequence, 
     * we use an elaborate system in which we send queries even as we wait on the previous ones
     */
    async collectBets() {

        let newBetsExpectedAt = undefined;
        let lastBet = undefined;
        let penultimateBet = undefined;

        // here a bunch of various tempos we may desire to query the server according to
        let notACurve = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000];
        let sparseBellCurve = [-3000, -1000, -100, -35, 0, 35, 100, 1000, 3000];
        let bellCurve = [-3000, -1000, -250, -100, -50, -35, -20, -12, -5, 0, 5, 12, 20, 35, 50, 100, 250, 1000, 3000];
        let extraOffset = -50;
        for (let i in bellCurve) {
            bellCurve[i] -= extraOffset;
        }
        let cachingInactive = []

        let num = 0;
        while (num <= CACHING_DURATION) {
            cachingInactive.push(num);
            num += this.getSpeed();
        }

        let thisCurve = undefined;
        let whiffs = 0;

        let attempts = [];

        while (true) {
            //only used for the version with endpoint caching.
            let caughtOne = false;
            let initialNumOfBets = 2;

            if (newBetsExpectedAt === undefined) {
                newBetsExpectedAt = (new Date()).getTime();
                lastBet = (await latestBets(1))[0].id;
                thisCurve = notACurve;
            } else if (whiffs > 10) {
                thisCurve = notACurve;
                initialNumOfBets = 2;
            } else if (!this.settings.cachingActive) {
                thisCurve = cachingInactive;
                initialNumOfBets = 2;
            } else {
                //since speeds by defaut measure milliseconds per poll, greater than a speed in fact measures being slower
                if (this.getSpeed()>NORMAL){ 
                    thisCurve = sparseBellCurve;
                }
                else{
                    thisCurve = bellCurve;
                }
                initialNumOfBets = 20;
            }

            let i = 0;

            while ((i < thisCurve.length || attempts.length>0) && !caughtOne) { // Nov 11, 2022: checking if there's any pending promises is a new condition which may introduce bugs

                await sleep(5);

                //Check if any attempts have been responded to
                let j = 0;
                while (j < attempts.length) {

                    if (attempts[j].latestBets.PromiseStatus !== "pending") {
                        let thisAttempt = attempts.shift();

                        let theseBets = undefined;
                        try {
                            theseBets = await thisAttempt.latestBets;
                        }
                        catch (e) {
                            console.log(e);
                        }
                        if (theseBets === undefined) {
                            whiffs++;
                        }
                        else {
                            whiffs--;

                            //TODO: crashed on theseBets[0].id. I've encased in a trycatch for now, but try to get to the bottom of this.
                            try{
                                theseBets[0].id;
                            }
                            catch (e){
                                console.log(e);
                                console.log(theseBets);
                            }

                            if ( //if it's a bet we haven't seen yet
                                lastBet != theseBets[0].id
                                && penultimateBet != theseBets[0].id
                            ) {
                                //send it for analysis and counterbetting
                                //you should probably move the requerying if inadequate to here
                                await this.detectChanges(theseBets);
                                penultimateBet = lastBet;
                                lastBet = theseBets[0].id;
                                if (this.settings.cachingActive) {
                                    this.log.write("Timing was off by " + thisCurve[i] + " milliseconds");
                                    newBetsExpectedAt = thisAttempt.sentTime + CACHING_DURATION;
                                    caughtOne = true;
                                    attempts = [];
                                }
                            }
                        }
                    }
                    else {
                        j++;
                    }
                }

                // If enough time has elapsed, add a new request to the queue
                if ((new Date()).getTime() > newBetsExpectedAt + thisCurve[i]) {

                    attempts.push({ "latestBets": latestBets(initialNumOfBets), "sentTime": (new Date()).getTime() });
                    i++;

                }
            }

            if (!caughtOne || !this.settings.cachingActive) {
                //on no new bets in 15 secs:
                newBetsExpectedAt += CACHING_DURATION;
            }
            if (!caughtOne) {

                this.log.write("....");
                if ((new Date()).getTime() > this.timeOfLastBackup + 30 * MINUTE) {
                    this.performMaintenance();
                }
            }
            
        }
    }

    /**
     * This function scans the /bets endpoint for new bets coming in.
     * @returns array of all markets in which new bets have been placed
     */
    async detectChanges(nb) {

        let changedMarkets = [];

        let newBets = nb;

        let indexOfLastScan = undefined;

        for (let i = 0; i < newBets.length - 1; i++) {
            if (newBets[i].id === this.lastScannedBet) {
                indexOfLastScan = i;
            }
        }

        let betsToGet = 100;
        while (indexOfLastScan === undefined && betsToGet<2000) {
            try {
                newBets = await latestBets(betsToGet);
                for (let i = 0; i < newBets.length - 1; i++) {
                    if (newBets[i].id === this.lastScannedBet) {
                        indexOfLastScan = i;
                    }
                }
                if (indexOfLastScan === undefined) {
                    this.log.write("NewBets collection RERUN failed (id of lastscannedbet: " + this.lastScannedBet + ")");
                    betsToGet*=2;
                }
            }
            catch (e) {
                console.log(e);
                this.log.write(e.message);
                return;
            }
        }
        if(indexOfLastScan === undefined){
            throw new Error("Backup bet gathering failed.");
        }

        // among the bets collected, scan all the bets made since you last ran this method.
        // (progresses from oldest to newest, so that as we add bets the newest are at the top)
        for (let i = indexOfLastScan - 1; i >= 0; i--) {

            if ((newBets[i].outcome === "YES" || newBets[i].outcome === "NO") && this.cache.blacklist.find((m) => { return (m.id === newBets[i].contractId); }) === undefined) {

                if (!isUnfilledLimitOrder(newBets[i])
                    && !newBets[i].isRedemption
                    && !checkUserTrait(newBets[i].userId, "type", RIVAL_BOT) //you may want to exclude bets from rival bots here, as they might inadvertently impart social proof to a bad bet. And just generally slow things down.
                ) {
                    let parentMarket = this.cache.getMarketById(newBets[i].contractId);
                    if (parentMarket === undefined) {

                        let mkt = await this.cache.downloadAndCacheMarket(newBets[i].contractId);
                        this.log.write("======");
                        this.log.write("New Market: " + mkt.question + ": " + dToP(newBets[i].probAfter));
                        parentMarket = mkt;
                    }
                    parentMarket.bets.unshift(newBets[i]);
                    parentMarket.probability = newBets[i].probAfter;

                    //if you haven't already marked this market as having received new bets in this run, add it.
                    if (changedMarkets.find((cm) => { return (cm.id === parentMarket.id); }) === undefined) {
                        changedMarkets.push(parentMarket);
                        this.ellipsesDisplay = 0;
                    }
                }
            }
        }

        this.lastScannedBet = newBets[0].id;
        this.timeOfLastScan = newBets[0].createdTime;

        //if nothing has been logged for a while, print some ellipses to it's clear the program is still active.
        // if ((MINUTE * (this.ellipsesDisplay + 1)) < Date.now() - this.timeOfLastScan) {
        //     this.log.write("...");
        //     this.ellipsesDisplay++;
        // }

        this.huntWhales(changedMarkets);

    }

    /**
     * This method merges groups of bets in a bet history into a single aggregate bet.
     * Analyzing a bet history is difficult to do programmatically
     * to help, we're converting it into an intermediary: "aggregate bets" 
     * which helps our program not get confused by situations such as:
     *      -strings of consecutive bets
     *      -wash trading
     *      -bets that other traders have already bet against
     * For each trader, an aggregate bet is a single imaginary bet made from the 
     * lowest to highest prices they bought at during the last period of activity.
     * limited to the range of the total price movement observed 
     * ^ TO-DO: make the code more readable by just useing Math.ceil and Math.floor for that.
     */
    async aggregateBets(bets) {
        let currentMarket = this.cache.getMarketById(bets[0].contractId);

        let betToScan = {};
        let betIndex = 0;

        //let marketBets = [];
        let aggregateBets = [];
        let betPlacers = [];

        betToScan = bets[betIndex];

        let time = new Date();
        let inactivityCutoff = time.getDate() - (1000 * 60 * 5);

        //we'll need to record the present state of the market
        let probFinal = undefined;
        try {
            probFinal = betToScan.probAfter;
        }
        catch (e) {
            console.log(e);
        }

        while (
            // we collect bets not since the last run of this function, but in fact since the last period of inactivity
            // (we don't want to miss an increase in price gradual enough that no one run of this function deems it noteworthy)
            // we also stop at our last bet on the assumption that we successfully corrected the price. (not perfect behaviour, but fine for now)
            // in the future we will also stop at the last bet by a high-skill trader.
            (betToScan.createdTime > inactivityCutoff)
            && (!(checkUserTrait(betToScan.userId, "type", THIS_BOT) && !betToScan.isRedemption))
        ) {

            inactivityCutoff = betToScan.createdTime - (1000 * 60 * 5);

            if ( //don't collect the following types of bets
                !isUnfilledLimitOrder(betToScan)
                && !betToScan.isRedemption
                && !(checkUserTrait(betToScan.userId, "type", THIS_BOT))
                && !(checkUserTrait(betToScan.userId, "type", RIVAL_BOT))
            ) {
                // find/create the appropriate aggregate to add this to
                // we're deciding who to bet against in part based on user characteristics, so each user's
                // bets are aggregated separately
                let thisAggregate = aggregateBets.find((b) => { return b.userId === betToScan.userId; });
                if (thisAggregate === undefined) {
                    thisAggregate = {
                        outcome: "",
                        contractId: betToScan.contractId,
                        userId: betToScan.userId,
                        bettor: undefined,
                        bettorName: "",
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

                    thisAggregate.bettor = this.cache.getUserById(betToScan.userId);
                    if (thisAggregate.bettor === undefined) {
                        //TODO: assign a noobscore and do this asynchronously
                        thisAggregate.bettor = await this.cache.addUser(betToScan.userId);
                    }

                    aggregateBets.push(thisAggregate);
                    betPlacers.push(this.cache.getUserById(betToScan.userId));
                }
                else {
                    thisAggregate.probBefore = betToScan.probBefore;
                    thisAggregate.startTime = betToScan.createdTime;
                }
                thisAggregate.constituentBets.push(betToScan);
            }

            //Afterwards, move to the next bet and check it against our while condition
            if (bets.length <= (++betIndex)) {
                betToScan = undefined;
                break;
            }
            else {
                betToScan = bets[betIndex];
            }

            try { betToScan.createdTime }
            catch (e) {
                this.log.write("Looking for a bet where there isn't one, check the following outputs:");
                console.log(betIndex);
                console.log(betToScan);
            }

        }

        let probStart = undefined;
        if (betToScan !== undefined) {
            //now that we've collected a bet that does't qualify for analysis, 
            //we can take its probafter as the "baseline price" prior to the last flurry of betting
            probStart = betToScan.probAfter;

            //this is where we collect up-to-date info about outgoing bets of ours: when they show up in the bet stream.
            if (checkUserTrait( betToScan.userId, "type", THIS_BOT) && !betToScan.isRedemption) {

                let alreadyDetected = false;
                for (let i in this.safeguards.betsPlaced) {
                    if (this.safeguards.betsPlaced[i].id === betToScan.id) {
                        alreadyDetected = true;
                    }
                }
                if (!alreadyDetected) {
                    this.betDebrief(betToScan)
                }
            }
        }
        else {
            //if we've run out of bets, just use the probBefore of the oldest
            probStart = bets[bets.length - 1].probBefore;
        }

        //post-process the aggbets.
        for (let i in aggregateBets) {

            let thisAgg = aggregateBets[i];
            if (thisAgg.probBefore > thisAgg.probAfter) { thisAgg.outcome = "" + "NO"; }
            if (thisAgg.probBefore < thisAgg.probAfter) { thisAgg.outcome = "" + "YES"; }

            //if it's a "NO" bet
            if (thisAgg.outcome === 'NO') {

                //any big swings may be an illusion if they haven't brought the price any lower than it was at the start of the latest flurry of bets
                if (thisAgg.probBefore > probStart) {
                    thisAgg.probBefore = probStart;
                }
                //or if the movement has since been reversed, probably by other bots, maybe from wash trading.
                if (thisAgg.probAfter < probFinal) {
                    thisAgg.probAfter = probFinal;
                }
                // when this successfully catches misleading/illusory NO bets, 
                // e.g. a NO bet that's just reverting a previous swing, or which has since been undone, 
                // it manifests as a very confusing 
                // output: a NO bet that increases the price, you'll want to add something that clarifies
                // so bot operators reading the logs understand what they're looking at
                // but the following doesn't work just yet because even negated bets are useful for some later calculations
                // if (thisAgg.probBefore <= thisAgg.probAfter) { thisAgg.outcome = "NEGATED"; }
            }
            //visa versa the above
            else if (thisAgg.outcome === 'YES') {

                if (thisAgg.probBefore < probStart) {
                    thisAgg.probBefore = probStart;
                }

                if (thisAgg.probAfter > probFinal) {
                    thisAgg.probAfter = probFinal;
                }
                //if (thisAgg.probBefore >= thisAgg.probAfter) { thisAgg.outcome = "NEGATED"; }
            }

            //let bettor = getUserById(thisAgg.userId);
            thisAgg.buyingPower = discountDoublings(thisAgg);

            let bettor = thisAgg.bettor;

            thisAgg.bettorName = bettor.name;
            thisAgg.trustworthiness = this.isMarketLegit(currentMarket, bettor); //returns value from zero to one;
            thisAgg.noobScore = this.wasThisBetPlacedByANoob(bettor, thisAgg.constituentBets) //returns value from zero to one;
            thisAgg.bettorAssessment = this.assessTraderSkill(bettor, thisAgg.constituentBets, currentMarket); //returns value from -1 to +1
            if (thisAgg.noobScore === 1 && thisAgg.bettorAssessment > 1) { thisAgg.bettorAssessment /= 3.5; }

            // proxies for user skill can't be less than those of anyone who made that trade at a worse price,
            // who has implicitly vouched for the trade. The "Beshir anchor"
            for (let j in aggregateBets) {
                if (i !== j) {
                    let otherAgg = aggregateBets[j];
                    if ((thisAgg.outcome === otherAgg.outcome
                        && thisAgg.outcome === "NO"
                        && thisAgg.probAfter > otherAgg.probAfter)
                        || (thisAgg.outcome === otherAgg.outcome
                            && thisAgg.outcome === "YES"
                            && thisAgg.probAfter < otherAgg.probAfter)) {
                        if (otherAgg.bettorAssessment > thisAgg.bettorAssessment) {
                            thisAgg.bettorAssessment = otherAgg.bettorAssessment;
                        }
                        if (otherAgg.noobScore < thisAgg.noobScore) {
                            thisAgg.noobScore = otherAgg.noobScore;
                        }
                        if (otherAgg.trustworthiness < thisAgg.trustworthiness) {
                            thisAgg.trustworthiness = otherAgg.trustworthiness;
                        }
                    }
                }
            }

        }

        this.log.write("-----");
        this.log.write(currentMarket.question + ": " + dToP(probStart) + " -> " + dToP(currentMarket.probability));

        return aggregateBets;
    }

    /**
     * Analyze incoming bets, place bets against any with indicators of being misjudged.
     */
    async huntWhales(mti) {

        let marketsToInspect = mti

        this.log.write("Changed Markets:")
        for (let m in marketsToInspect){
            this.log.sublog(m+": "+marketsToInspect[m].question);
        }

        for (let i in marketsToInspect) {

            let currentMarket = marketsToInspect[i];

            // for checking if bets have gotten unsorted
            // for (let w in currentMarket.bets){
            //     this.log.write(""+(currentMarket.bets[w].createdTime-this.timeOfLastBet));
            // }
            // currentMarket.bets = currentMarket.bets.sort((a, b)=>{return b.createdTime-a.createdTime});
            // for (let w in currentMarket.bets){
            //     this.log.write(""+(currentMarket.bets[w].createdTime-this.timeOfLastBet));
            // }

            if (currentMarket.outcomeType === "PSEUDO_NUMERIC") {
                if (currentMarket.bets.length > 0) {
                    currentMarket.probability = currentMarket.bets[0].probAfter;
                }
                else {
                    currentMarket.probability = undefined;
                }
            }
            currentMarket.aggBets = this.aggregateBets(currentMarket.bets);

        }

        for (let i in marketsToInspect) {
            let currentMarket = marketsToInspect[i];
            currentMarket.aggBets = await currentMarket.aggBets;

            //analyze the aggbets
            for (let j = 0; j < currentMarket.aggBets.length; j++) {

                let thisAgg = currentMarket.aggBets[j];
                if (thisAgg === undefined) {
                    console.log(currentMarket);
                    throw new Error(`Aggregate Bets Missing (does not have ${j}th item`);
                }

                //console.log(thisAgg);

                let betDifference = 0
                //if the bet hasn't been totally negated by other price movements
                if (!((thisAgg.outcome === 'NO' && thisAgg.probBefore <= thisAgg.probAfter)
                    || (thisAgg.outcome === 'YES' && thisAgg.probBefore >= thisAgg.probAfter))) {

                    betDifference = thisAgg.probAfter - thisAgg.probBefore;

                }

                // this.log.write("prob difference: " + dToP(difference) + ", bet difference: " + dToP(betDifference));
                this.log.write("bet difference: " + dToP(betDifference));

                if (Math.abs(betDifference) >= MIN_P_MOVEMENT) {
                    let betAlpha = this.settings.desiredAlpha;
                    let shouldPlaceBet = 0;

                    shouldPlaceBet = thisAgg.noobScore;
                    if (thisAgg.bettorAssessment < -0.1) { shouldPlaceBet += 1 }
                    else if (thisAgg.bettorAssessment <= 0.2) { shouldPlaceBet += .67 }
                    else if (thisAgg.bettorAssessment <= 0.4) { shouldPlaceBet += .2 }
                    shouldPlaceBet *= thisAgg.trustworthiness;
                    //this needs to be capped because otherwise it's possible to bait the bot with illusory Pascal's Wagers
                    if (thisAgg.buyingPower > 2.5) { thisAgg.buyingPower = 2.5 }
                    shouldPlaceBet *= thisAgg.buyingPower;

                    betAlpha = (this.settings.desiredAlpha + (-thisAgg.bettorAssessment)) / 2
                    betAlpha *= thisAgg.trustworthiness * thisAgg.trustworthiness;
                    if (betAlpha < 0) { betAlpha = 0; }

                    this.log.write("should I bet? | alpha sought | noobScore | bettorskill | trustworthy? | buyingPower");
                    this.log.write(roundToPercent(shouldPlaceBet).toString().padEnd(13) + " | "
                        + roundToPercent(betAlpha).toString().padEnd(12) + " | "
                        + roundToPercent(thisAgg.noobScore).toString().padEnd(9) + " | "
                        + roundToPercent(thisAgg.bettorAssessment).toString().padEnd(11) + " | "
                        + roundToPercent(thisAgg.trustworthiness).toString().padEnd(12) + " | "
                        + roundToPercent(thisAgg.buyingPower).toString());

                    if ((shouldPlaceBet >= 1 && betAlpha * Math.abs(betDifference) * thisAgg.buyingPower > 0.01) || this.settings.mode === "dry-run-w-mock-betting") {

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
                            // bet.amount = (currentMarket.pool.YES/(currentMarket.pool.YES+currentMarket.pool.NO)) * betDifference
                        }
                        else {
                            bet.outcome = "NO";
                            bet.limitProb = currentMarket.probability - recoveredSpan;

                        }
                        bet.limitProb = roundToPercent(bet.limitProb);

                        if (this.settings.mode === "dry-run" || this.settings.mode === "dry-run-w-mock-betting" || this.settings.mode === "bet") {
                            this.log.write("Betting "+bet.outcome+" against " + thisAgg.bettorName + " (" + thisAgg.bettorAssessment + ") on " + currentMarket.question + " (" + currentMarket.probability + " at " + (new Date()).getTime() + " milliseconds)");

                            if (this.settings.mode === "bet") {
                                this.timeOfLastBet = thisAgg.constituentBets[0].createdTime;
                                try {
                                    bet.id = (await placeBet(bet, process.env.APIKEY).then(
                                        (resjson) => {
                                            this.log.write("bet placed: " + resjson.betId);
                                            let tryAgainIn = 10;
                                            while (tryAgainIn != 0) {
                                                try {
                                                    cancelBet(resjson.betId, process.env.APIKEY);
                                                    tryAgainIn = 0;
                                                }
                                                catch (e) {
                                                    this.log.write("Failed to cancel bet: " + e.message);
                                                    tryAgainIn *= 2;
                                                }
                                            }
                                            return resjson;
                                        }
                                    )
                                    ).betId;
                                } catch (e) {
                                    this.log.write("awaited code crashed while placing bet.");
                                }
                            }
                            else if (this.settings.mode === "dry-run" || this.settings.mode === "dry-run-w-mock-betting") {
                                bet.probAfter = bet.limitProb;
                                bet.shares = bet.amount / bet.limitProb;
                            }

                            //Bet logging and debriefing is found elsewhere: we need to get a copy of the bet from Manifold's servers because eg. 
                            // front-running may have cause it to have purchased different quantities, at different prices, than expected
                        }
                    }
                }
            }
        }
    }

    /**
     * Checks if a user has placed any bets recently. 
     * Used to keep an eye on rival bots.
     * @param {*} username 
     * @returns 
     */
    async isUserOnline(username) {
        try {
            let vbets = await fetchUsersBets(username, 1);
            if (vbets[0].createdTime < (new Date()).getTime() - (2 * HOUR)) {
                return false;
            }
        }
        catch (e) {
            console.log(`Failed to get ${username}'s bets. Defaulting to 'offline'.`);
            return false;
        }
        return true;
    }

    /**
     * This function performs routine maintenance on the program, called every 30 minutes at present.
     * It backs up the cached data, adjusts bot speed, etc.
     */
    async performMaintenance() {

        this.cache.updateBlacklist();
        this.cache.backupCache();
        this.cache.saveCache();
        this.timeOfLastBackup = (new Date()).getTime();

        let maintenanceReport = "Maintenance Report: ";
        let newSpeed = this.getSpeed();

        //if it's ISP no-fee hours, speed up.
        if ((new Date()).getHours() > 2 && (new Date()).getHours() < 14) {
            newSpeed = 100;
            maintenanceReport += `Base speed: ${newSpeed} (Cheap internet, using fast base rate) ==> `;
        }

        let botsOnline = { "v": await this.isUserOnline("v"), "acc": await this.isUserOnline("acc") };

        //if v hasn't bet in 4 hours, slow down.
        if (botsOnline.acc === true && botsOnline.v === false) {
            newSpeed = 500;
        }
        else if (botsOnline.acc === false && botsOnline.v === false) {
            newSpeed = 100;
        }
        else if (botsOnline.v === true) {
            newSpeed /= 4;
        }

        maintenanceReport += `Adjusted Speed: ${newSpeed} `;
        maintenanceReport += "( Bots online: [ ";
        if (botsOnline.acc === true) { maintenanceReport += "acc"; }
        if (botsOnline.v === true && botsOnline.acc === true) { maintenanceReport += ", "; }
        if (botsOnline.v === true) { maintenanceReport += "v"; }
        maintenanceReport += " ] )";

        this.log.write(maintenanceReport);
        this.adjustedSpeed = newSpeed;

    }

    /**
     * Performs various maintenance tasks on bets we've placed after having retrieved its outcome from the server. 
     * Record its values, sell it, calculate latency, etc.
     * @param {*} bet 
     */
    async betDebrief(bet) {

        //TODO: Measure and print bet latency
        this.log.write("Bet latency: " + (bet.createdTime - this.timeOfLastBet));
        this.safeguards.betsPlaced.unshift(bet);
        //this.safeguards.betsByMarket[currentMarket.id].unshift(betToScan);
        if (this.settings.autoLiquidate) {
            this.placeLiquidationOrder(bet);
        }
        this.checkSafeguards();

    }

    /**
     * Performs checks against some basic safeguards against the bot being manipulated.
     */
    async checkSafeguards() {

        let report = ("bets placed: " + this.safeguards.betsPlaced.length + "\n")

        let outgoingCash = 0;

        for (let i = 0; i < this.safeguards.betsPlaced.length; i++) {

            report += ("bet " + i + " (" + this.safeguards.betsPlaced[i].contractId + ") amount: " + this.safeguards.betsPlaced[i].amount + "\n");
            outgoingCash += this.safeguards.betsPlaced[i].amount;
        }
        report += ("Outgoing cash: " + outgoingCash)
        this.log.write(report);
        //this.log.close();
        if (outgoingCash > OUTGOING_LIMIT) {
            await this.cache.saveCache();
            throw new Error("Exceeded outgoing cash limit");
        }

        //throw new Error("Overspent on a single market");
    }

    /**
     * If autoLiquidate setting is active, this places a limit order near the probBefore of the counterparty's bet 
     * with the aim of rapidly exiting the newly purchased position with a profit.
     * @param {*} bet Our recent bet whose shares we wish to unload.
     * @param {*} startingPoint the "baseline price": where the price was before the counterparty started betting.
     */
    async placeLiquidationOrder(bet, startingPoint) {
        if (!this.settings.autoLiquidate) { return; }

        let myBet = bet;

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
            await placeBet(sellBet, process.env.APIKEY).then((resjson) => { console.log(resjson); });
        }
        else if (this.settings.mode === "dry-run" || this.settings.mode === "dry-run-w-mock-betting") {
            console.log(sellBet);
        }
    }
}