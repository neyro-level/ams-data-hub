import {
  type GoalProfile,
  type SiteRegistry,
} from "../../src/shared/schemas/registry.ts";
import { type MetricaAllowedGoal } from "../../src/shared/schemas/metrica-source.ts";

export function getAllowedGoalsForSite(args: {
  site: SiteRegistry;
  goalProfile: GoalProfile | null;
}): MetricaAllowedGoal[] {
  const goals = args.goalProfile?.goals ?? [];
  return goals
    .filter((goal) => goal.siteSlugs.length === 0 || goal.siteSlugs.includes(args.site.siteSlug))
    .map((goal) => ({
      goalId: goal.goalId,
      label: goal.label,
      category: goal.category,
      direction: goal.direction,
      includeInSeoConversion: goal.includeInSeoConversion,
    }));
}

export function getSeoConversionGoalIds(goals: MetricaAllowedGoal[]) {
  return goals
    .filter((goal) => goal.includeInSeoConversion)
    .map((goal) => goal.goalId);
}
