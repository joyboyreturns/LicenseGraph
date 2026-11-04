import { Database } from "../src/storage/database";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before running migrations.");
const db = Database.connect(process.env.DATABASE_URL);
try { await db.migrate(); console.log("Database migrations passed."); }
finally { await db.pool.end(); }
