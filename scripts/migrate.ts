import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../lib/db/client";

async function main() {
  const migrationsDir = path.resolve("db/migrations");
  console.log(`Scanning migrations in: ${migrationsDir}`);

  const files = await readdir(migrationsDir);
  const sqlFiles = files
    .filter((f) => f.endsWith(".sql"))
    .sort(); // Sort alphabetically/chronologically

  console.log(`Found ${sqlFiles.length} migration(s) to execute.`);

  for (const file of sqlFiles) {
    const filePath = path.join(migrationsDir, file);
    console.log(`Running migration: ${file}...`);
    const sql = await readFile(filePath, "utf8");

    try {
      await db.execute(sql);
      console.log(`✓ Migration successful: ${file}`);
    } catch (err) {
      console.error(`✗ Migration failed: ${file}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log("All migrations completed successfully!");
}

main()
  .catch((err) => {
    console.error("Migration runner failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.end();
  });
