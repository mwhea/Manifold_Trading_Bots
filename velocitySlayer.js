import { formatTimezone } from 'dateformat';
import {
  getMarketBySlug,
  placeBet
} from './api.js';

import {
  readFile,
  writeFile
} from 'fs/promises';
import { sensitiveHeaders } from 'http2';
import { dToP } from './utility_functions.js';

let notableUsers = JSON.parse(
  await readFile(
    new URL('./notableUsers.json', import.meta.url)
  )
);

let settings = JSON.parse(
  await readFile(
      new URL('./botsettings.json', import.meta.url)
  )
).velocitySlayer;

export async function velocitySlayer() {
  let mkt = await getMarketBySlug("planecrash-will-belmarniss-have-any");
  let netPosition = getNetPosition(mkt);

  console.log ("<<< running velocity scan ("+dToP(mkt.probability)+") >>> netpos = "+netPosition);

  let bet = {
    contractId: `${mkt.id}`,
    outcome: "",
    amount: 0
  };

  let legitimateTop = null;

let yesStrikePrice = 0.0018;
if (settings.mode==="sleep"){
  yesStrikePrice = 0.0016;
}
else if (netPosition <0){
  yesStrikePrice+=(-netPosition*0.0000011);
}
let noStrikePrice = 0.038;
if (settings.mode==="sleep"){
  noStrikePrice = 0.06;
}
else if (netPosition >0){
  noStrikePrice+=(-netPosition*0.0000015);
}

  if (mkt.probability < yesStrikePrice) {
    if (netPosition <50) {
    bet.outcome = "YES";
    bet.amount = 3;
    }

  }
  else if (mkt.probability > noStrikePrice) {

    netPosition = getNetPosition(mkt);
    if (netPosition > -1000) {
      bet.outcome = "NO";
      bet.amount = 200;
    }
  }
  else {
    let clock = new Date();
    //if no bets in the last 20m
    if (settings.mode!=="sleep" && mkt.bets[0].createdTime< clock.getTime()-1000*60*20 && !haveIBeenWastingMoneyPokingVelocity(mkt)){
      if (mkt.probability > 0.02) {

          bet.outcome = "NO";
          bet.amount = 50;
      }else {
        bet.outcome = "YES";
          bet.amount = 3;
      }

    }

  }

  if (bet.outcome !== "") {
    await placeBet(bet).then((resjson) => { console.log(resjson); });
  }
}

function getNetPosition(mkt) {
  let netPos = 0;
  for (let b in mkt.bets) {
    if (notableUsers[mkt.bets[b].userId] === "me" && !mkt.bets[b].isRedemption) {
      if (mkt.bets[b].outcome==="YES") {netPos += mkt.bets[b].shares;}
      else if (mkt.bets[b].outcome==="NO") {netPos -= mkt.bets[b].shares;}
    }
  }
  return netPos;
}

function haveIBeenWastingMoneyPokingVelocity(mkt) {
  let numPokes = 0;
  for (let b = 0; b<10 && b<mkt.bets.length;b++) {
    if (notableUsers[mkt.bets[b].userId] == "me") {
      numPokes ++;
    }
  }
  if (numPokes>3) {return true;}
}