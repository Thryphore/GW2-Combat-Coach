import { count, timestamp } from '../format.ts';
import type { Check, Evidence, Finding } from '../types.ts';

/** Used when the API does not publish a duration for a field. */
const DEFAULT_FIELD_MS = 4000;

const CAVEAT =
  'Logs do not record where you or your fields were standing, so this is matched on timing alone. A finisher counted as landing in a field may still have missed it positionally, and projectile finishers only combo when they actually pass through.';

export const combosCheck: Check = {
  id: 'combos',
  name: 'Combo fields and finishers',
  description:
    'Cross-references the combo fields you laid down with the finishers you fired, using combo data from the official GW2 API.',

  applicable: ({ skills }) => (skills ? undefined : 'No GW2 skill data is available for this profession yet.'),

  run: ({ player, skills }) => {
    if (!skills) return [];

    const fields = player.casts
      .map((cast) => ({ cast, skill: skills.skill(cast.skillId) }))
      .filter((entry) => entry.skill?.comboField)
      .map((entry) => ({
        cast: entry.cast,
        name: entry.cast.name,
        fieldType: entry.skill!.comboField!,
        start: entry.cast.time,
        end: entry.cast.time + (entry.skill!.fieldDurationSec ?? DEFAULT_FIELD_MS / 1000) * 1000,
      }));

    const finishers = player.casts
      .map((cast) => ({ cast, skill: skills.skill(cast.skillId) }))
      .filter((entry) => entry.skill?.comboFinisher)
      .map((entry) => ({
        cast: entry.cast,
        name: entry.cast.name,
        finisherType: entry.skill!.comboFinisher!,
      }));

    if (fields.length === 0 && finishers.length === 0) return [];

    const inField = finishers.filter((finisher) =>
      fields.some((field) => finisher.cast.time >= field.start && finisher.cast.time <= field.end),
    );
    const emptyFields = fields.filter(
      (field) => !finishers.some((f) => f.cast.time >= field.start && f.cast.time <= field.end),
    );

    const findings: Finding[] = [];

    if (fields.length > 0 && emptyFields.length > 0) {
      const evidence: Evidence[] = emptyFields.slice(0, 6).map((field) => ({
        time: field.start,
        label: `${field.name} (${field.fieldType} field) at ${timestamp(field.start)}`,
        detail: 'no finisher followed',
      }));

      const ratio = emptyFields.length / fields.length;
      findings.push({
        id: 'combos/unused-fields',
        checkId: 'combos',
        severity: ratio > 0.6 ? 'warning' : 'info',
        title: `${count(emptyFields.length, 'combo field')} went unused`,
        summary: `You created ${count(fields.length, 'field')} and followed up on ${fields.length - emptyFields.length} of them. Each unused field is a free effect you did not collect.`,
        detail: describeFieldTypes(emptyFields.map((field) => field.fieldType)),
        fix: 'Line up a finisher immediately after dropping a field. Leaps and blasts are the easiest to time because they resolve instantly where you stand.',
        caveat: CAVEAT,
        metrics: [
          {
            label: 'Fields used',
            display: `${fields.length - emptyFields.length} / ${fields.length}`,
            value: ((fields.length - emptyFields.length) / fields.length) * 100,
            target: 100,
          },
        ],
        evidence,
        impact: Math.min(6, ratio * 6),
      });
    }

    if (finishers.length > 0) {
      const rate = inField.length / finishers.length;
      if (rate >= 0.5 && inField.length > 0) {
        findings.push({
          id: 'combos/finishers',
          checkId: 'combos',
          severity: 'good',
          title: `${inField.length} of ${finishers.length} finishers landed inside a field`,
          summary: 'Your finishers are lining up with your fields.',
          caveat: CAVEAT,
        });
      } else if (fields.length > 0) {
        findings.push({
          id: 'combos/finishers',
          checkId: 'combos',
          severity: 'info',
          title: `Only ${inField.length} of ${finishers.length} finishers hit a field`,
          summary:
            'Most of your combo finishers went off with no field active, so you got the raw skill and none of the combo effect.',
          fix: 'Drop the field first, then fire the finisher. Reversing that order is the most common reason combos never trigger.',
          caveat: CAVEAT,
          impact: 2,
        });
      }
    }

    return findings;
  },
};

const FIELD_EFFECTS: Record<string, string> = {
  Ethereal: 'Ethereal fields grant Chaos Armor on leaps and blasts, and Confusion on projectiles and whirls.',
  Fire: 'Fire fields grant Might on blasts and burning on projectiles.',
  Water: 'Water fields heal on blasts and leaps.',
  Light: 'Light fields cleanse conditions on blasts and leaps.',
  Smoke: 'Smoke fields grant stealth on blasts and leaps.',
  Lightning: 'Lightning fields grant Swiftness on blasts and daze on leaps.',
  Ice: 'Ice fields grant Frost Aura on blasts and chill on projectiles.',
  Poison: 'Poison fields grant weakness on blasts and poison on projectiles.',
  Dark: 'Dark fields grant blindness on blasts and life siphon on leaps.',
};

function describeFieldTypes(types: string[]): string | undefined {
  const unique = [...new Set(types)];
  const described = unique.map((type) => FIELD_EFFECTS[type]).filter(Boolean);
  return described.length > 0 ? described.join(' ') : undefined;
}
