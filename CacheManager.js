import {
    fetchAllMarkets,
    fetchUserById,
    fetchFullMarket,
    fetchAllUsers,
    fetchBetsByMarket,
    fetchMarketsInGroup
} from './api.js';

import {
    renameSync,
    statSync,
    existsSync
} from 'fs';

import {
    readFile,
    writeFile
} from 'fs/promises';

import dateFormat, { masks } from "dateformat";

import { SECOND, MINUTE, HOUR, DAY } from "./timeWords.js";

import { Logger } from "./Logger.js";

import { sleep } from './utility_functions.js';
import { markAsUntransferable } from 'worker_threads';

const CACHEDIR = process.env.CACHEDIR;
const CACHE_MIN_FRESHNESS = 20 * MINUTE;
const USER_CACHE_MIN_FRESHNESS = 1 * DAY;

export const UT_THRESHOLD = 20;


/**
 * The CacheManager class stores local copies of every user and market
 */
export class CacheManager {

    constructor(logger) {

        this.log = logger;
        this.blacklistedGroups = ["IiNevwTtyukII0eSmPIB"];
        this.blacklist=[];
        this.users = [];
        this.markets = [];

    }

    /**
     * Loads the internal user & market caches from file or generates them from scratch if need be.
     */
    async fillCaches() {

        this.updateBlacklist();

        try {
            this.markets = await readFile(new URL(`${CACHEDIR}/markets.json`, import.meta.url));
            this.markets = JSON.parse(this.markets);

            const { mtime, ctime } = statSync(new URL(`${CACHEDIR}/markets.json`, import.meta.url))

            this.log.write(`Cache age is ${(((new Date()).getTime() - mtime) / 1000) / 60} minutes.`);
            if (mtime < (new Date()).getTime() - (CACHE_MIN_FRESHNESS)) {
                this.log.write((mtime - 0) + " < " + ((new Date()).getTime() - CACHE_MIN_FRESHNESS));
                await this.updateCache(mtime);
                await this.saveCache();
            }
            else {
                this.log.write("Cache up to date");
            }

        }
        catch (e) {
            console.log(e)
            console.log("Unable to load market cache, building one anew")
            this.markets = [];
            await this.buildCacheFromScratch();
        }
        if (this.markets.length === 0) {
            await this.buildCacheFromScratch();
        }

        let shouldIgetAFreshList = false;
        //if((new Date()).getTime()>USERS_CACHE_MIN_FRESHNESS)
        if (!existsSync(new URL(`${CACHEDIR}/users.json`, import.meta.url))) {
            this.log.write("No user cache. Downloading anew.");
            shouldIgetAFreshList = true;
        }
        else {
            const { mtime, ctime } = statSync(new URL(`${CACHEDIR}/users.json`, import.meta.url));
            if (mtime < (new Date()).getTime() - (USER_CACHE_MIN_FRESHNESS)) {
                this.log.write("user cache more than a day old, downloading new copy");
                shouldIgetAFreshList = true;
            }
            else {
                this.log.write("user cache less than a day old, using local copy");
            }
        }
        if (shouldIgetAFreshList) {
            try {
                this.users = this.sortListById(await fetchAllUsers());
            }
            catch (e) {
                console.log(e);
                this.log.write("'/users' endpoint down. Consulting local backup");
                shouldIgetAFreshList = false;
            }
        }
        if (!shouldIgetAFreshList) {
            this.users = await readFile(new URL(`${CACHEDIR}/users.json`, import.meta.url));
            this.users = JSON.parse(this.users);
        }
        if (shouldIgetAFreshList) {
            writeFile(`${CACHEDIR}/users.json`, JSON.stringify(this.users));
        }

        this.log.write(`Filled caches with ${this.markets.length} markets and ${this.users.length} users`);
    }

    /**
     * Binary searches for a user in the cache.
     * @param {*} id 
     * @returns 
     */

