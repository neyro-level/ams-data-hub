export function formatInteger(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) {
    return "—";
  }

  return `${value.toFixed(digits)}%`;
}

export function formatPosition(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return value.toFixed(1);
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) {
    return "—";
  }

  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = roundedSeconds % 60;
  return `${minutes}м ${remainder.toString().padStart(2, "0")}с`;
}
