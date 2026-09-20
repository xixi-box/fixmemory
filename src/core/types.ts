export type MemoryScope = "project" | "global";
export type MemoryStatus = "candidate" | "verified" | "superseded";
export type FeedbackResult = "helpful" | "irrelevant" | "harmful";

export interface EnvironmentFacts {
  [key: string]: string;
}

export interface ProjectIdentity {
  key: string;
  label: string;
  root: string;
}

export interface DebugMemory {
  id: string;
  scope: MemoryScope;
  projectKey?: string;
  projectLabel?: string;
  symptom: string;
  rootCause: string;
  solution: string;
  evidence: string;
  environment: EnvironmentFacts;
  status: MemoryStatus;
  fingerprint: string;
  createdAt: string;
  verifiedAt?: string;
  updatedAt: string;
  helpfulCount: number;
  irrelevantCount: number;
  harmfulCount: number;
}

export interface MemoryMatch {
  memory: DebugMemory;
  score: number;
  matchedTerms: string[];
  environmentMismatches: string[];
}

export interface ProposeMemoryInput {
  scope: MemoryScope;
  projectPath?: string;
  symptom: string;
  rootCause: string;
  solution: string;
  evidence: string;
  environment?: EnvironmentFacts;
}

export interface SearchMemoryInput {
  query: string;
  projectPath?: string;
  environment?: EnvironmentFacts;
  limit?: number;
  includeCandidates?: boolean;
}
