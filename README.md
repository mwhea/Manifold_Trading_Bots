# component Bots

## Attritiontrader

### How it works
About 20% of Manifold markets take the form "Will [EVENT] happen by [DATE]." In theory, when the event in question is unscheduled, the probabilities in these markets should slope gradually downwards over the course of their lifespan. The event has failed to happen and the remaining time for it to do so has diminished. 

In practice this is too much rote work for traders to bother with, and the probabilities on these markets decrease in stops and starts.

This bot checks up on a list of such markets and periodically adjusts the probability downwards after periods of inactivity.

### Also included
Also included is a tool for rapidly viewing and categorizing markets, under the /marketpicker folder. It's presently in a primitive state and needs to be hosted on localhost to run.

## Whaler

### How it works
Some of the most lucrative trades on Manifold come from being the first to catch huge, misjudged trades from new users and troll accounts, and being the first to trade against them. This bot trading strategy scans all markets for price movements, and investigates the new trades to identify if they match this pattern, if so, it takes the other side of that trade. This strategy has been configured to trade aggressively enough that it also makes a tidy profit using a more general strategy you could call "retroactive market making": by trading against large price swings in either direction, the bot makes money in the same way as if it had placed limit orders on either side of the market probability. Retroactive market making has the disadvantage that it's beaten to the punch by existing limit orders, but as a bot, it's still likely to get there before any human trader. But at the same time, it allows the bot to make some basic checks concerning the strength of the bet, for instance, it can avoid trading against the market creator or John Beshir, mitigating one o fthe biggest risks in the typical limit order.  

## Unfinished Bots

### Streaker
This code checks if the current user has placed a bet in the last 18 hours, and if not, places a trivial bet to activate the user's betting streak. As there's no lastBet attribute on the User API endpoint, this component is waiting on planned additions to the bot account, specifically, the recording of placed bets. 

### Velocity Slayer
Several times I noticed a rival bot, velocity, trading against itself: bouncing a price between 6% and 0,2% indefinitely. I wrote a script to market-make between both halves of Velocity's split personality in order to provide social value by assisting in price discovery. And incidentally, siphon funds out of its account. After one successful test run of the script, the dubious behaviour has since failed to recur, so if the opportunity does arise again, the code would first need to be written to be more general: in place at present is only a prototype tailored for the example market I had at hand. 
