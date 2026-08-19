export function isCurrentSendOperation(activeToken, responseToken) {
  return Number.isSafeInteger(activeToken)
    && Number.isSafeInteger(responseToken)
    && activeToken === responseToken;
}

export function sendStatusLabel({ sent, sending, delayed, error }) {
  if (sent) return "SENT";
  if (sending && delayed) return "CONNECTION DELAYED";
  if (sending) return "SENDING";
  if (error) return "SEND ERROR · RETRY";
  return null;
}