    getUserById(id) {
        return this.findIdHolderInList(id, this.users);
    }

    /**
     * Binary searches for a market in the cache.
     * @param {*} id 
     * @returns
     */
    getMarketById(id) {
        return this.findIdHolderInList(id, this.markets);
    }

    /**
     * Variant of the generic binary search which returns the sought item rather than its index
     * @param {*} id 
     * @param {*} list 
     * @returns 
     */
    findIdHolderInList(id, list) {
        let index = this.findIndexInList(id, list);
        if (index === undefined) { return index; }
        else {
            return list[index];
        }
    }

    /**
     * Binary search searches the provided list by ID and returns the index of the sought item
     * @param {*} id 
     * @param {*} list 
     * @returns the sought-after object
     * */
    findIndexInList(id, list) {
        let start = 0;
        let end = list.length - 1;
        let middle;

        let searchLog = "ID " + id + " wasn't found\n";

        while (start <= end) {
            middle = Math.floor((start + end) / 2);

            if (list[middle].id === id) {
                // found the key
                return middle;
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

        searchLog += ("list length: " + (list.length - 1) + "\n");
        try {
            searchLog += ("Immediate Vicinity: " + list[end - 1].id + ", " + list[end].id + ", " + list[end + 1].id);
        } catch (e) {
//TODO: do this properly
        }

        //this.log.write(searchLog);
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
     * This method builds the market cache by querying for full market data of any market we might trade on
     */
    async buildCacheFromScratch() {
        let unprocessedMarkets = [];
        let markets = await fetchAllMarkets(["BINARY", "PSEUDO_NUMERIC"], "UNRESOLVED");
        await this.applyBlacklist(markets);

        for (let i = 0; i < markets.length; i++) {

            if (i % 100 === 0) { this.log.write("pushed " + i + " markets"); }
            unprocessedMarkets.push(fetchFullMarket(markets[i].id));

            //slight delay so the server doesn't reject requests due to excessive volume.
            await sleep(50);

        }

        for (let i in unprocessedMarkets) {

            if (i % 100 === 0) { this.log.write("Cached " + i + " markets"); }
            this.cacheMarket(await unprocessedMarkets[i]);

        }
        this.sortListById(this.markets);
        await this.saveCache();
        await this.backupCache();
    }

    /**
     * Scan the market cache for markets likely to have changed during periods of program inactivity, and check the server for updates to them.
     * @param {*} sinceTime time cache was last updated.
     */
    async updateCache(sinceTime) {

        this.log.write("Updating Stale Cache:\n");

        this.markets = this.markets.sort((a, b) => { return a.createdTime - b.createdTime })
        //Something failed silently (unresponsive console), when I accidentally deleted everything with above loop)
        let allmkts = (await fetchAllMarkets(["BINARY", "PSEUDO_NUMERIC"], "UNRESOLVED")).reverse();
            
        await this.applyBlacklist(allmkts);

        let mktsToAdd = [];

        let i = 0;

        this.log.write("started reviewing mkts")
        while (i < this.markets.length || i < allmkts.length) {

            if (i > this.markets.length - 1) {
                mktsToAdd.push(await this.cachifyMarket(allmkts[i]));
                this.log.sublog("Adding market: " + allmkts[i].question);
                sleep(50);
            }
            else if (this.markets[i].id === allmkts[i].id) {

                if (this.markets[i].uniqueTraders.length < UT_THRESHOLD
                    && (allmkts[i].lastUpdatedTime > sinceTime)) {
                    //you could use something like this for a "hard" refresh                        
                    //let lapse = (new Date()).getTime()-sinceTime;
                    //}  || (lapse>45*MINUTE && allmkts[i].volume7Days>0))) {

                    this.log.write(this.markets[i].question + " : " + allmkts[i].question);
                    try {
                        let reportString = "Updating market " + i + " - " + allmkts[i].question + ": " + this.markets[i].uniqueTraders.length;
                        //TODO: make this more graceful
                        await this.fetchAndSetUniqueTraders(this.markets[i]);
                        reportString += ` ==> ${this.markets[i].uniqueTraders.length}`;
                        this.log.sublog(reportString);
                    }
                    catch (e) {
                        console.log(e);
                        this.log.write("ERROR: Failed to Update unique bettors of: " + this.markets[i].question);
                       // throw e;

                    }
                }
            } else {

                this.log.write(this.markets[i].question + " : " + allmkts[i].question);
                if (this.markets[i].createdTime < allmkts[i].createdTime) {
                    this.log.write(`${this.markets[i].question} was not found in the API results and was deleted.`);
                    this.markets.splice(i, 1);
                    i--;
                }
                else {
                    //there exists some legitimate reasons why the API might markets older than the cache but not in the cache.
                    //maybe the program was off for a time span in which several markets were created, only some of which were subsequently noticed and added.
                    let e = new Error("For some reason the API provided a market not present in the market cache, which predates the market cache's last run.")
                    this.log.write(e.message);
                    //we're not going to throw this error, we're still testing whether its useful.
                    //print the next three pairs in case that helps establish what is going on.
                    for (let j = 0; j < 3; j++) {
                        if (i + j < this.markets[i].id && i + j < allmkts[i].id) {
                            this.log.write(this.markets[i + j].question + " : " + allmkts[i + j].question);
                        }
                    }

                    this.markets.splice(i, 0, await this.cachifyMarket(allmkts[i]));
                    this.log.sublog("Adding market: " + allmkts[i].question);
                }
            }
            i++;
        }

        for (let i in mktsToAdd) {
            this.markets.push(await mktsToAdd[i]);
        }

        this.markets = this.sortListById(this.markets);
    }

    /**
     * Creates a copy of the market cache (we don't want to lose that hard work in the event of a save error, etc.)
     */
    async backupCache() {
        try {
            renameSync(`${CACHEDIR}/markets.json`, `${CACHEDIR}/marketsBACKUP${dateFormat(undefined, 'yyyy-mm-d_h-MM_TT')}.json`);
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

        let cacheCopy = this.markets.slice();
        for (let i in cacheCopy) {
            cacheCopy[i].bets = [];
            cacheCopy[i].aggBets = [];
        }
        await writeFile(`${CACHEDIR}/markets.json`, JSON.stringify(cacheCopy));
    }

    /**
     * This function gets an updated blacklist off the server based on the list of blacklisted groups
     * @returns the filled out blacklist
     */
    async updateBlacklist() {

        //note that the main market-finding functionality is applicable to the cache, not arbitrary lists of markets
        //so we're using a lower level function is calls that can be applied to specific arrays

        this.blacklist = [];
        for (let i in this.blacklistedGroups) {
            let newMkts = await fetchMarketsInGroup(this.blacklistedGroups[i]);
            for (let j in newMkts) {
                if (!newMkts[j].isResolved){
                this.blacklist.push(newMkts[j]);
                }
            }
        }
        this.blacklist = this.sortListById(this.blacklist);
        return this.blacklist;
    }

    /**
     * This function filters lists of markets for markets belonging to the cachemanager's internal list of blacklisted market groups
     * You might do this because a group's markets are structurally unsuited to this bot's strategy,
     * or perhaps a group might request not to have bots trade in their markets.
     * @param {*} mkts 
     * @returns 
     */
    applyBlacklist(mkts){

        //note that the main market-finding functionality is applicable to the cache, not arbitrary lists of markets
        //so we're using a lower level function it calls that can be applied to specific arrays

            for(let j in this.blacklist){
                this.log.write("blacklisted "+this.blacklist[j].question);
                if (this.findIndexInList(this.blacklist[j].id, mkts)!==undefined){
                    let removedmkt = this.markets.splice(this.findIndexInList(this.blacklist[j].id, mkts), 1);
                    this.log.write("removed "+removedmkt.question);
                }
            }
        
        return mkts;
    }

    /**
     * Creates a new array in a market storing only a list of unique trader ids
     * (This is more lightweight than the full bet list for medium-term storage.)
     * @param {*} mkt 
     */
    setUniqueTraders(mkt, bets) {

        mkt.uniqueTraders = [];

        if (bets === undefined) {
            let err = new Error("ERROR: Tried to set the unique traders of a market without providing a valid bet array");
            this.log.write("Market question: " + mkt.question)
            this.log.write("Market bets: ")
            console.log(mkt.bets); //TODO: loop to log this
            for (let i = 0; i < UT_THRESHOLD; i++) {
                mkt.uniqueTraders.push("" + i);
            }
            throw err;
        }

        if (bets !== undefined) {

            for (let i = 0; i < bets.length && mkt.uniqueTraders.length < UT_THRESHOLD; i++) {
                if (mkt.uniqueTraders.find((o) => { return o === bets[i].userId; }) === undefined) {
                    mkt.uniqueTraders.push(bets[i].userId);
                }
            }
        }
    }

    /**
     * This is the function you call instead of setUniqueTraders which also gets the latest bets on that market
     * (which you do not typically have on hand)
     * @param {*} mkt 
     */
    async fetchAndSetUniqueTraders(mkt) {

        let bets = await fetchBetsByMarket(mkt.id);
        this.setUniqueTraders(mkt, bets);
        
    }

    /**
     * Fetches user from server by id, and adds them to user cache.
     * @returns 
     * */
    async addUser(id) {

        let user = await fetchUserById(id);
        this.users.push(user);
        this.users = this.sortListById(this.users);
        return user;

    }


    /**
     * Receives a LiteMarket and processes it into a version suitable for caching.
     * Strips unused fields and fetches bet history to tabulate number of unique bettors.
     * @param {*} mkt 
     */
    async cachifyMarket(mkt) {

        this.stripMarket(mkt);
        await this.fetchAndSetUniqueTraders(mkt);

        return mkt;

    }

    /**
     * Adds a market to the market cache
     * @param {*} mkt 
     */
    async cacheMarket(mkt) {

        this.markets.push(await this.cachifyMarket(mkt));
        //you can make this a lot more efficient with splice()
        this.sortListById(this.markets);

    }

    /**
     * Does the full suite of actions needed to add a market to cache, based on market id, 
     * uses a slightly more efficient async/await queue
     * @param {*} id 
     * @returns the added market
     */
    async downloadAndCacheMarket(id) {
        let mkt = fetchFullMarket(id);
        let bets = fetchBetsByMarket(id);
        mkt = await mkt; 
        this.stripMarket(mkt);
        bets = await bets;
        this.setUniqueTraders(mkt, bets);
        this.markets.push(mkt);
        this.sortListById(this.markets);
        return mkt;
    }

    /**
     * converts market listings into a pared down form we can save locally. (Saving only data we intend to use, or which doesn't take up much space)
     * @param {*} mkt 
     * @returns 
     */
    stripMarket(mkt) {

        let cmkt = mkt;
        cmkt.bets=[];
        cmkt.uniqueTraders = [];

        //we may not need to start with fullmarkets at all, if the only thing we're getting from them is bettor ids.
        // delete cmkt.comments;
        // delete cmkt.answers;
        // delete cmkt.description;
        // delete cmkt.textDescription;

        //removing small data values even litemarkets have, just to save a modicum of extra space.
        delete cmkt.creatorAvatarUrl;
        delete cmkt.url;
        delete cmkt.pool;
        delete cmkt.tags;
        delete cmkt.mechanism;
        delete cmkt.volume;
        delete cmkt.volume7Days;
        delete cmkt.volume24Hours;

        return cmkt;
    }
}