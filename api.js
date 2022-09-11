import 'dotenv/config'
import fetch from 'node-fetch'


const yourKey = process.env.APIKEY;
const API_URL = "https://manifold.markets/api/v0";

export const getFullMarket = async (id) => {
    const market = await fetch(`${API_URL}/market/${id}`).then(
      (res) => res.json()
    )
    return market
  }

  const getMarkets = async (limit = 1000, before) => {
    const markets = await fetch(
      before
        ? `${API_URL}/markets?limit=${limit}&before=${before}`
        : `${API_URL}/markets?limit=${limit}`
    ).then((res) => res.json())
  
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
      console.log('Loaded', allMarkets.length, 'markets', 'before', before)
  
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