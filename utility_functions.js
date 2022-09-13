export function isBettable(mkt){
    if(mkt.isResolved == true){return false;}

    //is a markets close date in the past
    let clock = new Date();
    if (mkt.closeTime < clock.getTime()) {return false;}
    
    return true;
}

export function dToP(d){
    return Math.round(d*100)+"%";
}

export function getIdOfAnswer(mkt, answer){
    return mkt.answers.find((a) => {return (a.text == answer);}).number;
}

export function roundToPercent(limit){
    return parseFloat(limit.toFixed(2));
}

export function restoreProbs(mkt, alpha){

}

//I suspect that whether or not to take the 
export function discountDoublings(bet){
console.log(bet);
 try{
    if(bet.probAfter>bet.probBefore){
        return (1-bet.probBefore)/(1-bet.probAfter);
    }
    else if(bet.probAfter<bet.probBefore){
        return bet.probBefore/bet.probAfter;
    }
    else{
        return 1;
    }
 }
 catch(e){
    
 }

}