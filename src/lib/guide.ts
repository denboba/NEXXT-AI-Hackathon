export function guidedReply(question: string): string {
  const q = question.toLowerCase();
  if (/inflation|purchas|cash/.test(q))
    return "Inflation means the same money buys a little less over time. At an illustrative 5.5% a year, 10,000 lei has about 7,651 lei of today’s purchasing power after five years. Your account balance has not disappeared; prices have risen. Investing may help over time, but can also lose value.";
  if (/withdraw|access|liquid|take.*out|anytime|emergency/.test(q))
    return "Keep an emergency cash buffer separate from investments. Our illustrative funds show a 3–5 business-day withdrawal period, but actual timing, charges, and restrictions depend on the product. You could also receive less than you invested if you sell when markets are down.";
  if (/los|risk|safe|afraid|fall|guarantee/.test(q))
    return "It’s understandable to worry about losses. Investments can fall in value, and none of these example funds guarantees your capital or returns. Bond-focused funds usually fluctuate less than equity funds, but still carry risk. A longer horizon and money you can afford to leave invested can help you manage those ups and downs.";
  if (/fee|cost|tax/.test(q))
    return "Each example fund has an annual fee, shown on its card. Our projection subtracts that fee from the assumed annual return before calculating monthly growth. It does not include taxes, transaction charges, or other costs. Actual fees and taxes may differ; check the product documents before any real decision.";
  if (/stock|bond|fund|diversif/.test(q))
    return "A stock is a small share of a company. A bond is a loan to a company or government. A fund brings many investments together, which can spread your exposure. Spreading risk does not eliminate it: both shares and bonds can lose value.";
  if (/start|small|monthly|compound/.test(q))
    return "You don’t need a large sum to explore investing. Regular monthly contributions build a habit, and any returns can themselves earn returns over time. This is called compounding. Our chart uses end-of-month contributions and a constant illustrative return; real market returns move up and down.";
  return "A useful starting point is your emergency savings, how long you can leave money invested, and how you would feel if its value fell. This is an educational simulation, rather than a personal recommendation. You can ask me about risk, withdrawals, inflation, fees, or how funds work.";
}
