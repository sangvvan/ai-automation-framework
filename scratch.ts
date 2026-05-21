import { getEnv } from "./app/lib/config";
import { buildProvider } from "./app/lib/ai/factory";
import { z } from "zod";
import { loadConfig } from "./app/lib/config";

async function main() {
  loadConfig(); // Ensure env is loaded
  const apiKey = getEnv().CODEX_API_KEY;
  console.log("CODEX_API_KEY is", apiKey ? "SET (length: " + apiKey.length + ")" : "NOT SET");
  
  if (!apiKey) {
    console.log("No API key found in env.");
    return;
  }

  const config = loadConfig();
  const provider = buildProvider({ config, role: "design" });
  console.log("Provider chain:", provider.name);


  try {
    const res = await provider.generateStructured({
      systemPrompt: "You are a helpful assistant.",
      userPrompt: "Say hello and give me a random number between 1 and 10.",
      schema: z.object({
        hello: z.string(),
        number: z.number(),
      })
    });
    console.log("Success! API returned:", res);
  } catch (err) {
    console.error("API Call Failed!");
    console.error(err);
  }
}

main();
