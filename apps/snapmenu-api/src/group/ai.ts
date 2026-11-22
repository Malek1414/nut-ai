/**
 * The one model call of "eating together": reading a person's needs out of what
 * they said (a typed note or the transcript of a voice message), in any language.
 *
 * It runs on the reading model (MODEL_READ, ../models.ts) and answers with picks
 * from fixed lists only. The word rules in ./needs.ts run first and without it;
 * what the model adds is checked there (`mergeModelNeeds`), and a number counts
 * only when the person said it.
 */
import { AiError, create, textOf, type Ai } from '../anthropic.js'
import { PROVEN_MODEL, quickAnswer } from '../models.js'
import { ALLERGY_IDS } from './needs.js'

const NEEDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['diet', 'allergies', 'goal', 'budget_eur', 'name'],
  properties: {
    diet: { type: 'string', enum: ['vegan', 'vegetarian', 'any', 'unknown'] },
    allergies: { type: 'array', items: { type: 'string', enum: [...ALLERGY_IDS] } },
    goal: { type: 'string', enum: ['lose_fat', 'build_muscle', 'balanced', 'unknown'] },
    budget_eur: { type: 'integer' },
    name: { type: ['string', 'null'] },
  },
}

export const NEEDS_SYSTEM = `You fill in a short form for a restaurant app from what a person said about their food needs. The text is a typed note or the transcript of a voice message, in any language. Fill in only what the person said. Never guess.

- diet: "vegan" or "vegetarian" only when they say so, or say they eat no meat and no fish (vegetarian) or no animal products at all (vegan). "any" when they say they eat everything. Otherwise "unknown".
- allergies: every food from the list they are allergic or intolerant to, or say they do not eat. Nuts are tree_nuts, lactose and dairy are milk, celiac is gluten, shrimp, crab and mussels are shellfish. A food they like is not an allergy.
- goal: "lose_fat" when they want to lose weight, eat light or cut. "build_muscle" when they want protein or to build muscle. "balanced" when they say normal or balanced. Otherwise "unknown".
- budget_eur: the most they want to pay for their own meal, as a whole number of euros, only when they name an amount. Otherwise 0.
- name: their first name, only when they say it. Otherwise null.`

/** The request as it is sent to `model`. Exported for tests. */
export const needsRequest = (model: string, text: string) => ({
  model,
  // Room for a model that thinks before it writes; the answer itself is one small object.
  max_tokens: 2000,
  ...quickAnswer(model, NEEDS_SCHEMA),
  system: NEEDS_SYSTEM,
  messages: [{ role: 'user', content: `What the person said:\n${text}` }],
})

/** The model's reading of the text, unchecked. Throws when the service does not answer; the caller then keeps the word rules. */
export async function askNeeds(ai: Ai, text: string): Promise<unknown> {
  let msg: Awaited<ReturnType<typeof create>>
  try {
    msg = await create(ai, needsRequest(ai.read, text))
  } catch (err) {
    // A model setting the service turns down is answered in the proven shape, like a scan.
    if (ai.provider === 'openai' || !(err instanceof AiError && err.code === 'bad_request') || ai.read === PROVEN_MODEL) throw err
    msg = await create(ai, needsRequest(PROVEN_MODEL, text))
  }
  return JSON.parse(textOf(msg)) as unknown
}
