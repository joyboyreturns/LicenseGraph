// Usage: npm run sandbox:order            create a Sandbox order and print the approval link
//        npm run sandbox:order -- capture  capture the last order after the buyer approved it
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { configFromEnv, createPayPalClient } from "../src/payments/paypal";

const STATE = ".sandbox-order.json";
const client = createPayPalClient(configFromEnv());

if (process.argv[2] === "capture") {
  const { orderId } = JSON.parse(readFileSync(STATE, "utf8")) as { orderId: string };
  const done = await client.captureOrder(orderId, randomUUID());
  console.log(`Captured: order ${done.id}, status ${done.status}, capture ${done.captureId}, ${done.amount.value} ${done.amount.currency}`);
} else {
  const order = await client.createOrder({
    amountCents: 1000,
    currency: "USD",
    referenceId: "licensegraph-test",
    description: "LicenseGraph Sandbox test purchase",
    requestId: randomUUID(),
  });
  writeFileSync(STATE, JSON.stringify({ orderId: order.id }));
  console.log(`Order ${order.id} created (${order.status}).\nApprove it as the Sandbox buyer here:\n${order.approveUrl}\nThen run: npm run sandbox:order -- capture`);
}
