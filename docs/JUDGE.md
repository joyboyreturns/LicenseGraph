# Local judge guide

Use Node.js 20.19+ (22 recommended). From the repository:

```sh
npm install
npm run demo
```

Open http://localhost:3000. The first launch builds production assets. After source changes use `npm run demo -- --build`. A different port is supported: `npm run demo -- --port 3400`.

This launcher overrides any local model/payment credentials. Built-in scenarios replay **recorded model output**, and **payments are simulated**: no account, credentials, credits or money are needed. The rules engine runs again on each recorded proposal. The simulator is distinct from PayPal Sandbox.

## Primary journey

1. Home: press **Explore the game trailer demo** beside the Neon Drift case. The brief is worldwide, 24 months, web/social/broadcast, with music, key art and sound effects, under $3,000.
2. Run: watch three proposal rounds and the rejected offers in the rights graph and timeline. Pause or skip to the result. The numbered navigation leads to source evidence and approval.
3. Evidence: open a quotation under **Read the terms behind the decision**. Inspect its source and rule checks; Escape closes the drawer. The compliant bundle totals $2,170. The independent cost check explains the minimum.
4. Approval: press **Review and approve**, enter your name, and **Approve this bundle**. This records approval of the exact verified terms, evidence and prices; changing them invalidates approval.
5. Settlement: create the simulated order, open the payment simulator, and approve the simulated payment. Returning captures the approved amount and starts creator payouts. Inspect each creator outcome separately from capture.
6. Passport: **View Licence Passport**. Nine content checks run in the browser. Review creator outcomes and source evidence; copy the link, download JSON/CSV, or print. Downloaded JSON can be checked on `/verify`, including a deliberately tampered copy. The issuer signature is a separate check; source authenticity and rights ownership are not established by these content checks.
7. Dashboard: return to the run and open **Dashboard**. **What was rejected?** and **Compare offer prices** add validated widgets from the run data, without a model. Layout changes persist in this browser. The optional live assistant requires explicit server configuration and the existing zero-price guard.

## Further exploration and recovery

- Other scenarios remain in the case library. **Exclusive theme tune** demonstrates refusal and negotiation. **Work the alternatives** on each run contains questions, history, negotiation and what-if tools.
- Custom intake: describe a project, inspect found versus assumed requirements, then add text or a text-based PDF. Requirements are validated before the file step. Enter USD budgets with at most two decimal places; malformed input is kept for correction, and errors receive focus. The use selector supports arrow keys and Home/End. Review loaded text and later extracted evidence. Unsupported, empty and unreadable files show recovery guidance and preserve the previous text. Scanned PDFs require transcription; OCR is not provided.
- Without live extraction, use **Use the recorded game trailer**. The brief reader and recorded journeys remain usable offline.
- A pending or ambiguous payout is not permission to send another batch. Inspect individual outcomes and reconcile first. To demonstrate a certain failed submission and its explicit retry, use `npm run demo -- --port 3401 --data-dir .data-demo-failure --fail-first-payout`. Capture stays recorded when payouts fail.
- A shared link is readable, but only the creating browser can approve or pay. Keep the same browser for the primary journey. Signing in is unnecessary.
- Use the header theme toggle for light/dark and the mobile menu at phone widths. The skip link, workbench anchors, inputs, evidence drawer and action buttons support keyboard navigation.

## Submission items supplied by the owner

Deployment remains deferred. No site is published by this work. The owner supplies the judging URL when hosting is approved, the public video under three minutes, final Devpost fields and eligibility/disclosure review, and any desired AG Studio trial licence to remove its watermark. A separate Sandbox recording requires owner-controlled test buyer/creator accounts and human buyer approval. No credentials belong in the submission repository.
