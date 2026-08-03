export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || Number.isNaN(min) || Number.isNaN(max)) {
    throw new RangeError("clampNumber: value, min, max must not be NaN");
  }
  if (min > max) {
    throw new RangeError("clampNumber: min must not be greater than max");
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
