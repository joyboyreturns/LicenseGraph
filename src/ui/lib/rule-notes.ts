/** When the brief makes each rule relevant, and what a licence that says nothing about it gets. Mirrors RULE_CATALOG; a test keeps the two in step. */
export const RULE_NOTES: Record<string, { applies: string; silent: string; checks?: string }> = {
  "commercial-use": { applies: "The project is commercial.", silent: "A licence always states whether commercial use is allowed; a non-commercial or editorial-only licence fails." },
  territory: { applies: "Always.", silent: "A licence that does not cover every territory the project is released in fails." },
  term: { applies: "Always.", silent: "A licence shorter than the project needs, or ending on a fixed date before the project does, fails." },
  medium: { applies: "The brief names media (web, broadcast, and so on).", silent: "Fails. A licence that does not say which media it covers is not assumed to cover them." },
  attribution: { applies: "The project cannot credit creators.", silent: "Fails. A licence that does not say whether a credit is required is not assumed to need none." },
  sublicensing: { applies: "The project needs to sublicense (to clients or partners).", silent: "Fails. Without a stated grant to sublicense, none is assumed." },
  exclusivity: { applies: "The project needs exclusivity.", silent: "Fails. A licence that does not say it is exclusive is not exclusive." },
  expiry: { applies: "The offer states a last day it can be bought.", silent: "An offer with no expiry is not held to one; an offer past its date fails on the day of purchase." },
  evidence: { applies: "Always.", silent: "Every term must come with a quote that appears in the licence text, or the offer fails." },
  amount: { applies: "Always.", silent: "The price must be a positive whole number of cents that can be added exactly." },
  currency: { checks: "The currency is a code PayPal can settle in whole cents.", applies: "Always.", silent: "An unsupported or malformed currency code fails." },
};
