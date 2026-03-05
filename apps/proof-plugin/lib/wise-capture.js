export function captureWiseProofInputs() {
  const text = (selectorList) => {
    for (const selector of selectorList) {
      const node = document.querySelector(selector);
      if (node && node.textContent && node.textContent.trim()) {
        return node.textContent.trim();
      }
    }
    return "";
  };

  const amountText = text([
    '[data-testid="transfer-amount"]',
    '[data-testid="amount"]',
    '.transfer-amount',
    '.amount'
  ]);

  const recipientText = text([
    '[data-testid="recipient-name"]',
    '.recipient-name',
    '.counterparty-name'
  ]);

  const transferTimeText = text([
    '[data-testid="transfer-time"]',
    '.transfer-time',
    'time'
  ]);

  const pageTitle = document.title;
  const pageUrl = location.href;

  return {
    amountText,
    recipientText,
    transferTimeText,
    pageTitle,
    pageUrl,
    capturedAt: new Date().toISOString()
  };
}
