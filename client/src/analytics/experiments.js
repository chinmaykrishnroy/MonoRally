/**
 * Lightweight client experimentation framework.
 * Provides deterministic, persistent variant assignment without flickering.
 */

export const EXPERIMENTS_STORAGE_KEY = "monorally_experiments_v1";

export const EXPERIMENTS = {
  first_time_entry: {
    id: "first_time_entry",
    name: "First-Time Player Entry Flow",
    hypothesis: "Starting Session Zero immediately rather than showing the mode menu increases first-match completion and 60-second activation.",
    variants: ["direct_session_zero", "standard_menu"],
    weights: [0.5, 0.5]
  },
  onboarding_guidance: {
    id: "onboarding_guidance",
    name: "On-Court Onboarding Guidance Style",
    hypothesis: "Interactive visual cues with typography reinforcement lead to higher first-return rate than minimal cues.",
    variants: ["interactive_cues", "minimal_hints"],
    weights: [0.5, 0.5]
  }
};

/**
 * 32-bit FNV-1a hash function for stable variant bucketing.
 */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * Gets or assigns a variant for an experiment.
 * @param {string} experimentId
 * @param {Object} options
 * @param {string} [options.anonymousId]
 * @param {Storage} [options.storage]
 * @param {string} [options.search]
 * @returns {string} variant name
 */
export function getExperimentVariant(experimentId, {
  anonymousId = "anonymous",
  storage = typeof localStorage !== "undefined" ? localStorage : null,
  search = typeof location !== "undefined" ? location.search : ""
} = {}) {
  const experiment = EXPERIMENTS[experimentId];
  if (!experiment) return "control";

  // Check URL override: ?exp_<id>=variant
  if (search) {
    try {
      const params = new URLSearchParams(search);
      const override = params.get(`exp_${experimentId}`);
      if (override && experiment.variants.includes(override)) {
        return override;
      }
    } catch {
      // URL parsing fallback
    }
  }

  // Check persisted assignments
  let stored = {};
  if (storage) {
    try {
      const raw = storage.getItem(EXPERIMENTS_STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = {};
    }
  }

  if (stored[experimentId] && experiment.variants.includes(stored[experimentId])) {
    return stored[experimentId];
  }

  // Deterministically bucket by hash(anonymousId + experimentId)
  const hashVal = fnv1a(`${anonymousId}:${experimentId}`);
  const { variants, weights } = experiment;

  let assigned = variants[0];
  if (weights && weights.length === variants.length) {
    let cumulative = 0;
    for (let i = 0; i < variants.length; i += 1) {
      cumulative += weights[i];
      if (hashVal <= cumulative) {
        assigned = variants[i];
        break;
      }
    }
  } else {
    const index = Math.floor(hashVal * variants.length);
    assigned = variants[Math.min(variants.length - 1, index)];
  }

  // Persist assignment
  if (storage) {
    try {
      stored[experimentId] = assigned;
      storage.setItem(EXPERIMENTS_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage unavailable fallback
    }
  }

  return assigned;
}

/**
 * Returns all active experiment assignments for the current visitor.
 * @param {Object} options
 * @returns {Record<string, string>}
 */
export function getAllExperimentAssignments(options = {}) {
  const assignments = {};
  for (const expId of Object.keys(EXPERIMENTS)) {
    assignments[expId] = getExperimentVariant(expId, options);
  }
  return assignments;
}
