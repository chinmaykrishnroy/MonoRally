/**
 * First-party product analytics event store and funnel aggregation engine.
 * Privacy-conscious: processes only pseudonymous/anonymous IDs with no PII.
 */

export class AnalyticsEventStore {
  constructor({ maxEvents = 50000 } = {}) {
    this.maxEvents = maxEvents;
    this.events = [];
    this.userFirstEvents = new Map(); // anonymousId -> Map(eventName, firstTimestamp)
    this.userMatches = new Map(); // anonymousId -> count
  }

  /**
   * Ingest a batch of validated analytics events.
   * @param {Array<Object>} batch
   * @returns {{ accepted: number, rejected: number }}
   */
  ingest(batch) {
    if (!Array.isArray(batch)) {
      return { accepted: 0, rejected: 0 };
    }

    let accepted = 0;
    let rejected = 0;

    for (const item of batch) {
      if (!this.isValidEvent(item)) {
        rejected += 1;
        continue;
      }

      const normalized = this.normalizeEvent(item);
      this.recordEvent(normalized);
      accepted += 1;
    }

    // Prune oldest if capacity exceeded
    if (this.events.length > this.maxEvents) {
      const excess = this.events.length - this.maxEvents;
      this.events.splice(0, excess);
    }

    return { accepted, rejected };
  }

  isValidEvent(event) {
    if (!event || typeof event !== "object") return false;
    if (typeof event.name !== "string" || !event.name.trim()) return false;
    if (typeof event.anonymousId !== "string" || !event.anonymousId.trim()) return false;
    if (typeof event.sessionId !== "string" || !event.sessionId.trim()) return false;
    return true;
  }

  normalizeEvent(raw) {
    const timestamp = typeof raw.timestamp === "number" && raw.timestamp > 0
      ? raw.timestamp
      : Date.now();

    return {
      name: raw.name.trim(),
      anonymousId: raw.anonymousId.trim(),
      sessionId: raw.sessionId.trim(),
      timestamp,
      properties: (raw.properties && typeof raw.properties === "object") ? raw.properties : {},
      dimensions: (raw.dimensions && typeof raw.dimensions === "object") ? raw.dimensions : {}
    };
  }

  recordEvent(event) {
    this.events.push(event);

    const { anonymousId, name, timestamp } = event;
    if (!this.userFirstEvents.has(anonymousId)) {
      this.userFirstEvents.set(anonymousId, new Map());
    }
    const userMap = this.userFirstEvents.get(anonymousId);
    if (!userMap.has(name)) {
      userMap.set(name, timestamp);
    }

    if (name === "match_completed") {
      const current = this.userMatches.get(anonymousId) || 0;
      this.userMatches.set(anonymousId, current + 1);
    }
  }

