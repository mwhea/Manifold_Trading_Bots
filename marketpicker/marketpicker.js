import {
    getAllMarkets
} from '../api.js';


let markets = [];
let listEntry = {};
let whitelist = [];
let thisMarket = null;
let clock = new Date();

const getWhitelist = () => {
    return [];
}

const initialize = async () => {

    whitelist = await getWhitelist();
    markets = await getAllMarkets();

    console.log(markets.length);
    for (let i = 0; i < markets.length; i++) {
        if (markets[i].isResolved == true || markets[i].closeTime < clock.getTime() || markets[i].outcomeType != "BINARY") {
            if (i % 10 == 0) { console.log(i + ": " + marketString(markets[i])); }
            let deletedMarket = markets.splice(i, 1);
            if (i % 10 == 0) { console.log(i + ": " + "deleted: " + marketString(deletedMarket[0])); }
            i--;
        }
        else {
            if (i % 10 == 0) { console.log(markets[i].question + " " + markets[i].isResolved + " " + markets[i].url); }
        }
    }
    console.log(markets.length);
    markets.sort((m, n)=> {return (n.closeTime-m.closeTime);});
    reset();

    document.getElementsByClassName("marketClassifier")[0].addEventListener('click', function (){registerMarket('slopingUp');});
    document.getElementsByClassName("marketClassifier")[1].addEventListener('click', function (){registerMarket('indeterminate');});
    document.getElementsByClassName("marketClassifier")[2].addEventListener('click', function (){registerMarket('slopingDown');});
    document.getElementsByClassName("marketClassifier")[3].addEventListener('click', function (){registerMarket('skip');});
    document.getElementsByClassName("exitButton")[0].addEventListener('click', function (){exit();});
}

function marketString(mkt) {
    return mkt.question + " " + mkt.isResolved + " " + mkt.url;
}

function reset() {

    thisMarket = markets.pop();
    document.getElementsByTagName("iframe")[0].setAttribute("src", thisMarket.url.replace("//manifold.markets", "//manifold.markets"));

}

function registerMarket(value) {

    if (value != 'skip') {
        whitelist.push({ "name": `${thisMarket.question}`, "id": `${thisMarket.id}`, "value": `${value}` });
    }
    reset();
}

function exit() {

    document.getElementById("json_output").innerHTML = JSON.stringify(whitelist);
}

await initialize();
