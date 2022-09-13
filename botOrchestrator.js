import {
    getAllMarkets
}from "./api.js";

import {
    huntWhales
}from "./whaler.js";

const clock = new Date();
const CYCLETIME = 5000;

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

let lastMktList=await getAllMarkets();
let currentMktList=[];

while (true) {

    //streaker();
    //attritionTrade();

    try{lastMktList = await huntWhales(lastMktList);}
    catch(e){
        console.log(e);
        lastMktList=null;
        while (lastMktList==null){
            try{lastMktList=await getAllMarkets();}
            catch(e){
                await sleep(CYCLETIME)
            }
        }
    }
    await sleep(CYCLETIME);

}


