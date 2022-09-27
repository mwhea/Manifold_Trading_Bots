import dateFormat, { masks } from "dateformat";


export function isBettable(mkt){
    if(mkt.isResolved == true){return false;}

    //is a markets close date in the past
    let clock = new Date();
    if (mkt.closeTime < clock.getTime()) {return false;}
    
    return true;
}

export function sanitizeFilename(name) {
    return name
        .replace(/\s/g, "_")
        .replace("%", "")
        .replace("?", "")
        .replace(/\,/g, "")
        .replace(/\"/g, "")
        .replace(/\\/g, "-")
        .replace(/\//g, "-");
}

export function dToP(d){
    if (d>.99 || d<.01){
        return (Math.round(d*1000))/10+"%";
    }
    return Math.round(d*100)+"%";
}


export function roundToPercent(limit){
    
    return parseFloat(limit.toFixed(2));
}

export function getIdOfAnswer(mkt, answer){
    return mkt.answers.find((a) => {return (a.text == answer);}).number;
}



export function consoleReport(string){
    let today = new Date();
    
    console.log("["+dateFormat(today, 'yyyy-mm-d h:MM:ss TT')+"] "+string);
}

export function restoreProbs(mkt, alpha){

}

export function betWithinInterval(bet, time1, time2){

    if (bet.amount==0){
        return true;
    }
    else {
        return false;
    }
}

export function isUnfilledLimitOrder(bet){

    if (bet.amount==0){
        return true;
    }
    else {
        return false;
    }
}

//I suspect that whether or not to take the 
export function discountDoublings(bet){
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
    console.log(e);
 }

}