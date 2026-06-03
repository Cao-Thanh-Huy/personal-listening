/**
 * Scoring Service - Fuzzy matching + Mastery calculation
 */
import { token_set_ratio as fuzzTokenSet, ratio as fuzzRatio } from 'fuzzball'

export class Scorer {
  /**
   * Fuzzy match user input vs correct text
   * @returns {number} score 0-100
   */
  fuzzyMatch(userInput, correctText) {
    if (!userInput || !correctText) return 0

    const normalized = (s) => s.toLowerCase().replace(/[^\w\s']/g, '').trim()

    const input = normalized(userInput)
    const correct = normalized(correctText)

    if (!input || !correct) return 0

    // Token set ratio (better for listening exercises)
    const tokenSortRatio = fuzzTokenSet(input, correct)

    // Full string ratio
    const fullRatio = fuzzRatio(input, correct)

    // Weighted: prefer token-based for listening (word order matters less)
    return Math.round(tokenSortRatio * 0.6 + fullRatio * 0.4)
  }
}
