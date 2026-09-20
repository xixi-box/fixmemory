import type { DebugMemory, EnvironmentFacts, MemoryMatch } from "./types.js";

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function tokenize(value: string): Set<string> {
  const normalized = normalize(value);
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_.:/-]{1,}/g)) {
    tokens.add(match[0]);
  }
  for (const segment of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (segment.length === 1) {
      tokens.add(segment);
    }
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.add(segment.slice(index, index + 2));
    }
  }
  return tokens;
}

function environmentComparison(
  memoryEnvironment: EnvironmentFacts,
  currentEnvironment: EnvironmentFacts,
): { bonus: number; mismatches: string[] } {
  let matches = 0;
  const mismatches: string[] = [];
  for (const [key, currentValue] of Object.entries(currentEnvironment)) {
    const recordedValue = memoryEnvironment[key];
    if (recordedValue === undefined) {
      continue;
    }
    if (normalize(recordedValue) === normalize(currentValue)) {
      matches += 1;
    } else {
      mismatches.push(`${key}: recorded=${recordedValue}, current=${currentValue}`);
    }
  }
  return { bonus: Math.min(matches * 0.05, 0.2), mismatches };
}

export function scoreMemory(
  memory: DebugMemory,
  query: string,
  environment: EnvironmentFacts,
): MemoryMatch | undefined {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) {
    return undefined;
  }

  const symptomTokens = tokenize(memory.symptom);
  const causeTokens = tokenize(memory.rootCause);
  const solutionTokens = tokenize(memory.solution);
  const matchedTerms: string[] = [];
  let weightedHits = 0;

  for (const token of queryTokens) {
    let weight = 0;
    if (symptomTokens.has(token)) weight = Math.max(weight, 3);
    if (causeTokens.has(token)) weight = Math.max(weight, 2);
    if (solutionTokens.has(token)) weight = Math.max(weight, 1);
    if (weight > 0) {
      matchedTerms.push(token);
      weightedHits += weight;
    }
  }

  const normalizedQuery = normalize(query);
  const exactBonus = normalize(memory.symptom).includes(normalizedQuery) ? 0.75 : 0;
  const environmentResult = environmentComparison(memory.environment, environment);
  const feedbackPenalty = memory.harmfulCount * 0.2;
  const score = weightedHits / (queryTokens.size * 3) + exactBonus + environmentResult.bonus - feedbackPenalty;

  if (score < 0.12) {
    return undefined;
  }

  return {
    memory,
    score: Number(score.toFixed(4)),
    matchedTerms: matchedTerms.slice(0, 20),
    environmentMismatches: environmentResult.mismatches,
  };
}
