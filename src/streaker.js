import {
    fetchMarketBySlug,
    fetchUsersBets,
    placeBet
} from './api.js';

const dummyMarkets = [
    // await fetchMarketBySlug("market-resolution-is-yes-but-undox"),
    // await fetchMarketBySlug("this-question-will-resolve-positive-5c753f5a33e1"),
    await fetchMarketBySlug("this-market-resolves-yes-except-if")
];

export class Streaker {

    constructor(settings) {

        this.settings = settings;

    }

    async keepTheStreakAlive() {
        let time = new Date();

        for (let i in this.settings.accountsToMaintain) {
            let lastBet = (await fetchUsersBets(this.settings.accountsToMaintain[i], 1))[0];
            if (lastBet.createdTime + (1000 *60*60 * 16) < time.getTime()) {
                console.log("streaker placing bet for "+this.settings.accountsToMaintain[i]);
                let j = 0;
                let bet = undefined;
                let key = undefined;

                //this part is temporarily hard-coded 
                if(this.settings.accountsToMaintain[i]==="runebot"){key=process.env.RUNIKEY;}
                else if(this.settings.accountsToMaintain[i]==="MichaelWheatley"){key=process.env.MAINACCTKEY;}
                else if(this.settings.accountsToMaintain[i]==="Botlab"){key=process.env.APIKEY;}

                do {
                    bet = {
                        contractId: `${dummyMarkets[j++].id}`,
                        outcome: "YES",
                        amount: 1
                    }
                    console.log(await placeBet(bet, key));
                } while ((await placeBet(bet, key)).betId === undefined);
            }
        }
    }
}