import { privateRequest } from "@/src/marketplace/http";
const unavailable = () => Response.json({ enabled: false, user: null }, { headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) { return await privateRequest(request) ?? unavailable(); }
export async function POST(request: Request) { return await privateRequest(request) ?? unavailable(); }
