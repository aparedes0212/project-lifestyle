const MIN_RUN_EASY_STEP = 0.1;

export function ceilingToNextTenth(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return (Math.floor((num * 10) + 1e-9) + 1) / 10;
}

export function roundToDisplayTenth(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toFixed(1));
}

export function buildCardioMetricPlanOptions(snapshot, workoutName) {
  const normalizedWorkoutName = String(workoutName || "").trim();
  if (!normalizedWorkoutName || !snapshot || typeof snapshot !== "object") return [];

  const fastPeriods = Array.isArray(snapshot?.fast?.periods) ? snapshot.fast.periods : [];
  const fastPeriodsByKey = Object.fromEntries(fastPeriods.map((period) => [period.key, period]));

  const withPlanValues = (periods, mapper) => (
    periods
      .map((period) => {
        const plan = mapper(period);
        if (!plan) return null;
        const mphGoal = normalizePositive(plan.mphGoal);
        const mphGoalAvg = normalizePositive(plan.mphGoalAvg);
        if (mphGoal == null || mphGoalAvg == null) return null;
        return {
          key: period.key,
          label: period.label,
          mphGoal,
          mphGoalAvg,
        };
      })
      .filter(Boolean)
  );

  if (normalizedWorkoutName === "Fast") {
    return withPlanValues(fastPeriods, (period) => ({
      mphGoal: ceilingToNextTenth(period?.max_mph),
      mphGoalAvg: ceilingToNextTenth(period?.avg_mph),
    }));
  }

  if (normalizedWorkoutName === "Tempo") {
    const tempoPeriods = Array.isArray(snapshot?.tempo?.periods) ? snapshot.tempo.periods : [];
    return withPlanValues(tempoPeriods, (period) => {
      const fastPeriod = fastPeriodsByKey[period.key];
      return {
        mphGoal: ceilingToNextTenth(fastPeriod?.riegel?.predicted_mph),
        mphGoalAvg: ceilingToNextTenth(period?.avg_mph),
      };
    });
  }

  if (normalizedWorkoutName === "Min Run") {
    const minRunPeriods = Array.isArray(snapshot?.min_run?.periods) ? snapshot.min_run.periods : [];
    return withPlanValues(minRunPeriods, (period) => ({
      mphGoal: getInheritedMinRunEasyMph(period, fastPeriodsByKey[period.key]),
      mphGoalAvg: roundToDisplayTenth(period?.avg_mph),
    }));
  }

  const sprintWorkouts = Array.isArray(snapshot?.sprints?.workouts) ? snapshot.sprints.workouts : [];
  const sprintSection = sprintWorkouts.find((item) => String(item?.workout_name || "").trim() === normalizedWorkoutName);
  const sprintPeriods = Array.isArray(sprintSection?.periods) ? sprintSection.periods : [];

  if (normalizedWorkoutName === "x800") {
    return withPlanValues(sprintPeriods, (period) => ({
      mphGoal: ceilingToNextTenth(period?.max_mph),
      mphGoalAvg: ceilingToNextTenth(period?.avg_mph),
    }));
  }

  if (normalizedWorkoutName === "x400" || normalizedWorkoutName === "x200") {
    return withPlanValues(sprintPeriods, (period) => {
      const currentMax = ceilingToNextTenth(period?.max_mph);
      const predicted = ceilingToNextTenth(period?.riegel?.predicted_mph);
      const mphGoal = maxPositive(currentMax, predicted);
      return {
        mphGoal,
        mphGoalAvg: ceilingToNextTenth(period?.avg_mph),
      };
    });
  }

  return [];
}

export function findMatchingCardioMetricPlanOption(options, selection) {
  const periodKey = String(selection?.periodKey || selection?.period_key || "").trim();
  if (periodKey) {
    const byKey = options.find((option) => option.key === periodKey);
    if (byKey) return byKey;
  }

  const maxGoal = roundToDisplayTenth(selection?.mphGoal ?? selection?.mph_goal);
  const avgGoal = roundToDisplayTenth(selection?.mphGoalAvg ?? selection?.mph_goal_avg);
  if (maxGoal == null || avgGoal == null) return null;

  return options.find((option) => (
    roundToDisplayTenth(option?.mphGoal) === maxGoal
    && roundToDisplayTenth(option?.mphGoalAvg) === avgGoal
  )) ?? null;
}

function normalizePositive(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function maxPositive(...values) {
  const candidates = values.filter((value) => normalizePositive(value) != null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function getInheritedMinRunEasyMph(minRunPeriod, fastPeriod) {
  const easyFloor = ceilingToNextTenth(fastPeriod?.riegel?.easy_low_mph);
  const easyCeiling = ceilingToNextTenth(fastPeriod?.riegel?.easy_high_mph);
  const currentAvg = normalizePositive(minRunPeriod?.avg_mph);
  if (easyFloor == null || easyCeiling == null) return null;

  const lowerBound = Math.min(easyFloor, easyCeiling);
  const upperBound = Math.max(easyFloor, easyCeiling);
  let adjusted = lowerBound;
  const minimumRequired = currentAvg != null ? currentAvg + MIN_RUN_EASY_STEP : null;

  while (minimumRequired != null && adjusted < minimumRequired && adjusted < upperBound) {
    adjusted = Number((adjusted + MIN_RUN_EASY_STEP).toFixed(1));
  }

  return Math.min(adjusted, upperBound);
}
