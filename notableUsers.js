
export const SAFE = 0;
export const DANGEROUS = 0.66;
export const HIGHLY_DANGEROUS = 1;

export const THIS_BOT = 326747;
export const RIVAL_BOT = 930845;
export const ACC = 2384278;


export function userHasTrait(uid, prop, value) {

    let thisUser = notableUsers.find((u) => { return (u.id === uid); });
    if (thisUser === undefined) { 
        return false; 
    }
    if (thisUser.altOf !== undefined) {
        thisUser = notableUsers.find((u) => { return (u.id === thisUser.altOf) });
    }
    if (thisUser[prop]===value){
        return true;
    }
    return false;


}

const notableUsers = [
    {
        "id": "ilJdhpLzZZSUgzueJOs2cbRnJn82",
        "name": "Botlab",
        "type": THIS_BOT,
        "insiderTradingRisk": SAFE
    },    
    {
        "id": "jO7sUhIDTQbAJ3w86akzncTlpRG2",
        "name": "Michael Wheatley",
        "insiderTradingRisk": SAFE
    },    
    {
        "id": "w1knZ6yBvEhRThYPEYTwlmGv7N33",
        "name": "v",
        "type": RIVAL_BOT
    },
    {
        "id": "BhNkw088bMNwIFF2Aq5Gg9NTPzz1",
        "name": "acc",
        "type": RIVAL_BOT
    },
    {
        "id": "jOl1FMKpFbXkoaDGp2qlakUxAiJ3",
        "name": "Spindle",
        "creator": DANGEROUS
    },
    {
        "id": "MxdyEeVgrFMTDDsPbXwAe9W1CLs2",
        "name": "Gurkenglas",
        "creator": DANGEROUS
    },
    {
        "id": "IEVDP2LTpgMYaka38r1TVZcabWS2",
        "name": "GeorgeVii",
        "creator": DANGEROUS,
        "user": DANGEROUS
    },
    {
        "id": "4JuXgDx47xPagH5mcLDqLzUSN5g2",
        "name": "BTE",
        "insiderTradingRisk": SAFE
    },
    {
        "id": "prSlKwvKkRfHCY43txO4pG1sFMT2",
        "altOf": "4JuXgDx47xPagH5mcLDqLzUSN5g2",
        "name": "BTE_FTP"
    },
    {
        "id": "Y8xXwCCYe3cBCW5XeU8MxykuPAY2",
        "name": "Yev",
        "creator": HIGHLY_DANGEROUS,
        "user": DANGEROUS
    },
    {
        "id": "ymezf2YMJ9aaILxT95uWJj7gnx83",
        "altOf": "ymezf2YMJ9aaILxT95uWJj7gnx83",
        "name": "Yev's Bot (NotMyPresident)"
    },
    {
        "id": "Y96HJoD5tQaPgbKi5JEt5JuQJLN2",
        "altOf": "ymezf2YMJ9aaILxT95uWJj7gnx83",
        "name": "LiquidityBonusBot"
    },

    {
        "id": "ffwIBb255DhSsJRh3VWZ4RY2pxz2",
        "name": "Predictor"
    },
    {
        "id": "wjbOTRRJ7Ee5mjSMMYrtwoWuiCp2",
        "name": "Gigacasting",
        "creator": DANGEROUS
    },
    {
        "id": "EFzCw6YhqTYCJpeWHUG6p9JsDy02",
        "name": "William Hargraves",
        "creator": DANGEROUS,
        "user": HIGHLY_DANGEROUS
    },
    {
        "id": "UN5UGCJRQdfB3eQSnadiAxjkmRp2",
        "altOf": "EFzCw6YhqTYCJpeWHUG6p9JsDy02"
    },
    {
        "id": "9B5QsPTDAAcWOBW8NJNS7YdUjpO2",
        "name": "john garland",
        "altOf": "EFzCw6YhqTYCJpeWHUG6p9JsDy02"
    },
    {
        "id": "KIpsyUwgKmO1YXv2EJPXwGxaO533",
        "name": "Market Maker",
        "creator": DANGEROUS,
        "user": HIGHLY_DANGEROUS
    },
    {
        "id": "VI8Htwx9JYeKeT6cUnH66XvBAv73",
        "name": "Douglaz", //???
        "creator": DANGEROUS,
        "user": HIGHLY_DANGEROUS
    },
    {
        "id": "n820DjHGX9dKsrv0jHIJV8xmDgr2",
        "name": "ZZZ",
        "creator": HIGHLY_DANGEROUS,
        "user": DANGEROUS
    },
    {
        "id": "w07LrYnLg8XDHySwrKxmAYAnLJH2",
        "altOf": "n820DjHGX9dKsrv0jHIJV8xmDgr2"//ZZZZZZZ
    },
    {
        "id": "U7KQfJgJp1fa35k9EXpQCgvmmjh1",
        "altOf": "n820DjHGX9dKsrv0jHIJV8xmDgr2"//ZZZZZZZ
    },
    {
        "id": "rVaQiGT7qCRfAD9QDQQ8SHxvvuu2",
        "altOf": "n820DjHGX9dKsrv0jHIJV8xmDgr2"//ZZZZZZZ
    },
    {
        "id": "wuOtYy52f4Sx4JFfT85LpizVGsx1",
        "altOf": "n820DjHGX9dKsrv0jHIJV8xmDgr2"//ZZZZZZZ
    },
    {
        "id": "I8VZW5hGw9cfIeWs7oQJaNdFwhL2",
        "altOf": "n820DjHGX9dKsrv0jHIJV8xmDgr2"//ZZZZZZZ
    },
    {
        "id": "kydVkcfg7TU4zrrMBRx1Csipwkw2",
        "name": "Catnee",
        "altOf": "n820DjHGX9dKsrv0jHIJV8xmDgr2" //ZZZZZZZ
    },
    {
        "id": "QQodxPUTIFdQWJiIzVUW2ztF43e2",
        "name": "Bobyouname", //made a bot-exploity market
        "creator": DANGEROUS,
    },
    {
        "id": "K2BeNvRj4beTBafzKLRCnxjgRlv1",
        "name": "Simon", //made the boilerplate bot-exploiting market
        "creator": DANGEROUS
    },
    {
        "id": "zgCIqq8AmRUYVu6AdQ9vVEJN8On1",
        "name": "firstuserhere" //made the boilerplate bot-exploiting market
        //asked nicely not to be blacklisted anymore
    },
    {
        "id": "BB5ZIBNqNKddjaZQUnqkFCiDyTs2",
        "name": "nfd", //made the boilerplate bot-exploiting market
        "creator": DANGEROUS
    }


]

// Some basic tests. Should display T - F - T.
// console.log(userHasTrait("ilJdhpLzZZSUgzueJOs2cbRnJn82", "type", THIS_BOT))
// console.log(userHasTrait("BB5ZIBNqNKddjaZQUnqkFCiDyTs2", "type", THIS_BOT))
// console.log(userHasTrait("wuOtYy52f4Sx4JFfT85LpizVGsx1", "user", DANGEROUS))