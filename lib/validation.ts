import { z } from "zod";

/**
 * Validate unknown external input at the boundary before trusting it
 * (code-standards.md: TypeScript + API Routes). Example for a Starling transaction.
 */
export const StarlingTxn = z.object({
  feedItemUid: z.string(),
  amount: z.object({ minorUnits: z.number().int(), currency: z.string() }),
  direction: z.enum(["IN", "OUT"]),
  transactionTime: z.string(),
  counterPartyName: z.string().optional(),
});
export type StarlingTxn = z.infer<typeof StarlingTxn>;
