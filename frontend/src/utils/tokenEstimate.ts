// Approximate token-usage estimator for the 5-agent pipeline.
// Numbers are calibrated against measured prompt sizes + typical output volumes; expect ±15% accuracy.
// Used to give the user a pre-flight estimate of cost before running a job.

export type AgentName = "blueprint" | "generator" | "distractor" | "verifier" | "judge";

export type TokenEstimate = {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  by_agent: Record<AgentName, number>;
  passes: number;
  item_count: number;
  cost_usd: number;
};

export type EstimateInput = {
  itemCount: number;
  skipBlueprint?: boolean;
  revisions?: number;
};

// Gemini 2.5 Flash Lite default pricing (per 1M tokens). Override via the second arg if model changes.
const DEFAULT_INPUT_PRICE_PER_M = 0.10;
const DEFAULT_OUTPUT_PRICE_PER_M = 0.40;

export function estimateTokens(
  { itemCount, skipBlueprint = false, revisions = 1 }: EstimateInput,
  prices: { input?: number; output?: number } = {},
): TokenEstimate {
  const n = Math.max(itemCount, 1);

  // Per-agent token model (rough breakdown of input + output).
  // Numbers come from measuring the system prompts + typical user/output sizes.
  const blueprint = skipBlueprint ? 0 : 1170;

  // Generator: system + examples + blueprint + (revision feedback when applicable)
  //            output = passage (~800 tokens) + n stems (~100 ea)
  const generatorPass = 2770 + 800 + 100 * n;
  const generatorRevisePass = generatorPass + 500;          // revision_block adds ~500 input

  // Distractor: input grows per question (~150 each), output ~200 each
  const distractorPass = 1395 + 150 * n + 200 * n;

  // Verifier: ~100 input + ~80 output per question
  const verifierPass = 940 + 100 * n + 80 * n;

  // Judge: ~200 input + ~200 output per question (rubric is dense)
  const judgePass = 1750 + 200 * n + 200 * n;

  const mainPass = generatorPass + distractorPass + verifierPass + judgePass;
  const revisePass = generatorRevisePass + distractorPass + verifierPass + judgePass;

  const totalGenerator   = generatorPass   + revisions * generatorRevisePass;
  const totalDistractor  = distractorPass  * (1 + revisions);
  const totalVerifier    = verifierPass    * (1 + revisions);
  const totalJudge       = judgePass       * (1 + revisions);

  const total = blueprint + mainPass + revisions * revisePass;

  // Rough input/output split: input ~55%, output ~45% (Judge & Verifier dominated by reasoning output).
  const inputTokens = Math.round(total * 0.55);
  const outputTokens = total - inputTokens;

  const inputPrice = prices.input ?? DEFAULT_INPUT_PRICE_PER_M;
  const outputPrice = prices.output ?? DEFAULT_OUTPUT_PRICE_PER_M;
  const costUsd = (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;

  return {
    total_tokens: total,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    by_agent: {
      blueprint,
      generator: totalGenerator,
      distractor: totalDistractor,
      verifier: totalVerifier,
      judge: totalJudge,
    },
    passes: 1 + revisions,
    item_count: n,
    cost_usd: costUsd,
  };
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function formatUSD(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatTHB(usd: number, rate = 35): string {
  const baht = usd * rate;
  if (baht < 1) return `~${baht.toFixed(2)}฿`;
  return `~${baht.toFixed(1)}฿`;
}
