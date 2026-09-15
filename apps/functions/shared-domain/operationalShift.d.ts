export interface OperationalShiftLike {
  origin?: unknown;
  isReten?: unknown;
  resolvedBy?: unknown;
}

export declare const OPERATIONAL_SHIFT_ORIGINS: ReadonlySet<string>;

export declare function isOperationalOriginShift(
  shift: OperationalShiftLike | null | undefined,
): boolean;
