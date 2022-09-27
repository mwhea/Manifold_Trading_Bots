import 'dotenv/config'
import fetch from 'node-fetch'

const yourKey = process.env.APIKEY;
const API_URL = process.env.APIURL; 


export const getUserById = async  (id) => {
  return fetch(`${API_URL}/user/by-id/${id}`).then(
    (res) => res.json()
  );
}

export const getMe = () => {
  return fetch(`${API_URL}/me`, {
    headers: {
      Authorization: `Key ${yourKey}`
  }
}).then(
    (res) => res.json()
  )
}

export const getFullMarket = async (id) => {
    const market = await fetch(`${API_URL}/market/${id}`).then(
      (res) => res.json()
    )
    return market
  }

  const getMarkets = async (limit = 1000, before) => {

    let results = null;
    let markets = null;
    try{
    markets = await fetch(
      before
        ? `${API_URL}/markets?limit=${limit}&before=${before}`
        : `${API_URL}/markets?limit=${limit}`
    ).then((res) => {results = res; return res.json();})
    }
    catch(e){
      console.log(e);
      console.log(results);
    }
  
    return markets
  }

  export const getMarketBySlug = async (slug) => {
    const market = await fetch(`${API_URL}/slug/${slug}`).then(
      (res) => res.json()
    )

    return market
  }

  export const getAllMarkets = async () => {
    const allMarkets = []
    let before= 0
  
    while (true) {
      const markets= await getMarkets(1000, before)
  
      allMarkets.push(...markets)
      before = markets[markets.length - 1].id
      
  
      if (markets.length < 1000) break
    }
  
    return allMarkets
  }


  export const placeBet = (bet) => {
    return fetch(`${API_URL}/bet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${yourKey}`,
      },
      body: JSON.stringify(bet),
    }).then((res) => res.json())
  }
  
  export const cancelBet = (betId) => {
    return fetch(`${API_URL}/bet/cancel/${betId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${yourKey}`,
      },
    }).then((res) => res.json())
  }