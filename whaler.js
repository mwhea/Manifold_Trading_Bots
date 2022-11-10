import {
    getAllMarkets,
    getUserById,
    getFullMarket,
    placeBet,
    cancelBet,
    getLatestBets,
    getAllUsers,
    getMarkets,
    getUsersBets
} from './api.js';
import {
    createWriteStream,
    createReadStream,
    rename,
    renameSync,
    statSync
} from 'fs';
import dateFormat, { masks } from "dateformat";

import fetch from 'node-fetch'
import { Logger } from "./Logger.js";

import 'dotenv/config'
import {
    readFile,
    writeFile
} from 'fs/promises';

import {
    dToP,
    discountDoublings,
    roundToPercent,
    isUnfilledLimitOrder,
    sleep
} from './utility_functions.js';
import { time } from 'console';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * MINUTE;
const MIN_P_MOVEMENT = .0375;

const UT_THRESHOLD = 20;
const CACHING_DURATION = 15000;

const OUTGOING_LIMIT = 1000;
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

        this.settings = whalerSettings;
        this.adjustedSpeed = this.settings.speed;

        this.notableUsers = readFile(new URL('./notableUsers.json', import.meta.url));

        this.cachedUsers = [];
        this.allUsers = [];

        this.recentMarkets = [];

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

        this.allCachedMarkets = [];

    }

    getSpeed() {
        return this.adjustedSpeed;
    }

    /**
     * To my knowledge there's no straighforward way to use asynchronous methods in a constructor, 
     * so this method is meant to be called after the constuctor to perform any additional construction making used of asynchronous functions
     */
    async additionalConstruction() {
        this.notableUsers = JSON.parse(await this.notableUsers);
        try {
            this.allCachedMarkets = await readFile(new URL('/temp/markets.json', import.meta.url));
            this.allCachedMarkets = JSON.parse(await this.allCachedMarkets);

            const { mtime, ctime } = statSync(new URL('/temp/markets.json', import.meta.url))

            this.log.write(`Cache age is ${(((new Date()).getTime() - mtime) / 1000) / 60} minutes.`);
            if (mtime < (new Date()).getTime() - (2 * HOUR)) {
                this.log.write(mtime + " < " + (new Date()).getTime() + " - " + (2 * HOUR));
                await this.updateCache();
            }
            else {
                this.log.write("Cache up to date");
            }

        }
        catch (e) {
            console.log(e)
            console.log("Unable to load market cache, building one anew")
            this.allCachedMarkets = [];
            await this.buildCacheFromScratch();
        }
        if (this.allCachedMarkets.length === 0) {
            await this.buildCacheFromScratch();
        }

        this.allUsers = getAllUsers();

        this.lastScannedBet = (await getLatestBets(1))[0].id;

        this.allUsers = this.sortListById(await this.allUsers);

        this.performMaintenance();

    }

    /**
     * Binary search which can be used on either the locally stored list of markets or the list of users
     * @param {*} id 
     * @param {*} list 
     * @returns the sought-after object
     */
    findIdHolderInList(id, list) {
        let start = 0;
        let end = list.length - 1;
        let middle;

        let searchLog = "ID holder wasn't found\n";

        while (start <= end) {
            middle = Math.floor((start + end) / 2);

            if (list[middle].id === id) {
                // found the key
                return list[middle];
            } else if (list[middle].id < id) {
                // continue searching to the right
                searchLog += "cachedId " + "<" + " id\n";
                start = middle + 1;
            } else {
                // search searching to the left
                searchLog += "cachedId " + ">" + " id\n";
                end = middle - 1;
            }
        }

        // key wasn't found. Print the environs it searched in to ensure the search is working properly.

        if (list[0].profitCached !== undefined) {
            this.log.write("finding user");
        }
        else if (list[0].closeTime !== undefined) {
            this.log.write("finding market");
        }
        else {
            this.log.write("ERROR: Attempting to search a bad array");
            console.log(list[0]);
        }
        this.log.write("list length: " + end);

        searchLog += ("Immediate Vicinity: " + list[end - 1].id + ", " + list[end].id + ", " + list[end + 1].id);
        this.log.write(searchLog);
        return undefined;
    }

    /**
     * Sort a list by id, works on any array whose objects contain an "id" field.
     * @param {*} list 
     * @returns the sorted array
     */
    sortListById(list) {
        list = list.sort((a, b) => {
            if (a.id < b.id) { return -1; }
            if (a.id > b.id) { return 1; }
            return 0;
        });
        return list;
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
            if (!(
                this.notableUsers[mkt.creatorId] === "BTE"
                || this.notableUsers[mkt.creatorId] === "BTEF2P"
                || this.notableUsers[mkt.creatorId] === "Bot Dad"
            )) {
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
        let numUTs = 0;
        if (mkt.uniqueTraders.length < UT_THRESHOLD && mkt.uniqueTraders.find((o) => { return o === bettor.id; }) === undefined) {
            mkt.uniqueTraders.push(bettor.id);
        }

        let socialProofAdjustment = (mkt.uniqueTraders.length * 0.05) - .35;
        if (mkt.uniqueTraders.length > UT_THRESHOLD) { socialProofAdjustment = (UT_THRESHOLD * 0.05) - .35; }
        if (socialProofAdjustment >= 0) { searchLog += " + " + socialProofAdjustment; }
        else { searchLog += " - " + Math.abs(socialProofAdjustment); }
        searchLog += " (num unique traders)";
        returnVal += socialProofAdjustment;


        // if (mkt.createdTime > time.getTime() - ((MINUTE * 15))) {
        //     searchLog += " - 0.40";
        //     returnVal -= .40;
        // }
        // //otherwise length open is the only heuristic you have to go on.
        // else if (mkt.createdTime > time.getTime() - ((DAY * 5))) {
        //     searchLog +=" - 0.25";
        //     returnVal -= .25;
        // }

        //The following users have the expertise or inclination to exploit a bot.
        if (this.notableUsers[bettor.id] === "Yev"
            || this.notableUsers[bettor.id] === "NotMyPresident"
            || this.notableUsers[bettor.id] === "GeorgeVii") {
            searchLog += " - 0.25 (dangerous users)";
            returnVal -= .25;
        }
        if (this.notableUsers[mkt.creatorId] === "Yev"
            || this.notableUsers[mkt.creatorId] === "NotMyPresident") {
            searchLog += " - 0.66 (extremely dangerous creators)";
            returnVal -= .66;
        }
        else if (this.notableUsers[mkt.creatorId] === "Spindle"
            || this.notableUsers[mkt.creatorId] === "Gurkenglas"
            || this.notableUsers[mkt.creatorId] === "GeorgeVii"
            || this.notableUsers[mkt.creatorId] === "Gigacasting") {
            searchLog += " - 0.25 (dangerous creators)";
            returnVal -= .25;
        }

        this.log.write(searchLog + " = " + returnVal);

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

        //special logic for specific users whose trading patterns I know:
        //BTE has lots of funds and impulsively places large bets which the larger market doesn't agree with, so he's perfect for market making.
        if (this.notableUsers[bettor.id] === "BTE") {
            return -0.2;
        }

        if (bettor.id === mkt.creatorId) {
            let bettorAssessment = "insider";
        }

        let dailyProfits = (bettor.profitCached.allTime) / ((this.clock.getTime() - bettor.createdTime) / (HOUR * 24));

        if (this.clock.getTime() - bettor.createdTime > HOUR * 24 * 30 && dailyProfits < (bettor.profitCached.monthly / 30)) {

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

        //how recent the account is:
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

        //new users like to place bets in big round numbers, and sometimes bet their entire balance on a single question.
        for (let i in bets) {
            if (bets[i].amount === 1000 || bets[i].amount === 500) {
                evalString += " 2 (Placed a bet of size 1000)";
                if (noobPoints === 0) { noobPoints += 2; }
            }
            else if (bets[i].amount % 100 == 0 || bets[i].amount % 250 == 0) {
                evalString += " 1 (Placed bets in multiples of 100)";
                if (noobPoints === 0) { noobPoints += 1; } //some hacky logic to make sure you don't triple count a string of 100M bets
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
        this.log.write("Evaluated " + theUser.name + ": " + noobPoints + " = " + evalString);

        if (noobPoints > 3) { return 1; }

        else { return noobPoints / 3; }
    }

    /**
     * this method collects new bets from the server's /bets API endpoint. 
     * Manifold has turned on and off 15-second API caching a couple times, so this has two modes available.
     */
    async collectBets() {

        let newBetsExpectedAt = undefined;
        let lastBet = undefined;
        let penultimateBet = undefined;

        let notACurve = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000];
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
                lastBet = (await getLatestBets(1))[0].id;
                thisCurve = notACurve;
            } else if (whiffs > 10) {
                thisCurve = notACurve;
                initialNumOfBets = 2;
            } else if (!this.settings.cachingActive) {
                thisCurve = cachingInactive;
                initialNumOfBets = 2;
            } else {
                thisCurve = bellCurve;
                initialNumOfBets = 20;
            }

            let i = 0;

            while (i < thisCurve.length && !caughtOne) {

                await sleep(5);

                // If enough time has elapsed, add a new request to the queue
                if ((new Date()).getTime() > newBetsExpectedAt + thisCurve[i]) {

                    attempts.push({ "latestBets": getLatestBets(initialNumOfBets), "sentTime": (new Date()).getTime() });
                    i++;

                }

                //Check which attempts have been responded to
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

        if (indexOfLastScan === undefined) {
            try {
                newBets = await getLatestBets(500);
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
                this.log.write("NewBets collection RERUN failed (id of lastscannedbet: " + this.lastScannedBet + ")");
                for (let j in newBets) {
                    //if bug persists, sublog a list of collected newbets.
                }
                console.log(e);
                return;
            }

        }

        //among the bets collected, scan all the bets made since you last ran this method.
        // (progresses from oldest to newest, so that as we add bets the newest are at the top)
        for (let i = indexOfLastScan - 1; i >= 0; i--) {

            if (newBets[i].outcome === "YES" || newBets[i].outcome === "NO") {

                if (!isUnfilledLimitOrder(newBets[i])
                    && !newBets[i].isRedemption
                    // && !(this.notableUsers[newBets[i].userId] === "v"

                ) {
                    let parentMarket = this.findIdHolderInList(newBets[i].contractId, this.allCachedMarkets);
                    if (parentMarket === undefined) {

                        let mkt = this.stripFullMarket(await getFullMarket(newBets[i].contractId));
                        this.log.write("======");
                        this.log.write("New Market: " + mkt.question + ": " + dToP(newBets[i].probAfter));

                        mkt.uniqueTraders = [];
                        mkt.uniqueTraders.unshift(newBets[i].userId);
                        this.allCachedMarkets.push(mkt);
                        this.allCachedMarkets = this.sortListById(this.allCachedMarkets);
                        parentMarket = mkt;
                    }
                    parentMarket.bets.unshift(newBets[i]);
                    parentMarket.probability = newBets[i].probAfter;


                    //if you haven't already marked this market as having received new bets in this run, add it.
                    if (changedMarkets.find((e) => { e.id === newBets[i].contractId }) === undefined) {
                        changedMarkets.push(parentMarket);
                        this.ellipsesDisplay = 0;
                    }
                }
            }
        }

        this.lastScannedBet = newBets[0].id;
        this.timeOfLastScan = newBets[0].createdTime;

        //if nothing has been logged for a while, print some ellipses to it's clear the program is still active.
        if ((MINUTE * (this.ellipsesDisplay + 1)) < Date.now() - this.timeOfLastScan) {
            this.log.write("...");
            this.ellipsesDisplay++;
        }

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
     */
    async aggregateBets(bets) {
        let currentMarket = this.findIdHolderInList(bets[0].contractId, this.allCachedMarkets);

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
            && (!(this.notableUsers[betToScan.userId] === "me" && !betToScan.isRedemption))
        ) {

            inactivityCutoff = betToScan.createdTime - (1000 * 60 * 5);

            if ( //don't collect the following types of bets
                !isUnfilledLimitOrder(betToScan)
                && !betToScan.isRedemption
                && !(this.notableUsers[betToScan.userId] === "me")
                && !(this.notableUsers[betToScan.userId] === "v")
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

                    thisAggregate.bettor = this.findIdHolderInList(betToScan.userId, this.allUsers);
                    if (thisAggregate.bettor === undefined) {
                        //TODO: assign a noobscore and do this asynchronously
                        this.allUsers.push(await getUserById(betToScan.userId));
                        this.allUsers = this.sortListById(this.allUsers);
                        thisAggregate.bettor = this.findIdHolderInList(betToScan.userId, this.allUsers);
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
            if (this.notableUsers[betToScan.userId] === "me" && !betToScan.isRedemption) {

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
                //when this successfully catches misleading/illusory NO bets, it manifests as a very confusing 
                //output: a NO bet that increases the price, you'll want to add something that clarifies
                //so bot operators reading the logs understand what they're looking at
                //but the following doesn't work just yet because even negated bets are useful for some later calculations
                //if (thisAgg.probBefore <= thisAgg.probAfter) { thisAgg.outcome = "NEGATED"; }
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

        for (let i in marketsToInspect) {

            let currentMarket = marketsToInspect[i];

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
            //console.log(currentMarket.bets);
            currentMarket.aggBets = this.aggregateBets(currentMarket.bets);

        }

        for (let i in marketsToInspect) {
            let currentMarket = marketsToInspect[i];
            currentMarket.aggBets = await currentMarket.aggBets;

            //analyze the aggbets
            for (let j in currentMarket.aggBets) {

                let thisAgg = currentMarket.aggBets[j];

                //thisAgg.constituentBets = [];
                console.log(thisAgg);

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

                    this.log.write("should I bet? | alpha sought\t| noobScore\t| bettorskill\t| trustworthy?\t| buyingPower");
                    this.log.write(roundToPercent(shouldPlaceBet) + " \t\t| "
                        + roundToPercent(betAlpha) + " \t\t| "
                        + roundToPercent(thisAgg.noobScore) + " \t\t| "
                        + roundToPercent(thisAgg.bettorAssessment) + " \t\t| "
                        + roundToPercent(thisAgg.trustworthiness) + " \t\t| "
                        + roundToPercent(thisAgg.buyingPower));

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
                        }
                        else {
                            bet.outcome = "NO";
                            bet.limitProb = currentMarket.probability - recoveredSpan;

                        }
                        bet.limitProb = roundToPercent(bet.limitProb);

                        if (this.settings.mode === "dry-run" || this.settings.mode === "dry-run-w-mock-betting" || this.settings.mode === "bet") {
                            this.log.write("Betting against " + thisAgg.bettorName + " (" + thisAgg.bettorAssessment + ") on " + currentMarket.question + " (" + currentMarket.probability + "at " + (new Date()).getTime() + " milliseconds)");
                            console.log(bet);
                            let myBetId = undefined;

                            if (this.settings.mode === "bet") {
                                this.timeOfLastBet = thisAgg.constituentBets[0].createdTime;
                                bet.id = (await placeBet(bet, process.env.APIKEY).then(
                                    (resjson) => {
                                        this.log.write("bet placed: " + resjson.betId);
                                        console.log(resjson);
                                        cancelBet(resjson.betId, process.env.APIKEY);
                                        return resjson;
                                    }
                                )
                                ).betId;
                                // if you put the liquidation order in a then, you can reduce some latency
                            }
                            else if (this.settings.mode === "dry-run" || this.settings.mode === "dry-run-w-mock-betting") {
                                bet.probAfter = bet.limitProb;
                                bet.shares = bet.amount / bet.limitProb;
                            }

                            //we need to get a copy of the bet from Manifold's servers because eg. front-running may have cause it 
                            //to have purchased different quantities, at different prices, than expected
                            //this.debriefBet().then((b) => { this.safeguards.betsPlaced.unshift(b); }).then(() => { this.placeLiquidationOrder(this.safeguards.betsPlaced[0], probStart); }).then(() => this.checkSafeguards());
                            //also prepare a limit order to liquidate it.
                            // if (this.settings.autoLiquidate) {
                            //     this.placeLiquidationOrder(this.safeguards.betsPlaced[0], probStart);
                            // }
                        }
                    }
                }
            }
        }
    }

    async isUserOnline(username) {
        try {
            let vbets = await getUsersBets(username, 1);
            if (vbets[0].createdTime < (new Date()).getTime() - (2 * HOUR)) {
                return false;
            }
        }
        catch (e) {
            console.log(`Failed to get ${username}'s bets: ${r}. Defaulting to 'online'.`);
        }
        return true;
    }
    /**
     * To be filled in, the function with routine maintenance to be called every five minutes or so.
     */
    async performMaintenance() {

        this.backupCache();
        this.saveCache();
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
            await this.saveCache();
            throw new Error("Exceeded outgoing cash limit");
        }

        //throw new Error("Overspent on a single market");
    }

    /**
     * If autoLiquidate setting is active, this places a limit order near the probBefore of the counterparty's bet 
     * with the aim of rapidly exiting the newly purchased position with a profit.
     * @param {*} bet Our recent bet whose shares we wish to unload.
     * @param {*} startingPoint the "baseline price": where the price was before th ecounterparty started betting.
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

    /**
     * This method builds the market cache by querying for full market data of any market we might trade on
     */
    async buildCacheFromScratch() {
        let unprocessedMarkets = [];
        let markets = await getAllMarkets(["BINARY", "PSEUDO_NUMERIC"], "UNRESOLVED");

        for (let i = 0; i < markets.length; i++) {

                if (i % 100 === 0) { this.log.write("pushed " + i + " markets"); }
                unprocessedMarkets.push(getFullMarket(markets[i].id));

                //slight delay to the server doesn't reject requests due to excessive volume.
                await sleep(20);

        }

        for (let i in unprocessedMarkets) {

            if (i % 100 === 0) { this.log.write("Cached " + i + " markets"); }
            await this.cacheMarket(await unprocessedMarkets[i]);

        }
        this.allCachedMarkets = this.sortListById(this.allCachedMarkets);
        await this.backupCache();
        await this.saveCache();
    }

    /**
     * Creates a new array in a FullMarket storing only a list of unique trader ids
     * (This is more lightweight than the full bet list for medium-term storage.)
     * @param {*} mkt 
     */
    setUniqueTraders(mkt) {

        mkt.uniqueTraders = [];

        if (mkt.bets != undefined) {

            for (let i = 0; i < mkt.bets.length && mkt.uniqueTraders.length < UT_THRESHOLD; i++) {
                if (mkt.uniqueTraders.find((o) => { return o === mkt.bets[i].userId; }) === undefined) {
                    mkt.uniqueTraders.push(mkt.bets[i].userId);
                }
            }
        }

    }

    /**
     * Processes FullMarkets into a stripped down version suitable for caching.
     * @param {*} fmkt 
     */
    cachifyMarket(fmkt) {

        let cachedMarket = this.stripFullMarket(fmkt);

        this.setUniqueTraders(fmkt);

        cachedMarket.bets = [];

        return cachedMarket;

    }

    /**
     * Adds a FullMarket to the market cache
     * @param {*} fmkt 
     */
    cacheMarket(fmkt) {

        this.allCachedMarkets.push(this.cachifyMarket(fmkt));

    }

    /**
     * Scan the market cache for markets likely to have changed during periods of program inactivity, and check the server for updates to them.
     */
    async updateCache() {

        this.log.write("Updating Stale Cache:\n");

        this.allCachedMarkets = this.allCachedMarkets.sort((a, b) => { return a.createdTime - b.createdTime })
        //Something failed silently (unresponsive console), when I accidentally deleted everythign with above loop)
        let allmkts = (await getAllMarkets(["BINARY", "PSEUDO_NUMERIC"], "UNRESOLVED")).reverse();

        let i = 0;
        while (i < this.allCachedMarkets.length || i < allmkts.length) {
            this.log.write(this.allCachedMarkets[i].question + " : " + allmkts[i].question);
            if (i > this.allCachedMarkets.length - 1) {
                this.cacheMarket(await getFullMarket(allmkts[i].id));
                this.log.sublog("Adding market" + allmkts[i].question);
            }
            else if (this.allCachedMarkets[i].id === allmkts[i].id) {
                if (this.allCachedMarkets[i].uniqueTraders.length < UT_THRESHOLD) {
                    try {
                        let reportString = "Updating market " + i + " - " + allmkts[i].question + ": " + this.allCachedMarkets[i].uniqueTraders.length;
                        this.allCachedMarkets[i] = this.cachifyMarket(await getFullMarket(allmkts[i].id));
                        reportString += ` ==> ${this.allCachedMarkets[i].uniqueTraders.length}`;
                        this.log.sublog(reportString);
                    }
                    catch (e) {
                        console.log(e);
                        throw new Error();
                    }
                }
            } else {
                if (this.allCachedMarkets[i].createdTime < allmkts[i].createdTime) {
                    this.log.write(`${this.allCachedMarkets[i].question} was not found in the API results and was deleted.`);
                    this.allCachedMarkets.splice(i, 1);
                    i--;
                }
                else {
                    let e = new Error("For some reason the API provided a market not present in the market cache, which predates the market cache's last run.")
                    this.log.write(e.message);
                    throw e;
                }
            }
            i++;
        }

        this.allCachedMarkets = this.sortListById(this.allCachedMarkets);
        this.log.write(reportString);
    }

    /**
     * Creates a copy of the market cache (we don't want to lose that hard work in the event of a save error, etc.)
     */
    async backupCache() {
        try {
            renameSync("/temp/markets.json", "/temp/marketsBACKUP" + dateFormat(undefined, 'yyyy-mm-d_h-MM_TT') + ".json");
            this.log.write("Cache backup created");
        } catch (e) {
            this.log.write("Cache backup failed");
            this.log.write("Cache backup failed: " + e);
            console.log(e)
        }

    }

    /**
     * Saves the market cache to a file so we don't have to download thousands of markets every time we start the program.
     */
    async saveCache() {

        let cacheCopy = this.allCachedMarkets.slice();
        for (let i in cacheCopy) {
            cacheCopy[i].bets = [];
            cacheCopy[i].aggBets = [];
        }
        let stream = await writeFile("/temp/markets.json", JSON.stringify(cacheCopy));
    }

    /**
     * converts market listings into a pared down form we can save locally. (Saving only data we intend to use, or which doesn't take up much space)
     * @param {*} mkt 
     * @returns 
     */
    stripFullMarket(mkt) {

        let cmkt = mkt;
        cmkt.uniqueTraders = [];

        delete cmkt.comments;
        delete cmkt.answers;
        delete cmkt.description;
        delete cmkt.textDescription;

        return cmkt;
    }

}