const EPS = 1e-9;

function toNumber(value, name) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return num;
}

function floorTenth(x) {
  return Math.floor((x + EPS) * 10) / 10;
}

function roundTenthHalfUp(x) {
  return Math.round((x + EPS) * 10) / 10;
}

export function mphDistribution(sets, maxMph, avgMph) {
  const nRaw = toNumber(sets, "sets");
  const n = Math.round(nRaw);
  if (n <= 0) {
    throw new Error("sets must be >= 1");
  }
  if (Math.abs(n - nRaw) > EPS) {
    throw new Error("sets must be an integer count.");
  }

  const M = toNumber(maxMph, "max_mph");
  const avgNumber = Number.isFinite(Number(avgMph)) ? Number(avgMph) : M;
  const A = toNumber(avgNumber, "avg_mph");

  if (n === 1) {
    if (M + EPS < A) {
      throw new Error("With 1 set, max_mph must be >= avg_mph.");
    }
    return [roundTenthHalfUp(M)];
  }

  const xMax = M - 0.1;
  const bestAvg = (M + (n - 1) * xMax) / n;
  if (A > bestAvg + EPS) {
    throw new Error(
      `Target average ${A} is too high. Max achievable average with exactly one max is ${bestAvg}.`
    );
  }

  let xExact = (n * A - M) / (n - 1);
  if (xExact > xMax) {
    xExact = xMax;
  }

  let xLow = floorTenth(xExact);
  let xHigh = xLow + 0.1;

  if (xHigh > xMax + EPS) {
    xHigh = xMax;
    xLow = xHigh - 0.1;
  }

  if (xLow > xHigh + EPS) {
    xLow = xMax;
    xHigh = xMax;
  }

  const needSumOthers = n * A - M;
  const baseSumOthers = (n - 1) * xLow;
  const step = xHigh - xLow;
  let h = 0;
  if (step > EPS) {
    const needed = (needSumOthers - baseSumOthers) / step;
    h = Math.floor(needed + EPS);
    if (h < needed - EPS) {
      h += 1;
    }
    h = Math.min(Math.max(h, 0), n - 1);
  } else {
    const achievedAvg = (M + (n - 1) * xLow) / n;
    if (achievedAvg + EPS < A) {
      throw new Error("Could not reach the target average with constraints.");
    }
  }

  const result = [M, ...Array(h).fill(xHigh), ...Array(n - 1 - h).fill(xLow)];
  const rounded = result.map((value) => roundTenthHalfUp(value));

  const maxRounded = roundTenthHalfUp(M);
  const maxCount = rounded.filter((v) => Math.abs(v - maxRounded) <= EPS).length;
  if (maxCount !== 1) {
    let adjusted = false;
    for (let i = 1; i < rounded.length && maxCount > 1 && !adjusted; i += 1) {
      if (Math.abs(rounded[i] - maxRounded) <= EPS) {
        const demoted = roundTenthHalfUp(rounded[i] - 0.1);
        rounded[i] = demoted;
        adjusted = true;
      }
    }
  }

  const sum = rounded.reduce((acc, val) => acc + val, 0);
  const average = sum / n;
  if (average + EPS < A) {
    throw new Error("Average fell below target after rounding.");
  }

  return rounded;
}

export default mphDistribution;
