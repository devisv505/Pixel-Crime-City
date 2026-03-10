export function createNetworkFeature(deps) {
  return {
    wsUrl: deps.wsUrl,
    sendBuy: deps.sendBuy,
    sendChat: deps.sendChat,
  };
}