  /**
   * Computes the core product conversion funnel.
   * Steps:
   * 1. Landing (app_open / play_impression)
   * 2. Gameplay reached (first_gameplay_frame / onboarding_started / match_started)
   * 3. First input (first_input)
   * 4. First return (first_return / first_ball_contact)
   * 5. First skill shot (first_skill_shot)
   * 6. First match completed (match_completed with matchNumber === 1)
   * 7. Second match started (match_started with matchNumber >= 2)
   * 8. Human PvP started (human_match_started)
   * 9. Human PvP completed (human_match_completed)
   * 10. Rematch / next opponent (rematch_clicked / next_opponent_clicked)
   */
  getFunnelReport() {
    const funnelStepDefs = [
      { id: "landing", label: "Landing", matches: ["app_open", "play_impression", "first_render"] },
      { id: "gameplay_reached", label: "Gameplay Reached", matches: ["first_gameplay_frame", "onboarding_started", "match_started"] },
      { id: "first_input", label: "First Input", matches: ["first_input"] },
      { id: "first_return", label: "First Return", matches: ["first_return", "first_ball_contact"] },
      { id: "first_skill_shot", label: "First Skill Shot", matches: ["first_skill_shot"] },
      {
        id: "first_match_completed",
        label: "First Match Completed",
        check: (event, store) => {
          if (event.name !== "match_completed") return false;
          return event.properties?.matchNumber === 1 || (store.userMatches.get(event.anonymousId) || 0) >= 1;
        }
      },
      {
        id: "second_match_started",
        label: "Second Match Started",
        check: (event) => {
          if (event.name !== "match_started") return false;
          return (event.properties?.matchNumber || 0) >= 2;
        }
      },
      { id: "human_pvp_started", label: "Human PvP Started", matches: ["human_match_started"] },
      { id: "human_pvp_completed", label: "Human PvP Completed", matches: ["human_match_completed"] },
      { id: "rematch_or_next", label: "Rematch / Next Opponent", matches: ["rematch_clicked", "next_opponent_clicked"] }
    ];

    // Identify which unique anonymousIds reached each step
    const stepUsers = funnelStepDefs.map(() => new Set());
    const stepEventCounts = funnelStepDefs.map(() => 0);

    for (const event of this.events) {
      for (let i = 0; i < funnelStepDefs.length; i += 1) {
        const def = funnelStepDefs[i];
        let matched = false;
        if (def.matches && def.matches.includes(event.name)) {
          matched = true;
        } else if (def.check && def.check(event, this)) {
          matched = true;
        }

        if (matched) {
          stepUsers[i].add(event.anonymousId);
          stepEventCounts[i] += 1;
        }
      }
    }

    const baselineUsers = stepUsers[0]?.size || 0;
    const steps = funnelStepDefs.map((def, i) => {
      const uniqueCount = stepUsers[i].size;
      const prevUniqueCount = i === 0 ? uniqueCount : stepUsers[i - 1].size;

      const conversionFromPrev = prevUniqueCount > 0
        ? Math.round((uniqueCount / prevUniqueCount) * 1000) / 10
        : (i === 0 && uniqueCount > 0 ? 100 : 0);

      const overallConversion = baselineUsers > 0
        ? Math.round((uniqueCount / baselineUsers) * 1000) / 10
        : 0;

      const dropoffRate = i === 0 ? 0 : Math.round((100 - conversionFromPrev) * 10) / 10;

      return {
        id: def.id,
        label: def.label,
        uniqueUsers: uniqueCount,
        totalEvents: stepEventCounts[i],
        conversionFromPreviousPct: conversionFromPrev,
        overallConversionPct: overallConversion,
        dropoffPct: dropoffRate
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      totalEvents: this.events.length,
      uniqueUsersTotal: this.userFirstEvents.size,
      steps
    };
  }

  /**
   * Computes activation, engagement, and experiment metrics.
   */
  getSummaryMetrics() {
    const totalEvents = this.events.length;
    const totalUsers = this.userFirstEvents.size;
    const sessions = new Set(this.events.map((e) => e.sessionId)).size;

    // Time to gameplay and time to first input calculation
    const timeToGameplaySamples = [];
    const timeToFirstInputSamples = [];

    for (const [, eventsMap] of this.userFirstEvents) {
      const landing = eventsMap.get("app_open") || eventsMap.get("play_impression") || eventsMap.get("first_render");
      const gameplay = eventsMap.get("first_gameplay_frame") || eventsMap.get("onboarding_started") || eventsMap.get("match_started");
      const input = eventsMap.get("first_input");

      if (landing && gameplay && gameplay >= landing) {
        timeToGameplaySamples.push(gameplay - landing);
      }
      if (landing && input && input >= landing) {
        timeToFirstInputSamples.push(input - landing);
      }
    }

    // Onboarding completion
    let onboardingStartedCount = 0;
    let onboardingCompletedCount = 0;
    let onboardingSkippedCount = 0;

    // Skill shots breakdown
    const skillShots = { drive: 0, curve: 0, smash: 0, counter: 0 };

    // Experiment variant aggregates
    const experimentUsers = new Map(); // expId:variant -> Set(anonymousId)

    for (const event of this.events) {
      if (event.name === "onboarding_started") onboardingStartedCount += 1;
      if (event.name === "onboarding_completed") onboardingCompletedCount += 1;
      if (event.name === "onboarding_skipped") onboardingSkippedCount += 1;

      if (event.name === "skill_shot" && event.properties?.shotType) {
        const type = event.properties.shotType.toLowerCase();
        if (skillShots[type] !== undefined) skillShots[type] += 1;
      }

      const assignments = event.dimensions?.experimentAssignments || {};
      for (const [expId, variant] of Object.entries(assignments)) {
        const key = `${expId}:${variant}`;
        if (!experimentUsers.has(key)) experimentUsers.set(key, new Set());
        experimentUsers.get(key).add(event.anonymousId);
      }
    }

    const onboardingCompletionRate = onboardingStartedCount > 0
      ? Math.round((onboardingCompletedCount / onboardingStartedCount) * 1000) / 10
      : 0;

    // Matches per session
    const matchCompletedEvents = this.events.filter((e) => e.name === "match_completed");
    const matchesPerSession = sessions > 0
      ? Math.round((matchCompletedEvents.length / sessions) * 100) / 100
      : 0;

    return {
      overview: {
        totalEvents,
        totalUsers,
        totalSessions: sessions,
        matchesCompleted: matchCompletedEvents.length,
        matchesPerSession
      },
      activation: {
        medianTimeToGameplayMs: median(timeToGameplaySamples),
        p90TimeToGameplayMs: percentile(timeToGameplaySamples, 90),
        medianTimeToFirstInputMs: median(timeToFirstInputSamples),
        p90TimeToFirstInputMs: percentile(timeToFirstInputSamples, 90),
        onboardingStarted: onboardingStartedCount,
        onboardingCompleted: onboardingCompletedCount,
        onboardingSkipped: onboardingSkippedCount,
        onboardingCompletionRatePct: onboardingCompletionRate
      },
      skillShots,
      experiments: Object.fromEntries(
        Array.from(experimentUsers.entries()).map(([key, set]) => [key, set.size])
      )
    };
  }

  clear() {
    this.events = [];
    this.userFirstEvents.clear();
    this.userMatches.clear();
  }
}

function median(samples) {
  if (!samples || !samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(samples, p) {
  if (!samples || !samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}
