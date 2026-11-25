import type { CarSpecs } from '../../data/car'

const G = 9.80665
const DEG = Math.PI / 180

export interface Suspension {
  wheelRateF: number
  wheelRateR: number
  rideRateF: number
  rideRateR: number
  freqF: number
  freqR: number
  rollStiffF: number
  rollStiffR: number
  rollStiffFront: number
  rollGradient: number
  lltd: number
  transferF: number
  transferR: number
  sprungMass: number
  sprungCg: number
  rollArm: number
}

const series = (a: number, b: number) => (a > 0 && b > 0 ? (a * b) / (a + b) : Math.max(a, b, 0))

export function suspension(c: CarSpecs): Suspension {
  const unsprung = 2 * (c.unsprungFront + c.unsprungRear)
  const sprungMass = Math.max(c.mass * 0.3, c.mass - unsprung)
  const sprungCg = Math.max(0.05, (c.mass * c.cgHeight - unsprung * c.tireRadius) / sprungMass)
  const sprungRear = Math.min(
    0.9,
    Math.max(0.1, (c.mass * c.rearWeight - 2 * c.unsprungRear) / sprungMass),
  )
  const wheelRateF = c.springFront * c.motionFront * c.motionFront
  const wheelRateR = c.springRear * c.motionRear * c.motionRear
  const rideRateF = series(wheelRateF, c.tireRate)
  const rideRateR = series(wheelRateR, c.tireRate)
  const cornerF = Math.max(1, (sprungMass * (1 - sprungRear)) / 2)
  const cornerR = Math.max(1, (sprungMass * sprungRear) / 2)
  const freq = (rate: number, mass: number) => Math.sqrt((rate * 1000) / mass) / (2 * Math.PI)

  const axleRoll = (wheelRate: number, arb: number, track: number) =>
    series(
      (wheelRate * 1000 * track * track) / 2 + arb / DEG,
      (c.tireRate * 1000 * track * track) / 2,
    )
  const kF = axleRoll(wheelRateF, c.arbFront, c.trackFront)
  const kR = axleRoll(wheelRateR, c.arbRear, c.trackRear)
  const kTotal = Math.max(1, kF + kR)
  const rollAxis = c.rcFront + (c.rcRear - c.rcFront) * sprungRear
  const rollArm = sprungCg - rollAxis
  const moment = sprungMass * rollArm
  const stiffness = Math.max(kTotal * 0.05, kTotal - moment * G)
  const rollGradient = (moment * G) / stiffness / DEG

  const transferF =
    ((moment * kF) / kTotal +
      sprungMass * (1 - sprungRear) * c.rcFront +
      2 * c.unsprungFront * c.tireRadius) /
    c.trackFront
  const transferR =
    ((moment * kR) / kTotal +
      sprungMass * sprungRear * c.rcRear +
      2 * c.unsprungRear * c.tireRadius) /
    c.trackRear

  return {
    wheelRateF,
    wheelRateR,
    rideRateF,
    rideRateR,
    freqF: freq(rideRateF, cornerF),
    freqR: freq(rideRateR, cornerR),
    rollStiffF: kF * DEG,
    rollStiffR: kR * DEG,
    rollStiffFront: kF / kTotal,
    rollGradient,
    lltd: transferF / Math.max(1e-9, transferF + transferR),
    transferF,
    transferR,
    sprungMass,
    sprungCg,
    rollArm,
  }
}
