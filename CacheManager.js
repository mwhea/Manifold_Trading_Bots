import {
    getAllMarkets,
    getUserById,
    getFullMarket,
    getAllUsers
} from './api.js';

import {
    renameSync,
    statSync
} from 'fs';

import{
sleep
} from './utility_functions.js';

import {SECOND, MINUTE, HOUR, DAY} from "./timeWords.js";

import dateFormat, { masks } from "dateformat";
import { Logger } from "./Logger.js";

import {
    readFile,
    writeFile
} from 'fs/promises';

export const UT_THRESHOLD = 20;


/**
 * The CacheManager class stores local copies of every user and market
 */
export class CacheManager {

    constructor(logger) {

        this.log = logger;
        this.users = [];
        this.markets = [];

    }

    /**
     * Loads the internal user & market caches from file or generates them from scratch if need be.
     */
    async fillCaches() {

        this.users = getAllUsers();

        try {
            this.markets = await readFile(new URL('/temp/markets.json', import.meta.url));
            this.markets = JSON.parse(await this.markets);

            const { mtime, ctime } = statSync(new URL('/temp/markets.json', import.meta.url))

            this.log.write(`Cache age is ${(((new Date()).getTime() - mtime) / 1000) / 60} minutes.`);
            if (mtime < (new Date()).getTime() - (4 * HOUR)) {
                this.log.write(mtime + " < " + (new Date()).getTime() + " - " + (30 * MINUTE));
                await this.updateCache(mtime);
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

        this.users = this.sortListById(await this.users);
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
     * Fetches user from server by id, and adds them to user cache.
     * @param {*} id 
     * @returns 
     */
    async addUser(id) {

        let user = await getUserById(id);
        this.users.push(user);
        this.users = this.sortListById(this.users);
        return user;

    }

    /**
     * Binary search which can be used on either the locally stored list of markets or the list of users
     * @param {*} id 
     * @param {*} list 
     * @returns the sought-after object
     * */
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
        this.sortListById(this.markets);
        await this.saveCache();
        await this.backupCache();
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

        this.markets.push(this.cachifyMarket(fmkt));
        this.sortListById(this.markets);

    }

    /**
     * Scan the market cache for markets likely to have changed during periods of program inactivity, and check the server for updates to them.
     *
     * @param {*} sinceTime time cache was last updated.
     */
    async updateCache(sinceTime) {

        this.log.write("Updating Stale Cache:\n");

        this.markets = this.markets.sort((a, b) => { return a.createdTime - b.createdTime })
        //Something failed silently (unresponsive console), when I accidentally deleted everythign with above loop)
        let allmkts = (await getAllMarkets(["BINARY", "PSEUDO_NUMERIC"], "UNRESOLVED")).reverse();
        let mktsToAdd = [];

        let i = 0;
        while (i < this.markets.length || i < allmkts.length) {

            if (i > this.markets.length - 1) {
                mktsToAdd.push(getFullMarket(allmkts[i].id));
                this.log.sublog("Adding market" + allmkts[i].question);
            }
            else if (this.markets[i].id === allmkts[i].id) {

                if (this.markets[i].uniqueTraders.length < UT_THRESHOLD 
                    && (allmkts[i].lastUpdatedTime > sinceTime)){ 
                        //you could use something like this for a "hard" refresh                        
                        //let lapse = (new Date()).getTime()-sinceTime;
                        //}  || (lapse>45*MINUTE && allmkts[i].volume7Days>0))) {

                    this.log.write(this.markets[i].question + " : " + allmkts[i].question);
                    try {
                        let reportString = "Updating market " + i + " - " + allmkts[i].question + ": " + this.markets[i].uniqueTraders.length;
                        this.markets[i] = this.cachifyMarket(await getFullMarket(allmkts[i].id));
                        reportString += ` ==> ${this.markets[i].uniqueTraders.length}`;
                        this.log.sublog(reportString);
                    }
                    catch (e) {
                        console.log(e);
                        throw new Error();
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
                    let e = new Error("For some reason the API provided a market not present in the market cache, which predates the market cache's last run.")
                    this.log.write(e.message);
                    //print the next three pairs in case that helps establish what is goign on.
                    for (let i in 3){
                        this.log.write(this.markets[i].question + " : " + allmkts[i].question);
                    }
                    throw e;
                }
            }
            i++;
        }

        for (let i in mktsToAdd) {
            this.cacheMarket(await mktsToAdd[i]);
        }

        this.markets = this.sortListById(this.markets);
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

        let cacheCopy = this.markets.slice();
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

        //we may not need to start with fullmarkets at all, if the only thing we're getting from them is bettor ids.
        delete cmkt.comments;
        delete cmkt.answers;
        delete cmkt.description;
        delete cmkt.textDescription;

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