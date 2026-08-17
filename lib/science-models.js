export function transmissionMetrics(voltage, power = 1000, resistance = 1) {
  const current = power / voltage;
  return {
    current,
    lineLoss: current ** 2 * resistance,
    lineVoltageDrop: current * resistance,
  };
}

export function transformerSecondaryVoltage(primaryVoltage, primaryTurns, secondaryTurns) {
  return primaryVoltage * secondaryTurns / primaryTurns;
}

export function rectifierCurrents(angleDegrees) {
  const theta = angleDegrees * Math.PI / 180;
  const inputCurrent = Math.sin(theta);
  return {
    theta,
    inputCurrent,
    outputCurrent: Math.abs(inputCurrent),
  };
}

export function capacitorRippleFraction(capacitanceMicrofarads) {
  return Math.min(0.5, 70 / capacitanceMicrofarads);
}

export function capacitorOutputVoltage(phase, rippleFraction) {
  const rectifiedVoltage = Math.abs(Math.cos(phase));
  const sincePeak = ((phase % Math.PI) + Math.PI) % Math.PI;
  const dischargingVoltage = 1 - rippleFraction * (sincePeak / Math.PI);
  return Math.max(rectifiedVoltage, dischargingVoltage);
}

export function switchingRelativeTransfer(onTimePercent) {
  return Math.max(0, Math.min(100, onTimePercent)) / 100;
}
