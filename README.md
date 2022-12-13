# See it in action!

The bot's trades can be viewed at:
https://manifold.markets/Botlab?tab=portfolio

# Component Bots

## Whaler

### How it works
Some of the most lucrative trades on Manifold come from being the first to catch huge, misjudged trades from new users and troll accounts, and being the first to trade against them. This bot trading strategy scans all incoming bets to detect large price movements, and looks at the larger context to identify if they match this pattern. <br/> 
This strategy has been configured to trade aggressively enough that it also makes a tidy profit using a more general strategy one could call "retroactive market making": by trading against large price swings in either direction, the bot makes money in the same way as if it had placed limit orders on either side of the market probability. Retroactive market making has the disadvantage that it's beaten to the punch by existing limit orders, but, being executed by a bot, it's still likely to outpace manual trades by any human trader. Eschewing limit orders has its advantage: it allows the bot to make some basic checks concerning the strength of the bet, for instance, it can avoid trading against the market creator or members of the leaderboard, mitigating one of the biggest risks implicit in the typical limit order.  

## Attritiontrader

### How it works
About 20% of Manifold markets take the form "Will [EVENT] happen by [DATE]." In theory, when the event in question is unscheduled, the probabilities in these markets should slope gradually downwards over the course of their lifespan. The event has failed to happen and the remaining time for it to do so has diminished. 

In practice this is too much rote work for traders to bother with, and the probabilities on these markets decrease in stops and starts.

This bot checks up on a list of such markets and periodically adjusts the probability downwards after periods of inactivity.

### Also included
Also included is a tool for rapidly viewing and categorizing markets, under the /marketpicker folder. It's presently in a primitive state and needs to be hosted on localhost to run.

## Streaker
This code checks if the current user has placed a bet in the last 18 hours, and if not, places a trivial bet to activate the user's betting streak.
