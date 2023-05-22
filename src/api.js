import 'dotenv/config'
import fetch from 'node-fetch'
import {
  sleep
} from './utilityFunctions.js';

const API_URL = process.env.APIURL;

export const latestBets = async (num) => {
  try {
    let result = await fetch(`${API_URL}/bets?limit=${num}`)
    result = result.json()
    return result;
  }
  catch (e) {
    console.log(e);
    return undefined;
  }
}

export const fetchUserById = async (id) => {
  return fetch(`${API_URL}/user/by-id/${id}`).then(
    (res) => res.json()
  );
}

export const fetchMe = async (key) => {
  return fetch(`${API_URL}/me`, {
    headers: {
      Authorization: `Key ${key}`
    }
  }).then(
    (res) => res.json()
  )
}

export const fetchFullMarket = async (id) => {
  const market = await fetch(`${API_URL}/market/${id}`).then(
    (res) => {
      let rVal = res.json();
      if (rVal === undefined) { rVal = res; }
      return rVal;
    }
  )
  return market
}

export const fetchMarketsInGroup = async (id) => {
  const markets = await fetch(`${API_URL}/group/by-id/${id}/markets`).then(
    (res) => res.json()
  )

  return markets
}

export const fetchMarketBySlug = async (slug) => {
  const market = await fetch(`${API_URL}/slug/${slug}`).then(
    (res) => res.json()
  )

  return market
}

export const slugToId = async (slug) => {
  const market = await fetch(`${API_URL}/slug/${slug}`).then(
    (res) => res.json().contractId
  )
  return market
}

export const fetchBetsByMarket = async (id, limit) => {
  try {
    const bets = await fetch(`${API_URL}/bets?contractId=${id}`).then(
      (res) => res.json()
    )
    return bets
  } catch (e) {
    console.log(e)
    return [];
  }
}

export const fetchUsersBets = async (username, bets) => {
  let url = `${API_URL}/bets?username=${username}`;
  if (bets !== undefined) {
    url += `&limit=${bets}`;
  }
  return fetch(url).then(
    (res) => res.json()
  )
}

export const fetchBets = async (limit = 1000, before) => {

}

export const fetchMarkets = async (limit = 1000, before) => {

  let results = null;
  let markets = null;
  let failed = true;
  while (failed) {
    try {
      markets = await fetch(
        before
          ? `${API_URL}/markets?limit=${limit}&before=${before}`
          : `${API_URL}/markets?limit=${limit}`
      ).then((res) => { results = res; return res.json(); })
      markets[markets.length - 1].id
      failed = false;
    }
    catch (e) {
      console.log(e);
      console.log(results);
      console.log(before
        ? `${API_URL}/markets?limit=${limit}&before=${before}`
        : `${API_URL}/markets?limit=${limit}`);
      sleep(5000)
    }
  }


  return markets
}


export const fetchAllMarkets = async (typeFilters, outcomeFilter) => {
  const allMarkets = []
  let before = false

  while (true) {
    const markets = await fetchMarkets(1000, before)
    try {
      allMarkets.push(...markets)
    }
    catch (e) {
      console.log(e)
      console.log(before)
      console.log(markets)
    }
    before = markets[markets.length - 1].id

    if (markets.length < 1000) break
  }

  if (typeFilters !== undefined || outcomeFilter !== undefined) {
    for (let i = 0; i < allMarkets.length;) {
      if (outcomeFilter === "UNRESOLVED" && allMarkets[i].isResolved == true) {
        allMarkets.splice(i, 1);
      }
      else if (outcomeFilter === "RESOLVED" && allMarkets[i].isResolved == false) {
        allMarkets.splice(i, 1);
      }
      else if (typeFilters !== undefined && typeFilters.find((e) => { return (allMarkets[i].outcomeType === e); }) === undefined) {
        allMarkets.splice(i, 1);
      }
      else {
        i++;
      }

    }
  }


  return allMarkets
}

export const fetchUsers = async (limit = 1000, before) => {

  let results = null;
  let users = null;
  try {
    users = await fetch(
      before
        ? `${API_URL}/users?limit=${limit}&before=${before}`
        : `${API_URL}/users?limit=${limit}`
    ).then((res) => { try { results = res.json(); } catch (e) { console.log(e) }; return results; })
      .catch((err) => { console.log(err) })
  }
  catch (e) {
    console.log(e);
    console.log(results);
  }

  return users
}

export const fetchAllUsers = async () => {

  try {
    const allUsers = []
    let before = 0

    while (true) {
      await sleep(50);
      const users = await fetchUsers(1000, before)

      console.log("adding users " + before + " onwards");
      allUsers.push(...users)
      before = users[users.length - 1].id

      if (users.length < 1000) break
    }
    return allUsers
  } catch (e) {
    console.log(e);
  }
}

export const placeBet = (bet, key) => {
  return fetch(`${API_URL}/bet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${key}`,
    },
    body: JSON.stringify(bet),
  }).then((res) => res.json())
}

/**
 * Cancels a limit order
 * @param {*} betId : the id of the limit order
 * @param {*} key : user's API key
 * @returns 
 */
export const cancelBet = (betId, key) => {
  return fetch(`${API_URL}/bet/cancel/${betId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${key}`,
    },
  }).then((res) => res.json())
}

export const betAndCancel = (betId, key) => {

}