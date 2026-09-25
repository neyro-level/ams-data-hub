import { readFile } from "node:fs/promises";
import { validateConnectionBudget } from "./release-contract.mjs";

const budget = JSON.parse(await readFile("ops/postgres/connection-budget.example.json", "utf8"));
const summary = validateConnectionBudget(budget);
console.log(JSON.stringify({ status: "PASS", connectionBudget: summary }, null, 2));
