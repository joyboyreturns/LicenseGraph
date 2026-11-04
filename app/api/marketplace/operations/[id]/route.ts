import { privateRequest } from "@/src/marketplace/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return await privateRequest(request) ?? Response.json({ error: "Private workspace is not configured." }, { status: 503 }); }
