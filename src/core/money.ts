/** Supported PayPal currencies with two decimal places. JPY, HUF and TWD require a
 * different minor-unit representation and must never be formatted as cents here. */
const CENT_CURRENCIES = new Set(["AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "ILS", "MYR", "MXN", "NZD", "NOK", "PHP", "PLN", "GBP", "RUB", "SGD", "SEK", "CHF", "THB", "USD"]);
export const supportsCentCurrency = (currency: string): boolean => CENT_CURRENCIES.has(currency);
