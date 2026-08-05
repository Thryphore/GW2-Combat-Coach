/**
 * Typed subset of the Elite Insights JSON produced by arcdps log parsers.
 *
 * Only the fields this app consumes are declared, and nearly everything is
 * optional: the schema evolves between EI versions and logs from older parsers
 * are still perfectly analyzable.
 *
 * Reference: https://baaron4.github.io/GW2-Elite-Insights-Parser/Json/
 */

export interface EISkillDesc {
  name?: string;
  autoAttack?: boolean;
  canCrit?: boolean;
  isSwap?: boolean;
  isInstantCast?: boolean;
  isNotAccurate?: boolean;
  traitProc?: boolean;
  gearProc?: boolean;
  icon?: string;
}

export interface EIBuffDesc {
  name?: string;
  icon?: string;
  stacking?: boolean;
  consumable?: boolean;
  descriptions?: string[];
}

export interface EIDamageModDesc {
  name?: string;
  icon?: string;
  description?: string;
  nonMultiplier?: boolean;
  skillBased?: boolean;
  approximate?: boolean;
}

export interface EICastedSkill {
  /** Time of the cast, in ms relative to log start. */
  castTime: number;
  /** Animation duration in ms; 0 for instant casts. */
  duration: number;
  /**
   * Time gained from the animation. Positive means the player cancelled after
   * the skill fired (good technique). Negative means the cast was aborted
   * before it did anything, so the time was wasted.
   */
  timeGained: number;
  /** -1 (100% slow) to 1 (100% quickness). */
  quickness: number;
  ignoreOnRotationRender?: boolean;
}

export interface EIRotation {
  id: number;
  skills?: EICastedSkill[];
}

export interface EIBuffUptimeData {
  uptime?: number;
  presence?: number;
  generated?: Record<string, number>;
  overstacked?: Record<string, number>;
  wasted?: Record<string, number>;
}

export interface EIBuffUptime {
  id: number;
  buffData?: EIBuffUptimeData[];
  /** [time, stacks] pairs; the value holds until the next entry. */
  states?: number[][];
  statesPerSource?: Record<string, number[][]>;
}

export interface EIDamageModifierEntry {
  hitCount?: number;
  totalHitCount?: number;
  damageGain?: number;
  totalDamage?: number;
}

export interface EIDamageModifierData {
  id: number;
  damageModifiers?: EIDamageModifierEntry[];
}

export interface EIDamageDist {
  id: number;
  totalDamage?: number;
  min?: number;
  max?: number;
  hits?: number;
  connectedHits?: number;
  crit?: number;
  glance?: number;
  flank?: number;
  missed?: number;
  invulned?: number;
  interrupted?: number;
  indirectDamage?: boolean;
}

export interface EIDps {
  dps?: number;
  damage?: number;
  condiDps?: number;
  condiDamage?: number;
  powerDps?: number;
  powerDamage?: number;
  actorDps?: number;
  actorDamage?: number;
}

export interface EIGameplayStatsAll {
  wasted?: number;
  timeWasted?: number;
  saved?: number;
  timeSaved?: number;
  swapCount?: number;
  skillCastUptime?: number;
  skillCastUptimeNoAA?: number;
  stackDist?: number;
  distToCom?: number;
}

export interface EIDefensesAll {
  damageTaken?: number;
  blockedCount?: number;
  evadedCount?: number;
  dodgeCount?: number;
  invulnedCount?: number;
  interruptedCount?: number;
  downCount?: number;
  deadCount?: number;
  downDuration?: number;
  deadDuration?: number;
}

export interface EIWeaponSet {
  weapons?: string[];
  start?: number;
  end?: number;
}

export interface EIDeathRecapDamageItem {
  id?: number;
  indirectDamage?: boolean;
  src?: string;
  damage?: number;
  time?: number;
}

export interface EIDeathRecap {
  deathTime?: number;
  toDown?: EIDeathRecapDamageItem[];
  toKill?: EIDeathRecapDamageItem[];
}

export interface EIPlayer {
  name?: string;
  account?: string;
  group?: number;
  profession?: string;
  friendlyNPC?: boolean;
  notInSquad?: boolean;
  firstAware?: number;
  lastAware?: number;
  weapons?: string[];
  weaponSets?: EIWeaponSet[];
  activeTimes?: number[];
  dpsAll?: EIDps[];
  dpsTargets?: EIDps[][];
  statsAll?: EIGameplayStatsAll[];
  defenses?: EIDefensesAll[];
  rotation?: EIRotation[];
  buffUptimes?: EIBuffUptime[];
  damageModifiers?: EIDamageModifierData[];
  totalDamageDist?: EIDamageDist[][];
  targetDamageDist?: EIDamageDist[][][];
  deathRecap?: EIDeathRecap[];
}

export interface EINpc {
  name?: string;
  id?: number;
  totalHealth?: number;
  finalHealth?: number;
  healthPercentBurned?: number;
  firstAware?: number;
  lastAware?: number;
  enemyPlayer?: boolean;
}

export interface EIPhase {
  start: number;
  end: number;
  name?: string;
  targets?: number[];
  subPhases?: number[];
  breakbarPhase?: boolean;
  phaseType?: string;
}

export interface EILog {
  eliteInsightsVersion?: string;
  triggerID?: number;
  eiEncounterID?: number;
  eiLogID?: number;
  fightName?: string;
  name?: string;
  fightIcon?: string;
  arcVersion?: string;
  gW2Build?: number;
  language?: string;
  recordedBy?: string;
  recordedAccountBy?: string;
  timeStartStd?: string;
  timeEndStd?: string;
  duration?: string;
  durationMS?: number;
  success?: boolean;
  isCM?: boolean;
  isLegendaryCM?: boolean;
  isLateStart?: boolean;
  targetless?: boolean;
  players?: EIPlayer[];
  targets?: EINpc[];
  phases?: EIPhase[];
  uploadLinks?: string[];
  logErrors?: string[];
  skillMap?: Record<string, EISkillDesc>;
  buffMap?: Record<string, EIBuffDesc>;
  damageModMap?: Record<string, EIDamageModDesc>;
  personalBuffs?: Record<string, number[]>;
  personalDamageMods?: Record<string, number[]>;
}
