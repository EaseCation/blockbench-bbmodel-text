export type TextFacingAxis = 'x' | 'y' | 'z';
export type RotationTuple = [number, number, number];
export type QuarterTurn = 0 | 90 | 180 | 270;

export const DEFAULT_TEXT_ROTATION: RotationTuple = [-90, -180, 0];

const BASE_ROTATIONS: Record<TextFacingAxis, RotationTuple> = {
  x: [0, 90, 0],
  y: [-90, -180, 0],
  z: [0, 0, 0],
};

function isFacingAxis(value: unknown): value is TextFacingAxis {
  return value === 'x' || value === 'y' || value === 'z';
}

function normalizeSignedDegrees(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return ((((rounded + 180) % 360) + 360) % 360) - 180;
}

export function normalizeQuarterTurn(value: unknown, fallback: QuarterTurn = 0): QuarterTurn {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = (((Math.round(numeric / 90) * 90) % 360) + 360) % 360;
  return normalized as QuarterTurn;
}

export function sanitizeRotation(value: unknown, fallback: RotationTuple = DEFAULT_TEXT_ROTATION): RotationTuple {
  const source = Array.isArray(value) ? value : fallback;
  return [0, 1, 2].map((index) => {
    if (source[index] === null || source[index] === '') return fallback[index];
    const numeric = Number(source[index]);
    return Number.isFinite(numeric) ? numeric : fallback[index];
  }) as RotationTuple;
}

export function rotationForFacing(axis: unknown, quarterTurn: unknown): RotationTuple {
  const facingAxis = isFacingAxis(axis) ? axis : 'y';
  const turn = normalizeQuarterTurn(quarterTurn);
  const base = BASE_ROTATIONS[facingAxis];
  return [
    normalizeSignedDegrees(base[0]),
    normalizeSignedDegrees(base[1]),
    normalizeSignedDegrees(base[2] + turn),
  ];
}

export function presetFromRotation(rotation: unknown): { axis: TextFacingAxis; quarterTurn: QuarterTurn } {
  const [x, y, z] = sanitizeRotation(rotation);
  for (const axis of Object.keys(BASE_ROTATIONS) as TextFacingAxis[]) {
    const base = BASE_ROTATIONS[axis];
    if (Math.abs(x - base[0]) < 0.001 && Math.abs(y - base[1]) < 0.001) {
      return { axis, quarterTurn: normalizeQuarterTurn(z - base[2]) };
    }
  }
  return { axis: 'y', quarterTurn: 0 };
}
