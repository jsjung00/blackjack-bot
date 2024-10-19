import { getRedisClient } from "./lib/redis.js";
import { run, HandlerContext } from "@xmtp/message-kit";
import { startCron } from "./lib/cron.js";
import { RedisClientType } from "@redis/client";

//Tracks conversation steps
const inMemoryCacheStep = new Map<string, number>();

interface GameState {
  playerHand: number[];
  dealerHand: number[];
  bet: number;
  balance: number;
}

const gameStates = new Map<string, GameState>();

const redisClient: RedisClientType = await getRedisClient();

let clientInitialized = false;

function drawCard(): number {
  return Math.floor(Math.random() * 10) + 1;
}

function calculateHandValue(hand: number[]): number {
  return hand.reduce((sum, card) => sum + card, 0);
}

function startNewGame(address: string, currentBalance: number): GameState {
  const newState: GameState = {
    playerHand: [drawCard(), drawCard()],
    dealerHand: [drawCard()],
    bet: 0,
    balance: currentBalance,
  };
  gameStates.set(address, newState);
  return newState;
}

run(async (context: HandlerContext) => {
  const {
    v2client,
    message: {
      content: { content: text },
      typeId,
      sender,
    },
  } = context;

  if (!clientInitialized) {
    startCron(redisClient, v2client);
    clientInitialized = true;
  }
  if (typeId !== "text") {
    /* If the input is not text do nothing */
    return;
  }

  const lowerContent = text?.toLowerCase();
  //restart condition
  if (lowerContent === "restart") {
    gameStates.set(sender.address, startNewGame(sender.address, 1000));
    inMemoryCacheStep.set(sender.address, 0);
  }

  let cacheStep = inMemoryCacheStep.get(sender.address) || 0;
  let message = "";
  let gameState =
    gameStates.get(sender.address) || startNewGame(sender.address, 1000);

  if (cacheStep === 0) {
    message = `Welcome to blackjack! Your balance is $${gameState.balance}.\n Place your bet (or type 'quit' to quit):`;
    // Move to the next step
    inMemoryCacheStep.set(sender.address, cacheStep + 1);
  } else if (cacheStep === 1) {
    if (lowerContent === "quit") {
      message = "Thanks for playing, till next time.";
      inMemoryCacheStep.set(sender.address, 0);
      gameStates.delete(sender.address);
    } else {
      const bet = parseInt(text);
      if (isNaN(bet) || bet <= 0 || bet > gameState.balance) {
        message = `Invalid bet. Please enter number between 1 and ${gameState.balance}:`;
      } else {
        gameState.bet = bet;
        const playerValue = calculateHandValue(gameState.playerHand);
        message = `Your bet: $${bet}\n Your hand: ${gameState.playerHand.join(", ")} (Total: ${playerValue})\nDealer's up card: ${gameState.dealerHand[0]}\n\nDo you want to (h)it or (s)tand?`;
        inMemoryCacheStep.set(sender.address, 2);
      }
    }
  } else if (cacheStep === 2) {
    if (lowerContent === "h") {
      gameState.playerHand.push(drawCard());
      const playerValue = calculateHandValue(gameState.playerHand);
      if (playerValue > 21) {
        gameState.balance -= gameState.bet;
        if (gameState.balance <= 0) {
          message = `Your hand: ${gameState.playerHand.join(", ")} (Total: ${playerValue})\nBust! You lose $${gameState.bet}.\n\nThe gods were not in your favor. You've lost all your money. Type 'restart' to play again with a fresh balance of $1000.`;
          inMemoryCacheStep.set(sender.address, 0);
          gameState.balance = 0;
        } else {
          message = `Your hand: ${gameState.playerHand.join(", ")} (Total: ${playerValue})\nBust! You lose $${gameState.bet}.\nYour new balance is $${gameState.balance}.\n\nPlace your next bet (or type 'quit' to quit):`;
          inMemoryCacheStep.set(sender.address, 1);
          gameState = startNewGame(sender.address, gameState.balance);
        }
      } else {
        message = `Your hand: ${gameState.playerHand.join(", ")} (Total: ${playerValue})\nDo you want to (h)it or (s)tand?`;
      }
    } else if (lowerContent === "s") {
      while (calculateHandValue(gameState.dealerHand) < 17) {
        gameState.dealerHand.push(drawCard());
      }
      const playerValue = calculateHandValue(gameState.playerHand);
      const dealerValue = calculateHandValue(gameState.dealerHand);
      let result;
      if (dealerValue > 21 || playerValue > dealerValue) {
        result = `You win $${gameState.bet}!`;
        gameState.balance += gameState.bet;
      } else if (playerValue < dealerValue) {
        result = `You lose $${gameState.bet}`;
        gameState.balance -= gameState.bet;
      } else {
        result = "It's a tie.";
      }
      let handResultMessage = `Your hand: ${gameState.playerHand.join(", ")} (Total: ${playerValue}) \nDealer's hand: ${gameState.dealerHand.join(", ")} (Total: ${dealerValue})\n${result}`;

      //Terminating condition
      if (gameState.balance <= 0) {
        message =
          "The gods were not in your favor. Thanks for playing, till next time. Type 'restart' to restart the game.";
        inMemoryCacheStep.set(sender.address, 0);
        gameStates.delete(sender.address);
      } else {
        message = `${handResultMessage}\nYour new balance is $${gameState.balance}.\n\nPlace your next bet (or type 'quit' to quit):`;
        inMemoryCacheStep.set(sender.address, 1);
        gameState = startNewGame(sender.address, gameState.balance);
      }
    } else {
      message = "Invalid option. Press 'h' to hit or 's' to stand";
    }
  }

  gameStates.set(sender.address, gameState);
  //Send the message
  await context.reply(message);
});
